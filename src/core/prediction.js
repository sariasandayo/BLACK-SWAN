// 勝率予測：同じ条件の任務（または戦闘）を裏で何百回も行い、結果を集計する
// 設定上は「主人公の未来の端末による分析」

import { CONFIG } from "../config.js";
import { MissionRun } from "./mission-run.js";

// 任務の予測（敵の編成が分かっているとき＝偵察済み）
//   stages … 戦闘ごとの敵の配列の配列。戦闘1回だけなら setup.enemies を使う
export function predict(setup, { runs, seed = "predict", config = CONFIG, stages } = {}) {
  runs ??= config.battle.predictionRuns;
  stages ??= [setup.enemies];
  const out = { win: 0, retreat: 0, wipe: 0 };
  const costs = [];
  let seconds = 0;
  let ammoShort = 0;
  let medkits = 0;
  let cleared = 0;
  const used = Object.fromEntries(Object.keys(config.ammoTypes).map((k) => [k, 0]));
  const down = Object.fromEntries(setup.allies.map((a, i) => [a.id ?? `a${i}`, 0]));

  for (let i = 0; i < runs; i++) {
    const r = new MissionRun(setup, stages, { seed: `${seed}|${i}`, config }).runAll();
    out[r.outcome]++;
    costs.push(r.costBase);
    seconds += r.seconds;
    cleared += r.stagesCleared;
    if (r.fallbackShots > 0) ammoShort++;
    medkits += r.usedMedkits;
    for (const k in used) used[k] += r.used[k];
    for (const id of r.fallen) down[id]++;
  }

  costs.sort((a, b) => a - b);
  const pct = (p) => costs[Math.min(costs.length - 1, Math.floor(p * costs.length))];
  return {
    runs,
    stageCount: stages.length,
    winRate: out.win / runs, // すべての戦闘に勝つ確率
    retreatRate: out.retreat / runs, // 撤退・時間切れ
    wipeRate: out.wipe / runs, // 全滅（主人公以外を失う）
    avgStagesCleared: cleared / runs,
    avgSeconds: seconds / runs,
    avgCostBase: costs.reduce((s, c) => s + c, 0) / runs, // 弾薬費＋医薬品代
    p90CostBase: pct(0.9),
    maxCostBase: costs[costs.length - 1],
    ammoShortRate: ammoShort / runs, // 弾切れが起きた割合
    avgMedkits: medkits / runs, // 使う医薬品の平均
    avgUsed: Object.fromEntries(Object.entries(used).map(([k, n]) => [k, n / runs])),
    downRisk: Object.fromEntries(Object.entries(down).map(([k, n]) => [k, n / runs])), // 戦闘不能になる割合
  };
}

// 敵の編成が分からないとき（偵察前）：ありそうな編成ごとに予測する
//   candidates … stages の配列（戦闘1回分の敵の配列を渡すと、戦闘1回の任務として扱う）
//   winRate … 編成が分からないことも含めた勝率（全候補の平均）。これが「実際の確率」の見積もり
//   winLow〜winHigh … 編成しだいでどれくらい変わるか（候補の下位25%〜上位25%）
export function predictRange(baseSetup, candidates, { runs, seed = "range", config = CONFIG } = {}) {
  runs ??= config.battle.predictionRuns;
  const per = Math.max(4, Math.round(runs / candidates.length));
  const results = candidates.map((c, i) => {
    const stages = Array.isArray(c[0]) ? c : [c];
    return predict(baseSetup, { runs: per, seed: `${seed}|${i}`, config, stages });
  });
  const wins = results.map((r) => r.winRate).sort((a, b) => a - b);
  // 線形補間した分位点
  const q = (p) => {
    const x = p * (wins.length - 1);
    const i = Math.floor(x);
    return i + 1 < wins.length ? wins[i] + (wins[i + 1] - wins[i]) * (x - i) : wins[i];
  };
  const avg = (key) => results.reduce((s, r) => s + r[key], 0) / results.length;
  const avgUsed = {};
  for (const k of Object.keys(config.ammoTypes)) avgUsed[k] = results.reduce((s, r) => s + r.avgUsed[k], 0) / results.length;
  const downRisk = {};
  for (const id of Object.keys(results[0].downRisk)) downRisk[id] = results.reduce((s, r) => s + r.downRisk[id], 0) / results.length;
  return {
    winLow: q(0.25),
    winHigh: q(0.75),
    winRate: avg("winRate"),
    retreatRate: avg("retreatRate"),
    wipeRate: avg("wipeRate"),
    avgStagesCleared: avg("avgStagesCleared"),
    avgSeconds: avg("avgSeconds"),
    avgCostBase: avg("avgCostBase"),
    maxCostBase: Math.max(...results.map((r) => r.maxCostBase)),
    ammoShortRate: avg("ammoShortRate"),
    avgMedkits: avg("avgMedkits"),
    avgUsed,
    downRisk,
  };
}
