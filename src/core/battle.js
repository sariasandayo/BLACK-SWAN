// 戦闘エンジン（画面に依存しない）
//
// 使い方:
//   const b = new Battle(setup, { seed });
//   b.run()             … 最後まで一気に計算（勝率予測・自動プレイ用）
//   b.step()            … 1コマ（0.1秒）進める（画面で再生するとき用）
//   b.retreat()         … 撤退（いつでも可）
//   b.setPolicy("smart")… 弾の方針を切り替える
//
// setup = {
//   allies:  [{ id, name?, role, weapon, row: "front"|"back", traits?: [], level?: 1, weaponLevel?: 1, damageBonus?: 0, hp? }],
//            … level は仲間のレベル（体力・命中・回避・速さ）、weaponLevel は持っている銃のレベル（攻撃力）
//            … hp を渡すと、その体力から始まる（任務の2戦目以降）
//   enemies: [{ type }],                      … 敵の並び（先頭から狙われる）
//   ammo:    { normal: 300, ap: 60, ... },    … 持っていく弾の数（発）。部隊で共用
//   medkits: 10,                              … 医薬品の数。衛生兵が1回回復するごとに1個使う
//   policy:  "smart" | "allOut" | "normalFirst",
//   retreatLine: 0.3,                         … 仲間ごとの撤退ライン：体力がこの割合を下回った仲間は、すぐに戦闘から退く（倒れない。0で無効）
//                                               こよみが退いても、一度固定した敵は固定されたまま。戦闘は続く
//                                               戦える仲間がいなくなったら、誰か生きていれば撤退、全員倒れたら "wipe"
//   maxSeconds?: 45,                          … 時間切れまでの秒数（決戦では長くする）
//   enemyLevel?: 1,                           … 敵のレベル（体力・攻撃力 × enemyGrowth^(Lv-1)）
//   enemyScale?: 1,                           … 敵の体力・攻撃力の倍率（調整用）
//   bossRules?: { specialAmmo, regen, targetAny, damageTaken } … 決戦のブラックスワン（boss: true の敵）にだけ効く規則（対抗装置の段階で変わる）
//   field?: { special, regen, weakest, damage }   … 対抗装置の、ブラックスワン以外への小さな効果（特効の倍率・再生の倍率・弱った仲間を狙う確率・攻撃力の倍率）
// }
//
// 結果の outcome: "win"（勝利）/ "retreat"（撤退）/ "wipe"（全滅）/ "timeout"（時間切れ）

import { CONFIG } from "../config.js";
import { createRng } from "./rng.js";

