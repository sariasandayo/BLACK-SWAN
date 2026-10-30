// FXの手がかり：記憶の断片と、偵察・東京で聞く噂
//
// どちらも相場データ（実際の値動き）から作るので、データとずれない。
//   記憶の断片：周回の期間中に起きる実際の出来事を、一定の確率で思い出す（思い出したものは正確。時期は旬まで）。
//               相場への影響は、出来事の前日から effectDays 日後までの実際の変化から文章にする
//   偵察の噂：その都市の通貨が、この先 days 日で上がるか下がるか。accuracy の確率で正しい
// 通貨の名前は config の currencies.name を使う

import { CONFIG } from "../config.js";
import { EVENTS } from "../data/events.js";
import { addDays, daysBetween } from "./calendar.js";
import { createRng } from "./rng.js";

const ccyName = (c, config) => config.currencies[c]?.name ?? c;

// 「9月中旬」のようなぼかした時期
export function fuzzyWhen(date) {
  const [, m, d] = date.split("-").map(Number);
  const part = d <= 10 ? "上旬" : d <= 20 ? "中旬" : "下旬";
  return `${m}月${part}`;
}

// ぼかした時期（旬）の最初と最後の日
export function fuzzyPeriod(date) {
  const [y, m, d] = date.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const [a, b] = d <= 10 ? [1, 10] : d <= 20 ? [11, 20] : [21, last];
  return { from: `${y}-${pad(m)}-${pad(a)}`, to: `${y}-${pad(m)}-${pad(b)}` };
}

// 出来事の相場への影響を、データから計算して文章にする
export function eventEffect(market, date, config = CONFIG) {
  const h = config.hints.memory;
  const before = addDays(date, -1);
  const after = addDays(date, h.effectDays);
  if (before < market.firstDate || after > market.lastDate) return null;
  const moves = {};
  for (const c of market.currencies) moves[c] = Math.log(market.close(c, after) / market.close(c, before));
  return { moves, text: describeMoves(moves, config) };
}

// 通貨ごとの動き（対数の変化）→ 記憶の文
export function describeMoves(moves, config = CONFIG) {
  const big = config.hints.memory.bigMove;
  const vals = Object.values(moves);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg <= -big) return "円が大きく買われ、ほかの通貨はそろって円に対して下がった気がする。";
  if (avg >= big) return "円が大きく売られ、ほかの通貨はそろって円に対して上がった気がする。";
  const [c, mv] = Object.entries(moves).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (Math.abs(mv) >= big) return `${ccyName(c, config)}が円に対して大きく${mv > 0 ? "上がった" : "下がった"}気がする。`;
  if (Math.abs(avg) >= big / 2) return `円が${avg < 0 ? "やや買われた" : "やや売られた"}気がする。`;
  return "為替はそれほど動かなかった気がする。";
}

// 周回の期間に起きた出来事（すべて）。答え合わせにも使う
//   名前のある出来事（events.js）と、名前のない大きな値動き（bigMove 以上。ほかの出来事と gapDays 以上離れたもの）
//   effect：出来事の前日〜effectDays 日後の、実際の値動きの文。moves：通貨ごとの変化（対数）
export function eventsInRange(market, start, deadline, config = CONFIG) {
  const h = config.hints.memory;
  const out = [];
  for (const ev of EVENTS) {
    if (ev.date <= start || ev.date > deadline) continue;
    // 同じ日の出来事は1つにまとめる
    const same = out.find((o) => o.date === ev.date);
    if (same) {
      same.title += `／${ev.title}`;
      same.memory += ev.memory;
      continue;
    }
    const eff = eventEffect(market, ev.date, config);
    if (!eff) continue;
    out.push({ date: ev.date, when: fuzzyWhen(ev.date), title: ev.title, memory: ev.memory, effect: eff.text, moves: eff.moves, named: true });
  }
  const windows = [];
  for (let d = addDays(start, 1); addDays(d, h.effectDays) <= deadline; d = addDays(d, 1)) {
    if (addDays(d, h.effectDays) > market.lastDate) break;
    for (const c of market.currencies) {
      const mv = Math.log(market.close(c, addDays(d, h.effectDays)) / market.close(c, addDays(d, -1)));
      if (Math.abs(mv) >= h.bigMove) windows.push({ date: d, ccy: c, mv });
    }
  }
  windows.sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv));
  for (const w of windows) {
    if (out.some((o) => Math.abs(daysBetween(o.date, w.date)) < h.gapDays)) continue;
    const eff = eventEffect(market, w.date, config);
    out.push({
      date: w.date, when: fuzzyWhen(w.date), title: null,
      memory: null, // 何が起きたかには触れない（値動きだけを覚えている）
      effect: eff.text, moves: eff.moves, named: false,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const o of out) o.period = fuzzyPeriod(o.date);
  return out;
}

// 記憶の断片：周回の期間の出来事のうち、recallChance の確率で思い出すもの
//   思い出したものは正確（影響の向きは実際どおり）。時期は旬までしか分からない
//   recallAt：思い出す日（出来事の recallDays 日前。周回の初日より前なら初日）
export function memoriesFor(market, start, deadline, config = CONFIG, seed = "") {
  const h = config.hints.memory;
  const out = [];
  for (const ev of eventsInRange(market, start, deadline, config)) {
    if (createRng(`${seed}|recall|${ev.date}`).next() >= h.recallChance) continue;
    const r = addDays(ev.date, -h.recallDays);
    out.push({ ...ev, recallAt: r < start ? start : r });
  }
  return out;
}

// 偵察の噂：その都市の通貨の、この先 days 日の向き
export function scoutHint(market, ccy, date, seed, config = CONFIG, h = config.hints.scout) {
  const until = addDays(date, h.days);
  if (until > market.lastDate) return null;
  const move = Math.log(market.close(ccy, until) / market.close(ccy, date));
  const right = createRng(`${seed}|hint|${ccy}|${date}`).next() < h.accuracy;
  const up = (move > 0) === right;
  const strong = Math.abs(move) > 0.02;
  return {
    ccy,
    from: date,
    until,
    up,
    strong,
    text: `${ccyName(ccy, config)}は、${fuzzyWhen(until)}ごろまでに円に対して${strong ? "大きく" : ""}${up ? "上がりそう" : "下がりそう"}だ。`,
  };
}

// 東京で集める噂：円全体の、この先 days 日の向き（4通貨の変化の平均。accuracy の確率で正しい）
//   up は「円が上がる（円高）」。どの通貨で取引するかは、プレイヤーが決める
export function yenHint(market, date, seed, config = CONFIG, h = config.hints.tokyo) {
  const until = addDays(date, h.days);
  if (until > market.lastDate) return null;
  const moves = market.currencies.map((c) => Math.log(market.close(c, until) / market.close(c, date)));
  const move = moves.reduce((a, b) => a + b, 0) / moves.length; // 外貨の平均の変化（マイナスなら円高）
  const right = createRng(`${seed}|yen|${date}`).next() < h.accuracy;
  const up = (move < 0) === right;
  const strong = Math.abs(move) > 0.02;
  return {
    ccy: "JPY",
    from: date,
    until,
    up,
    strong,
    text: `円は、${fuzzyWhen(until)}ごろまでに、ほかの通貨に対して全体に${strong ? "大きく" : ""}${up ? "上がりそう（円高）" : "下がりそう（円安）"}だ。`,
  };
}
