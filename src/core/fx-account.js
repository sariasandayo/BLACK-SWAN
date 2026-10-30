// FX口座エンジン：ポジション、証拠金、ロスカット、逆指値・指値、スワップ、時代ごとのレバレッジ上限
//
// 資金は円で一元管理する。cash（現金）はゲーム全体の所持金でもあり、FXの証拠金も兼ねる。
//   有効証拠金 = 現金 + 含み損益
//   必要証拠金 = 数量 × 仲値 ÷ レバレッジ（規制で上限が下がったら、下がった上限で計算し直す）
//   証拠金維持率 = 有効証拠金 ÷ 必要証拠金
//   使える額   = 現金と「有効証拠金 − 必要証拠金」の小さいほう（含み益は使えない）
//
// 価格（prices）は { USD: 150.12, ... } の仲値で受け取り、売買の値段はスプレッドを足し引きして決める。

import { CONFIG } from "../config.js";

export function maxLeverage(date, config = CONFIG) {
  for (const rule of config.fx.leverageRules) {
    if (date >= rule.from) return rule.max;
  }
  return config.fx.leverageRules[config.fx.leverageRules.length - 1].max;
}

export class FxAccount {
  constructor({ cash, config = CONFIG }) {
    this.config = config;
    this.cash = cash;
    this.positions = [];
    this.closed = []; // 決済済みの取引の記録
    this._nextId = 1;
  }

  // ── 値段の計算 ──

  halfSpread(ccy) {
    return (this.config.currencies[ccy].spread ?? 0) / 2;
  }

  // 新規に建てるときの値段（買いは高いほう、売りは安いほう）
  entryPrice(ccy, side, mid) {
    return side === "buy" ? mid + this.halfSpread(ccy) : mid - this.halfSpread(ccy);
  }

  // 決済するときの値段（買いポジションは売って閉じるので安いほう）
  exitPrice(pos, mid) {
    return pos.side === "buy" ? mid - this.halfSpread(pos.ccy) : mid + this.halfSpread(pos.ccy);
  }

  unrealized(pos, mid) {
    const dir = pos.side === "buy" ? 1 : -1;
    return (this.exitPrice(pos, mid) - pos.entryPrice) * pos.units * dir;
  }

  effectiveLeverage(pos, date) {
    return Math.min(pos.leverage, maxLeverage(date, this.config));
  }

  requiredMargin(pos, mid, date) {
    return (pos.units * mid) / this.effectiveLeverage(pos, date);
  }

  // 口座の状態
  status(prices, date) {
    let pnl = 0;
    let required = 0;
    for (const pos of this.positions) {
      pnl += this.unrealized(pos, prices[pos.ccy]);
      required += this.requiredMargin(pos, prices[pos.ccy], date);
    }
    const equity = this.cash + pnl;
    const free = equity - required;
    return {
      cash: this.cash,
      unrealized: pnl,
      equity,
      required,
      ratio: required > 0 ? equity / required : Infinity,
      free,
      available: Math.max(0, Math.min(this.cash, free)),
      maxLeverage: maxLeverage(date, this.config),
    };
  }

  // ── 注文 ──

  // order: { ccy, side: "buy"|"sell", units, leverage, stopLoss?, takeProfit? }
  open(order, prices, date) {
    const { ccy, side, units, leverage } = order;
    const stopLoss = order.stopLoss ?? null;
    const takeProfit = order.takeProfit ?? null;
    const fx = this.config.fx;
    const cap = maxLeverage(date, this.config);
    const mid = prices[ccy];

    if (mid == null || !this.config.currencies[ccy]) return fail("この通貨は取引できません");
    if (side !== "buy" && side !== "sell") return fail("売買の指定が正しくありません");
    if (!Number.isInteger(units) || units < fx.minUnits || units % fx.unitStep !== 0) {
      return fail(`数量は${fx.minUnits.toLocaleString()}以上、${fx.unitStep.toLocaleString()}単位で指定してください`);
    }
    if (!(leverage >= 1)) return fail("レバレッジは1倍以上にしてください");
    if (leverage > cap) return fail(`この時代のレバレッジ上限は${cap}倍です`);

    const entry = this.entryPrice(ccy, side, mid);
    const check = checkOrderLevels(side, entry, stopLoss, takeProfit);
    if (check) return fail(check);

    // 建てた直後に、スプレッドの分だけ含み損が出る。それを含めて余力が足りるか
    const required = (units * mid) / leverage;
    const spreadCost = units * this.halfSpread(ccy) * 2;
    const st = this.status(prices, date);
    if (st.free - required - spreadCost < 0) {
      return fail(`証拠金が足りません（必要 ${yen(required + spreadCost)}／余力 ${yen(Math.max(0, st.free))}）`);
    }

    const position = {
      id: this._nextId++,
      ccy,
      side,
      units,
      leverage,
      entryPrice: entry,
      stopLoss,
      takeProfit,
      openedAt: date,
      swapTotal: 0,
    };
    this.positions.push(position);
    return { ok: true, position };
  }