export class Battle {
  constructor(setup, { seed = "battle", config = CONFIG, record = false } = {}) {
    this.config = config;
    this.rng = createRng(String(seed));
    this.record = record;
    this.events = []; // record: true のときだけ記録（画面の表示用）
    this.t = 0;
    this.done = false;
    this.outcome = null;
    this.policy = setup.policy || "smart";
    this.retreatLine = setup.retreatLine ?? 0;
    this.bossRules = setup.bossRules ?? null;
    this.field = { special: 1, regen: 1, weakest: 0.6, damage: 1, ...(setup.field ?? {}) };
    this.maxSeconds = setup.maxSeconds ?? config.battle.maxSeconds;
    this.ammo = { ...setup.ammo };
    this.used = Object.fromEntries(Object.keys(config.ammoTypes).map((k) => [k, 0]));
    this.fallbackShots = 0;
    this.medkits = setup.medkits ?? 0;
    this.usedMedkits = 0;

    this.allies = setup.allies.map((a, i) => {
      const role = config.roles[a.role];
      const weapon = config.weapons[a.weapon];
      if (!role) throw new Error(`役割 ${a.role} がありません`);
      if (!weapon) throw new Error(`銃 ${a.weapon} がありません`);
      const st = allyStats(a, config);
      return {
        side: "ally",
        id: a.id ?? `a${i}`,
        name: a.name ?? role.name,
        role: a.role,
        roleDef: role,
        weapon: a.weapon,
        weaponDef: weapon,
        stats: st,
        row: a.row === "back" ? "back" : "front",
        hp: Math.min(st.maxHp, a.hp ?? st.maxHp),
        maxHp: st.maxHp,
        alive: true,
        withdrawn: false, // 撤退ラインを下回って、戦闘から退いた
        cool: this.rng.next() * weapon.interval * st.interval, // 最初の一発の時間を少しずらす
        healCool: role.healInterval ?? 0,
      };
    });

    // 敵の手強さは戦闘ごとに少し違う（群れ全体の強さ ＋ 1体ごとの個体差）
    const sv = config.battle.strengthVariance;
    const lv = Math.max(1, setup.enemyLevel ?? 1);
    const strength = (1 - sv.group + this.rng.next() * 2 * sv.group) * (setup.enemyScale ?? 1) * config.levels.enemyGrowth ** (lv - 1);
    this.enemyStrength = strength;
    this.enemies = setup.enemies.map((e, i) => {
      const def = config.enemyTypes[e.type];
      if (!def) throw new Error(`敵の型 ${e.type} がありません`);
      const k = strength * (1 - sv.individual + this.rng.next() * 2 * sv.individual);
      const hp = Math.round(def.hp * k);
      return {
        side: "enemy",
        id: `e${i}`,
        name: def.name,
        type: e.type,
        def,
        power: k, // 攻撃力の倍率
        hp,
        maxHp: hp,
        alive: true,
        cool: this.rng.next() * def.interval,
        burnUntil: -1,
      };
    });
    this.allyMaxHp = this.allies.reduce((s, a) => s + a.maxHp, 0);
    this.startHp = this.allies.reduce((s, a) => s + a.hp, 0);
  }

  // ── 外からの操作 ──

  setPolicy(policy) {
    if (!this.config.ammoPolicies[policy]) throw new Error(`弾の方針 ${policy} がありません`);
    this.policy = policy;
    this.log({ kind: "policy", policy });
  }

  retreat() {
    if (!this.done) this.finish("retreat");
  }

  run() {
    while (!this.done) this.step();
    return this.result();
  }

  // ── 1コマ進める ──

  step() {
    if (this.done) return;
    const dt = this.config.battle.tick;
    this.t = Math.round((this.t + dt) * 1000) / 1000;

    // 再生型は、焼夷弾で燃えている間は再生しない
    for (const e of this.enemies) {
      if (e.alive && e.def.regen && this.t >= e.burnUntil && e.hp < e.maxHp && !(e.def.boss && this.bossRules?.regen === false)) {
        e.hp = Math.min(e.maxHp, e.hp + e.def.regen * (e.def.boss ? 1 : this.field.regen) * dt);
      }
    }

    for (const a of this.allies) {
      if (!a.alive || a.withdrawn) continue;
      if (a.roleDef.heal) {
        a.healCool -= dt;
        if (a.healCool <= 0) {
          a.healCool += a.roleDef.healInterval;
          this.heal(a);
        }
      }
      // 間隔が1コマより短い銃（重火器）は、1コマに複数回撃つ
      a.cool -= dt;
      while (a.cool <= 0 && this.enemies.some((e) => e.alive)) a.cool += this.allyAttack(a);
      if (this.enemies.every((e) => !e.alive)) return this.finish("win");
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.cool -= dt;
      while (e.cool <= 0 && this.active().length) {
        e.cool += e.def.interval;
        this.enemyAttack(e);
        if (this.done) return;
      }
    }

    // 撤退ライン：仲間ごとに、体力が下回ったらすぐに戦闘から退く（こよみが退いても戦闘は続く）
    if (this.retreatLine > 0) {
      for (const a of this.active()) {
        if (a.hp / a.maxHp < this.retreatLine) {
          a.withdrawn = true;
          this.log({ kind: "withdraw", id: a.id });
        }
      }
    }
    // 戦える仲間がいなくなった：誰か生きていれば撤退、全員倒れたら全滅
    if (!this.active().length) return this.finish(this.allies.some((a) => a.alive) ? "retreat" : "wipe");
    if (this.t >= this.maxSeconds) return this.finish("timeout");
  }

