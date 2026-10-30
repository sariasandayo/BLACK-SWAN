// ゲーム内時間を進める。相場の日中の動きを1コマずつ再生しながら、
// 逆指値・指値・ロスカットを判定し、1日の終わりにスワップを精算する。
//
// 出撃や偵察で日数を消費するときも、ここを呼ぶ。
// 計算は一瞬で終わり、画面ではその記録（advanceDaysWithFrames の frames）を
// あとから早送り再生する。計算と表示を分けておくことで、自動プレイでも同じ計算を使える。

import { addDays } from "./calendar.js";
import { maxLeverage } from "./fx-account.js";

// onStep(step, prices, date) を渡すと、コマごとに呼ばれる
export function advanceDay(market, account, date, { onStep } = {}) {
  const next = addDays(date, 1);
  const events = [];

  const capBefore = maxLeverage(date, account.config);
  const capAfter = maxLeverage(next, account.config);
  if (capAfter < capBefore) events.push({ type: "regulation", date: next, from: capBefore, to: capAfter });

  if (market.isTradingDay(next)) {
    for (let s = 1; s <= market.steps; s++) {
      const prices = market.midPrices(next, s);
      for (const ev of account.checkOrders(prices, next)) events.push({ ...ev, date: next, step: s });
      const lc = account.checkLosscut(prices, next);
      if (lc) events.push({ ...lc, date: next, step: s });
      if (onStep) onStep(s, prices, next);
    }
  }

  const closePrices = market.midPrices(next);
  const swap = account.accrueSwap(closePrices);
  if (swap !== 0) events.push({ type: "swap", date: next, amount: swap });

  // 土日でもスワップの支払いや規制の変更で維持率が下がることがあるので、日の終わりにも確認する
  const lc = account.checkLosscut(closePrices, next);
  if (lc) events.push({ ...lc, date: next, step: market.steps });

  return { date: next, events };
}

export function advanceDays(market, account, date, days, options = {}) {
  let current = date;
  const events = [];
  for (let i = 0; i < days; i++) {
    const r = advanceDay(market, account, current, options);
    current = r.date;
    events.push(...r.events);
  }
  return { date: current, events };
}

// 時間を進めながら、コマごとの相場と口座の様子を記録する（出撃中の再生用）
// frames[i] = { date, step, trading, prices, status, positions, events }
//   step: その日の何コマ目か（0 = 前日の終わり、休場日は1コマだけ）
export function advanceDaysWithFrames(market, account, date, days) {
  const snapshot = (d, step, prices, trading) => ({
    date: d,
    step,
    trading,
    prices,
    status: account.status(prices, d),
    positions: account.positions.map((p) => ({
      id: p.id,
      ccy: p.ccy,
      side: p.side,
      units: p.units,
      entryPrice: p.entryPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      pnl: account.unrealized(p, prices[p.ccy]),
    })),
    events: [],
  });

  const frames = [snapshot(date, 0, market.midPrices(date), false)];
  const events = [];
  let current = date;

  for (let i = 0; i < days; i++) {
    const dayFrames = [];
    const r = advanceDay(market, account, current, {
      onStep: (step, prices, d) => dayFrames.push(snapshot(d, step, prices, true)),
    });
    // 休場日は1コマだけ。営業日でも、日の終わりのスワップを反映した状態に最後のコマを差し替える
    const endPrices = market.midPrices(r.date);
    const end = snapshot(r.date, market.steps, endPrices, dayFrames.length > 0);
    if (dayFrames.length) dayFrames[dayFrames.length - 1] = end;
    else dayFrames.push(end);

    // 出来事を、起きたコマに割り当てる（コマの指定がないものはその日の最後）
    for (const ev of r.events) {
      const frame = (ev.step && dayFrames.find((f) => f.step === ev.step)) || dayFrames[dayFrames.length - 1];
      frame.events.push(ev);
    }
    frames.push(...dayFrames);
    events.push(...r.events);
    current = r.date;
  }
  return { date: current, events, frames };
}
