// 任務（歪みの発生した都市での討伐依頼）の生成
//
// 任務は1〜3回の戦闘（stages）からなる。規模（tier）ごとに、戦闘の回数・1戦ごとの敵の重さ・日数の範囲が決まっていて、
// その中でランダムに中身が決まる。敵は都市ごとの出やすさに従って選ぶ。
// 報酬は現地通貨建てで、受注した時点で確定する（円換算は受け取り時）。
// 敵のレベルは Game が決めて渡す（日が経つほど上がる）。

import { CONFIG } from "../config.js";
import { createRng } from "./rng.js";

//   level：敵のレベル（Game が日付・規模・ばらつきから決める）。報酬もレベルで上がる
export function generateMission(seed, cityId, tier, config = CONFIG, { budgetScale = 1, level = 1 } = {}) {
  const rng = createRng(String(seed));
  const city = config.cities.find((c) => c.id === cityId);
  if (!city) throw new Error(`都市 ${cityId} がありません`);
  const tierDef = config.missionTiers.find((t) => t.tier === tier);
  if (!tierDef) throw new Error(`規模 ${tier} がありません`);
  const factor = config.currencies[city.currency].priceFactor ?? 1;
  const days = rng.int(tierDef.days[0], tierDef.days[1]);
  const count = rng.int(tierDef.stageCount[0], tierDef.stageCount[1]);
  const budgets = Array.from({ length: count }, () => Math.round(rng.int(tierDef.stageBudget[0], tierDef.stageBudget[1]) * budgetScale));
  const stages = budgets.map((budget) => rollEnemies(rng, city, tier, budget, config));
  const total = budgets.reduce((a, b) => a + b, 0);

  return {
    seed: String(seed),
    cityId,
    cityName: city.name,
    currency: city.currency,
    tier,
    tierName: tierDef.name,
    level,
    days,
    budgets,
    // 敵が多いほど、日数が長いほど報酬が上がる。遠い都市（rewardFactor）は上乗せ
    rewardLocal: Math.round(
      tierDef.rewardPerPoint * total * factor * (city.rewardFactor ?? 1) * (days / tierDef.days[0]) ** 0.5 * (1 + config.levels.rewardPerLevel * (level - 1)),
    ),
    stages,
    // 全戦闘の敵（表示用）
    enemies: stages.flat(),
  };
}

// 偵察前に「ありそうな編成」をいくつか作る（勝率予測に幅を持たせるため）。戻り値は stages の配列
// 戦闘の回数と日数は掲示で分かっているので、そのまま。敵の顔ぶれだけ推測する
export function plausibleStageSets(mission, count, config = CONFIG) {
  const city = config.cities.find((c) => c.id === mission.cityId);
  const sets = [];
  for (let i = 0; i < count; i++) {
    const rng = createRng(`${mission.seed}|guess|${i}`);
    sets.push(mission.budgets.map((budget) => rollEnemies(rng, city, mission.tier, budget, config)));
  }
  return sets;
}

// 旧形式（戦闘1回分の敵の配列）。戦闘ラボなどで使う
export function plausibleEnemySets(mission, count, config = CONFIG) {
  return plausibleStageSets(mission, count, config).map((stages) => stages.flat());
}

// 編成を { 型: 数 } にまとめる（表示用）
export function composition(enemies) {
  const out = {};
  for (const e of enemies) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

function rollEnemies(rng, city, tier, budgetTotal, config) {
  const types = Object.entries(config.enemyTypes).filter(
    ([k, def]) => !def.boss && (def.minTier ?? 1) <= tier && (city.enemyWeights[k] ?? 0) > 0,
  );
  const enemies = [];
  let budget = budgetTotal;
  const cheapest = Math.min(...types.map(([, d]) => d.points * (d.pack ? d.pack[0] : 1)));

  for (let guard = 0; guard < 60 && budget >= cheapest; guard++) {
    const affordable = types.filter(([, d]) => d.points * (d.pack ? d.pack[0] : 1) <= budget);
    if (affordable.length === 0) break;
    const [type, def] = weightedPick(rng, affordable, ([k]) => city.enemyWeights[k]);
    const count = def.pack ? Math.min(rng.int(def.pack[0], def.pack[1]), Math.floor(budget / def.points)) : 1;
    for (let i = 0; i < count; i++) enemies.push({ type });
    budget -= def.points * count;
  }
  // 硬い敵が前に来るように並べる（群れは後ろ）
  const order = { armored: 0, phase: 1, regen: 2, swarm: 3 };
  enemies.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  return enemies;
}

function weightedPick(rng, items, weightOf) {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let r = rng.next() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r < 0) return it;
  }
  return items[items.length - 1];
}