  // ── 味方の行動 ──

  allyAttack(a) {
    const w = a.weaponDef;
    const st = a.stats;
    const interval = w.interval * st.interval;
    const targets = this.pickTargets(a);
    if (targets.length === 0) return interval;

    // 特殊な銃（ammoAs）は通常弾を使い、その弾として効く。通常弾がなければ、ふつうに弾を選ぶ
    const asAmmo = w.ammoAs && (this.ammo.normal ?? 0) > 0 ? w.ammoAs : null;
    const ammoType = asAmmo ? "normal" : chooseAmmo(this.policy, targets[0].def, this.ammo, this.config);
    if (ammoType == null) {
      // 弾切れ：近接攻撃に切り替わる
      const fb = this.config.battle.fallback;
      this.fallbackShots++;
      this.damageEnemy(a, targets[0], fb.damage * st.damage, null);
      return fb.interval;
    }

    // 「弾の節約」の特性・ハンドガンなら、ときどき弾を使わずに撃つ
    const save = st.saveAmmo + (w.saveAmmo ?? 0);
    if (!(save > 0 && this.rng.next() < save)) {
      this.ammo[ammoType] -= 1;
      this.used[ammoType] += 1;
    }
    const b = this.config.battle;
    for (const [ti, target] of targets.entries()) {
      // 外れることがある（弾は消費する）
      if (this.rng.next() >= Math.min(0.98, (w.accuracy ?? b.accuracy) + st.accuracy)) {
        this.log({ kind: "miss", from: a.id, to: target.id });
        continue;
      }
      const crit = this.rng.next() < b.crit.chance + st.crit + (w.crit ?? 0);
      let mult = asAmmo ? Math.max(ammoMultiplier(target.def, asAmmo), ammoMultiplier(target.def, "normal")) : ammoMultiplier(target.def, ammoType);
      const rules = target.def.boss ? this.bossRules : null;
      if (rules && rules.specialAmmo === false) mult = Math.min(mult, 1); // 対抗装置がないと、特効が入らない
      if (!target.def.boss && mult > 1) mult *= this.field.special; // 対抗装置（ブラックスワン以外）：特効が少し強い
      if (w.pierce && mult < w.pierce) mult = w.pierce; // 貫通：効きにくい弾でも、攻撃力がこの割合までしか落ちない
      const splash = ti > 0 ? w.splash ?? 1 : 1; // 2体目以降
      const shell = rules?.damageTaken ?? (target.def.boss ? 1 : this.field.damage); // 殻（ブラックスワン以外には、対抗装置で攻撃力が少し上がる）
      const dmg = w.damage * st.damage * (w.row?.[a.row] ?? 1) * splash * mult * shell * this.variance() * (crit ? b.crit.multiplier : 1);
      this.damageEnemy(a, target, dmg, asAmmo ?? ammoType, mult, crit);
    }
    return interval;
  }

  pickTargets(a) {
    const alive = this.enemies.filter((e) => e.alive);
    if (alive.length === 0) return [];
    if (a.weaponDef.focus === "toughest") {
      return [alive.reduce((m, e) => (e.hp > m.hp ? e : m), alive[0])];
    }
    return alive.slice(0, a.weaponDef.targets);
  }

  damageEnemy(a, e, dmg, ammoType, mult = 1, crit = false) {
    e.hp -= dmg;
    if (ammoType === "incendiary" && e.def.burnSeconds) e.burnUntil = this.t + e.def.burnSeconds;
    this.log({
      kind: "hit", from: a.id, to: e.id, damage: dmg, ammo: ammoType,
      mark: mult >= 3 ? "特効" : mult <= 0.5 ? "半減" : null,
      crit,
    });
    if (e.hp <= 0) {
      e.hp = 0;
      e.alive = false;
      this.log({ kind: "enemyDown", id: e.id });
    }
  }

