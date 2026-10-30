// 任務の実行：複数の戦闘を順に行う
//
// 戦闘と戦闘の間に、生き残った仲間は少し回復する（stageRecovery）。
// 弾と医薬品は持ち越し。戦闘不能になった仲間は、その任務の残りの戦闘には出られない。
// 途中で撤退・時間切れになったら、そこで任務は終わる。
//
// 使い方（画面で再生するとき）:
//   const run = new MissionRun(setup, stages, { seed, record: true });
//   run.battle.step() … いまの戦闘を進める
//   run.battle.done で、次へ進めるなら run.nextStage()
//   run.done になったら run.result()
// 一気に計算するとき（勝率予測）: run.runAll()

import { CONFIG } from "../config.js";
import { Battle, ammoCostBase } from "./battle.js";

export class MissionRun {
  constructor(setup, stages, { seed = "mission", config = CONFIG, record = false } = {}) {
    this.config = config;
    this.setup = setup;
    this.stages = stages;
    this.seed = String(seed);
    this.record = record;
    this.stageIndex = 0;
    this.ammo = { ...setup.ammo };
    this.medkits = setup.medkits ?? 0;
    this.policy = setup.policy || "smart";
    this.hp = {}; // 仲間ごとの体力（戦闘の間で持ち越す）
    this.fallen = new Set(); // この任務で戦闘不能になった仲間
    this.battles = [];
    this.done = false;
    this.outcome = null;
    this.battle = this.makeBattle();
  }

  makeBattle() {
    // 奇襲（setup.ambush）：最初の戦闘だけ威力が上がる
    const bonus = this.stageIndex === 0 ? (this.setup.ambush ?? 0) : 0;
    const allies = this.setup.allies
      .filter((a) => !this.fallen.has(a.id))
      .map((a) => ({ ...a, hp: this.hp[a.id], damageBonus: (a.damageBonus ?? 0) + bonus }));
    const b = new Battle(
      { ...this.setup, allies, enemies: this.stages[this.stageIndex], ammo: this.ammo, medkits: this.medkits, policy: this.policy },
      { seed: `${this.seed}|${this.stageIndex}`, config: this.config, record: this.record },
    );
    this.battles.push(b);
    return b;
  }

  get stageCount() {
    return this.stages.length;
  }

  // いまの戦闘が終わったあとの処理。次の戦闘があれば準備して true を返す
  nextStage() {
    const b = this.battle;
    if (!b.done) throw new Error("戦闘が終わっていません");
    const r = b.result();
    this.ammo = { ...r.ammoLeft };
    this.medkits = r.medkitsLeft;
    this.policy = b.policy; // 戦闘中に方針を変えたら、それを引き継ぐ
    const rec = this.setup.stageRecovery ?? this.config.battle.stageRecovery;
    for (const a of b.allies) {
      if (!a.alive) this.fallen.add(a.id);
      else this.hp[a.id] = Math.min(a.maxHp, a.hp + a.maxHp * rec);
    }
    if (r.outcome !== "win") {
      this.finish(r.outcome === "wipe" ? "wipe" : "retreat");
      return false;
    }
    if (this.stageIndex + 1 >= this.stages.length) {
      this.finish("win");
      return false;
    }
    this.stageIndex++;
    this.battle = this.makeBattle();
    return true;
  }

  finish(outcome) {
    this.done = true;
    this.outcome = outcome;
  }

  runAll() {
    while (!this.done) {
      this.battle.run();
      this.nextStage();
    }
    return this.result();
  }

  result() {
    const used = Object.fromEntries(Object.keys(this.config.ammoTypes).map((k) => [k, 0]));
    let usedMedkits = 0;
    let seconds = 0;
    let fallbackShots = 0;
    let killedPoints = 0;
    const stageResults = [];
    for (const b of this.battles) {
      const r = b.result();
      for (const k in used) used[k] += r.used[k];
      usedMedkits += r.usedMedkits;
      seconds += r.seconds;
      fallbackShots += r.fallbackShots;
      killedPoints += r.killedPoints;
      stageResults.push({ outcome: r.outcome, seconds: r.seconds });
    }
    const stagesCleared = stageResults.filter((r) => r.outcome === "win").length;
    return {
      outcome: this.outcome,
      stagesCleared,
      stageCount: this.stages.length,
      stageResults,
      seconds,
      used,
      usedMedkits,
      costBase: ammoCostBase(used, this.config) + usedMedkits * this.config.supplies.medkit.price,
      fallbackShots,
      killedPoints, // 倒した敵の重さの合計（羽根の数の計算に使う）
      fallen: [...this.fallen],
    };
  }
}