  // 逆指値・指値を付け直す（null で取り消し）
  setOrders(id, { stopLoss = null, takeProfit = null }) {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) return fail("ポジションが見つかりません");
    const check = checkOrderLevels(pos.side, pos.entryPrice, stopLoss, takeProfit, true);
    if (check) return fail(check);
    pos.stopLoss = stopLoss;
    pos.takeProfit = takeProfit;
    return { ok: true, position: pos };
  }

  close(id, prices, date, reason = "manual") {
    const index = this.positions.findIndex((p) => p.id === id);
    if (index < 0) return null;
    const pos = this.positions[index];
    const mid = prices[pos.ccy];
    const pnl = this.unrealized(pos, mid);
    this.cash += pnl;
    this.positions.splice(index, 1);
    const record = { ...pos, exitPrice: this.exitPrice(pos, mid), closedAt: date, pnl, reason };
    this.closed.push(record);
    return record;
  }

  closeAll(prices, date, reason = "manual") {
    return [...this.positions].map((p) => this.close(p.id, prices, date, reason));
  }

  // ── 時間経過で起きること（clock.js から呼ぶ） ──

  // 逆指値・指値に触れたポジションを決済する。約定はその時点の値段（滑ることがある）
  checkOrders(prices, date) {
    const events = [];
    for (const pos of [...this.positions]) {
      const px = this.exitPrice(pos, prices[pos.ccy]);
      const isBuy = pos.side === "buy";
      let reason = null;
      if (pos.stopLoss != null && (isBuy ? px <= pos.stopLoss : px >= pos.stopLoss)) reason = "stopLoss";
      else if (pos.takeProfit != null && (isBuy ? px >= pos.takeProfit : px <= pos.takeProfit)) reason = "takeProfit";
      if (reason) events.push({ type: reason, record: this.close(pos.id, prices, date, reason) });
    }
    return events;
  }

  // 証拠金維持率が基準を下回ったら、全ポジションを強制決済する
  checkLosscut(prices, date) {
    if (this.positions.length === 0) return null;
    const st = this.status(prices, date);
    if (st.ratio >= this.config.fx.losscutRatio) return null;
    const records = this.closeAll(prices, date, "losscut");
    return { type: "losscut", ratio: st.ratio, records, cashAfter: this.cash };
  }

  // 1日分のスワップを精算する（暦日ごと。受け取りは控えめ、支払いは重め）
  accrueSwap(prices) {
    const fx = this.config.fx;
    const jpyRate = this.config.currencies.JPY.interestRate;
    let total = 0;
    for (const pos of this.positions) {
      const rate = this.config.currencies[pos.ccy].interestRate;
      const diff = pos.side === "buy" ? rate - jpyRate : jpyRate - rate;
      const raw = (pos.units * prices[pos.ccy] * diff) / 365;
      const amount = raw > 0 ? raw * fx.swapReceiveFactor : raw * fx.swapPayFactor;
      pos.swapTotal += amount;
      total += amount;
    }
    this.cash += total;
    return total;
  }

  // ── 町での支払い・受け取り（円） ──

  spend(amountYen, prices, date) {
    const st = this.status(prices, date);
    if (amountYen > st.available) return fail(`資金が足りません（使える額 ${yen(st.available)}）`);
    this.cash -= amountYen;
    return { ok: true };
  }

  receive(amountYen) {
    this.cash += amountYen;
  }

  // ポジションがなく、現金が少なすぎて立て直せない状態（基準は仮）
  isBankrupt() {
    return this.positions.length === 0 && this.cash < this.config.fx.bankruptcyThreshold;
  }
}

// ── 補助 ──

function fail(message) {
  return { ok: false, error: message };
}

function yen(v) {
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
}

// 逆指値・指値の位置が正しいか（買いなら 損切り < 建値 < 利確）
function checkOrderLevels(side, entry, stopLoss, takeProfit, existing = false) {
  const isBuy = side === "buy";
  // 既存ポジションの逆指値は、利益を守る位置（建値より上）に動かしてもよい
  if (!existing && stopLoss != null && (isBuy ? stopLoss >= entry : stopLoss <= entry)) {
    return isBuy ? "買いの損切りは、建値より下に置いてください" : "売りの損切りは、建値より上に置いてください";
  }
  if (takeProfit != null && stopLoss != null && (isBuy ? takeProfit <= stopLoss : takeProfit >= stopLoss)) {
    return "利確と損切りの位置が逆になっています";
  }
  if (!existing && takeProfit != null && (isBuy ? takeProfit <= entry : takeProfit >= entry)) {
    return isBuy ? "買いの利確は、建値より上に置いてください" : "売りの利確は、建値より下に置いてください";
  }
  return null;
}