  // 医薬品を1個使って、体力の割合が一番低い仲間を回復する（医薬品がなければ回復できない）
  heal(a) {
    if (this.medkits <= 0) return;
    const below = a.roleDef.healBelow ?? 0.7;
    const hurt = this.active().filter((x) => x.hp < x.maxHp * below);
    if (hurt.length === 0) return;
    const target = hurt.reduce((m, x) => (x.hp / x.maxHp < m.hp / m.maxHp ? x : m), hurt[0]);
    const amount = Math.min(a.roleDef.heal * a.stats.hp, target.maxHp - target.hp);
    target.hp += amount;
    this.medkits--;
    this.usedMedkits++;
    this.log({ kind: "heal", from: a.id, to: target.id, amount });
  }

  // ── 敵の行動 ──

  enemyAttack(e) {
    const target = this.pickAllyTarget(e.def.boss && this.bossRules?.targetAny ? "any" : e.def.target ?? "front");
    if (!target) return;
    const evade = (target.roleDef.evade ?? 0) + target.stats.evade + (target.weaponDef.evade ?? 0);
    if (evade > 0 && this.rng.next() < evade) {
      this.log({ kind: "evade", from: e.id, to: target.id });
      return;
    }
    const strike = this.config.battle.enemyStrike;
    const strong = this.rng.next() < strike.chance;
    const dmg = e.def.attack * e.power * (1 - (target.roleDef.reduction ?? 0)) * this.variance() * (strong ? strike.multiplier : 1);
    target.hp -= dmg;
    this.log({ kind: "hurt", from: e.id, to: target.id, damage: dmg, strong });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      this.log({ kind: "allyDown", id: target.id });
    }
  }

  // 敵の型ごとの狙い方
  //   front   … 前列を狙う（前列が全員倒れるか退いたら後列）。盾役が強く引きつける（taunt）
  //   any     … 前列・後列を問わず誰でも。盾役は半分の強さで引きつける
  //   weakest … 6割（対抗装置で下がる）は体力の割合が一番低い仲間（後列でも）、残りは誰でも。盾役は引きつけられない
  pickAllyTarget(mode) {
    const alive = this.active();
    if (alive.length === 0) return null;
    if (mode === "weakest" && this.rng.next() < this.field.weakest) {
      const low = Math.min(...alive.map((a) => a.hp / a.maxHp));
      return this.rng.pick(alive.filter((a) => a.hp / a.maxHp <= low + 1e-9));
    }
    if (mode === "weakest") return this.rng.pick(alive);
    const front = alive.filter((a) => a.row === "front");
    const pool = mode === "any" ? alive : front.length ? front : alive;
    const tank = pool.find((a) => a.roleDef.taunt);
    if (tank && this.rng.next() < tank.roleDef.taunt * (mode === "any" ? 0.5 : 1)) return tank;
    // 重火器は目立つので、狙われやすい
    const loud = pool.find((a) => a.weaponDef.draw);
    if (loud && this.rng.next() < loud.weaponDef.draw) return loud;
    return this.rng.pick(pool);
  }

  // 戦っている仲間（倒れておらず、退いてもいない）
  active() {
    return this.allies.filter((a) => a.alive && !a.withdrawn);
  }

  // ── 補助 ──

  variance() {
    const v = this.config.battle.damageVariance;
    return 1 - v + this.rng.next() * 2 * v;
  }

  allyHpRatio() {
    return this.allies.reduce((s, a) => s + Math.max(0, a.hp), 0) / this.allyMaxHp;
  }

  log(ev) {
    if (this.record) this.events.push({ t: this.t, ...ev });
  }

  finish(outcome) {
    this.done = true;
    this.outcome = outcome;
    this.log({ kind: "end", outcome });
  }

  result() {
    return {
      outcome: this.outcome,
      seconds: this.t,
      used: { ...this.used },
      usedMedkits: this.usedMedkits,
      ammoCostBase: ammoCostBase(this.used, this.config),
      // 弾薬費と医薬品代の合計（基準の値段）
      costBase: ammoCostBase(this.used, this.config) + this.usedMedkits * this.config.supplies.medkit.price,
      fallbackShots: this.fallbackShots,
      allies: this.allies.map((a) => ({ id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp, alive: a.alive, withdrawn: a.withdrawn })),
      ammoLeft: { ...this.ammo },
      medkitsLeft: this.medkits,
      enemiesLeft: this.enemies.filter((e) => e.alive).length,
      killedPoints: this.enemies.filter((e) => !e.alive).reduce((s, e) => s + (e.def.points ?? 0), 0),
    };
  }
}

