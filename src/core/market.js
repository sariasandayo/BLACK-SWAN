// 相場エンジン：過去データの参照と、日中の値動きの補間（ブラウニアン・ブリッジ）
//
// 時間の考え方：
//   ゲーム内の日付 D にいるとき、相場は「D の終値」が確定した状態。
//   1日進めると D+1 に移り、D+1 の日中の動き（前営業日の終値 → D+1 の終値）が再生される。
//   データにない日（土日・ECBの休業日）は相場が動かない。
//
// 日中の動きは演出で、実データと一致するのは各日の終値だけ。
// ただし同じシード・同じ日なら毎回同じ動きになるので、表示と逆指値の約定がずれない。

import { CONFIG } from "../config.js";
import { createRng } from "./rng.js";
import { addDays } from "./calendar.js";

export class Market {
  constructor(data, { seed = "default", config = CONFIG } = {}) {
    this.config = config;
    this.seed = String(seed);
    this.dates = data.dates;
    this.rates = data.rates;
    // データと設定の両方にある通貨だけを使う
    this.currencies = Object.keys(config.currencies).filter((c) => c !== "JPY" && data.rates[c]);
    this.indexOf = new Map(this.dates.map((d, i) => [d, i]));
    this.firstDate = this.dates[0];
    this.lastDate = this.dates[this.dates.length - 1];
    this._pathCache = new Map();
  }

  get steps() {
    return this.config.market.intradaySteps;
  }

  isTradingDay(date) {
    return this.indexOf.has(date);
  }

  // date 以前で最も近い営業日の番号（なければ -1）
  indexAtOrBefore(date) {
    let lo = 0;
    let hi = this.dates.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  // date 時点で確定している終値（休みの日は直前の営業日の終値）
  close(ccy, date) {
    const i = this.indexAtOrBefore(date);
    if (i < 0) throw new Error(`${date} より前のデータがありません`);
    return this.rates[ccy][i];
  }

  // 直前の営業日からの変化（表示用）
  dayChange(ccy, date) {
    const i = this.indexAtOrBefore(date);
    if (i <= 0) return { change: 0, pct: 0 };
    const now = this.rates[ccy][i];
    const prev = this.rates[ccy][i - 1];
    return { change: now - prev, pct: (now - prev) / prev };
  }

  // i 番目の営業日時点の、1日あたりの変動率（直近の対数変化率の二乗平均平方根）
  dailyVol(ccy, i) {
    const n = this.config.market.volLookback;
    const series = this.rates[ccy];
    let sum = 0;
    let count = 0;
    for (let k = Math.max(1, i - n + 1); k <= i; k++) {
      const r = Math.log(series[k] / series[k - 1]);
      sum += r * r;
      count++;
    }
    return count >= 5 ? Math.sqrt(sum / count) : this.config.market.defaultDailyVol;
  }

  // その日の日中の値動き（steps+1 個。先頭が前営業日の終値、末尾がその日の終値）
  intradayPath(ccy, date) {
    const key = `${ccy}|${date}`;
    const cached = this._pathCache.get(key);
    if (cached) return cached;

    const steps = this.steps;
    const path = new Float64Array(steps + 1);
    const i = this.indexOf.get(date);

    if (i === undefined || i === 0) {
      path.fill(this.close(ccy, date)); // 休みの日は動かない
    } else {
      const p0 = this.rates[ccy][i - 1];
      const p1 = this.rates[ccy][i];
      const sigma = this.dailyVol(ccy, i) * this.config.market.intradayVolScale;
      const rng = createRng(`${this.seed}|${ccy}|${date}`);
      const sq = Math.sqrt(1 / steps);
      const w = new Float64Array(steps + 1);
      for (let s = 1; s <= steps; s++) w[s] = w[s - 1] + rng.normal() * sq;
      const l0 = Math.log(p0);
      const l1 = Math.log(p1);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // 始点と終点を実データに固定したランダムな揺れ
        path[s] = Math.exp(l0 + t * (l1 - l0) + sigma * (w[s] - t * w[steps]));
      }
      path[0] = p0;
      path[steps] = p1;
    }

    if (this._pathCache.size > 5000) this._pathCache.clear();
    this._pathCache.set(key, path);
    return path;
  }

  // ある日のある時点の仲値（step 省略時はその日の終値）
  priceAt(ccy, date, step = this.steps) {
    return this.intradayPath(ccy, date)[step];
  }

  // 全通貨の仲値 { USD: 150.12, ... }
  midPrices(date, step = this.steps) {
    const out = {};
    for (const c of this.currencies) out[c] = this.priceAt(c, date, step);
    return out;
  }

  // 売値・買値（プレイヤーが売るときは bid、買うときは ask）
  quote(ccy, mid) {
    const half = (this.config.currencies[ccy].spread ?? 0) / 2;
    return { bid: mid - half, ask: mid + half };
  }

  // チャート用：endDate 以前の直近 count 営業日の終値
  history(ccy, endDate, count) {
    const end = this.indexAtOrBefore(endDate);
    const start = Math.max(0, end - count + 1);
    const out = [];
    for (let i = start; i <= end; i++) out.push({ date: this.dates[i], close: this.rates[ccy][i] });
    return out;
  }

  // 周回の開始日の候補（変動率の推定に足りる過去があり、期日がデータ内に収まる営業日）
  // 将来「値動きのある期間の候補リスト」に置き換える
  candidateStartDates(lengthDays) {
    const minIndex = this.config.market.volLookback;
    const out = [];
    for (let i = minIndex; i < this.dates.length; i++) {
      if (addDays(this.dates[i], lengthDays) <= this.lastDate) out.push(this.dates[i]);
    }
    return out;
  }

  pickStartDate(rng, lengthDays) {
    const list = this.candidateStartDates(lengthDays);
    if (list.length === 0) throw new Error("周回に使える期間がありません");
    return rng.pick(list);
  }
}