// 仲間の能力（仲間のレベル・銃のレベル・特性・奇襲などの一時的な強化を反映）
export function allyStats(a, config = CONFIG) {
  const role = config.roles[a.role];
  const L = config.levels;
  const lv = Math.max(1, a.level ?? 1) - 1;
  const wl = Math.max(1, a.weaponLevel ?? 1) - 1;
  const st = {
    hp: L.allyGrowth ** lv,
    damage: L.allyGrowth ** wl * (1 + (a.damageBonus ?? 0)),
    interval: L.member.speed ** lv,
    accuracy: L.member.accuracy * lv,
    crit: 0,
    evade: L.member.evade * lv,
    saveAmmo: 0,
  };
  for (const k of a.traits ?? []) {
    const t = config.traits[k];
    if (!t) continue;
    for (const key of ["hp", "damage", "interval"]) if (t[key] != null) st[key] *= t[key];
    for (const key of ["accuracy", "crit", "evade", "saveAmmo"]) if (t[key] != null) st[key] += t[key];
  }
  if (role.damage) st.damage *= role.damage; // 役割ごとの攻撃力の倍率（こよみは高め）
  st.maxHp = Math.round(role.hp * st.hp);
  return st;
}

// その弾がその敵にどれだけ効くか（特効3倍、効かない0.5倍、ほかは1倍）
export function ammoMultiplier(enemyDef, ammoType) {
  return enemyDef.mods?.[ammoType] ?? 1;
}

// 弾の方針に従って、次の1発に使う弾を選ぶ（残りがなければ null）
export function chooseAmmo(policy, enemyDef, inventory, config = CONFIG) {
  const options = Object.keys(config.ammoTypes).filter((k) => (inventory[k] ?? 0) > 0);
  if (options.length === 0) return null;
  const mult = (k) => ammoMultiplier(enemyDef, k);
  const price = (k) => config.ammoTypes[k].price;
  // 倍率が高い順、同じなら安い順
  const best = [...options].sort((a, b) => mult(b) - mult(a) || price(a) - price(b))[0];
  const hasNormal = options.includes("normal");

  switch (policy) {
    case "allOut": {
      // 値段を気にせず、一番ダメージが出る弾（同じなら通常弾、次に安い弾）
      // 例：徹甲弾がないときの装甲型に、通常弾（0.5倍）ではなく焼夷弾（0.75倍）を使う
      const top = Math.max(...options.map(mult));
      const tied = options.filter((k) => mult(k) === top);
      return tied.includes("normal") ? "normal" : tied.sort((x, y) => price(x) - price(y))[0];
    }
    case "normalFirst":
      // 通常弾が効かない（半減）ときだけ特殊弾
      if (hasNormal && mult("normal") >= 1) return "normal";
      return best;
    case "smart":
    default:
      // 特効になる弾があればそれ、なければ通常弾（特殊弾を節約する）
      if (mult(best) >= 3) return best;
      if (hasNormal) return "normal";
      return best;
  }
}

// 使った弾の値段（基準の値段。現地では priceFactor を掛ける）
export function ammoCostBase(used, config = CONFIG) {
  let sum = 0;
  for (const [k, n] of Object.entries(used)) sum += n * config.ammoTypes[k].price;
  return sum;
}
