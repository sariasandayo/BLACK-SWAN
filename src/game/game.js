// 1周の進行を管理する（画面に依存しない）
//
// 相場・FX口座・部隊・所持品・任務・雇用・移動をまとめて持ち、プレイヤーの行動をメソッドとして提供する。
// 行動の結果は { ok: true, ... } か { ok: false, error: "理由" } で返す。
// 時間が進む行動（待機・偵察・移動・出撃）は、その間の相場の記録（frames）も返すので、画面で再生できる。
//
// 時間の使い方：
//   待機 … 町で日を進める。取引できる。訓練中の仲間は練度が上がる
//   偵察 … 任務の敵の編成が分かる（2日、斥候がいれば1日）。訓練は続く
//   移動 … 大陸をまたぐと日数がかかる。移動中は取引だけできる
//   出撃 … 任務の日数がまとめて進む。その間は取引できない
//
// クリア条件：
//   戦闘ルート … 期日の決戦でブラックスワンを倒す（決戦に進めば期日まで飛ばせる）。対抗装置の段階ごとに決戦が有利になる
//   資金ルート … 研究財団の株式の過半数を買い集める（達成した時点でクリア）
// ゲームオーバー：決戦での敗北、破産
//
// プレイの記録（stats）：行動・購入・収支を数えておき、自動プレイでの分析に使う

import { CONFIG } from "../config.js";
import { Market } from "../core/market.js";
import { FxAccount, maxLeverage } from "../core/fx-account.js";
import { advanceDaysWithFrames } from "../core/clock.js";
import { createRng } from "../core/rng.js";
import { addDays, daysBetween, formatJa } from "../core/calendar.js";
import { allyStats } from "../core/battle.js";
import { MissionRun } from "../core/mission-run.js";
import { predict, predictRange } from "../core/prediction.js";
import { generateMission, plausibleStageSets } from "../core/missions.js";
import { memoriesFor, eventsInRange, scoutHint, yenHint } from "../core/hints.js";
import { NAMES, FICTIONAL } from "../data/names.js";

// 敵の型ごとの特効弾
export const COUNTER_AMMO = { armored: "ap", swarm: "shot", regen: "incendiary", phase: "resonance" };

export class Game {
  constructor(data, { seed, start, config = CONFIG } = {}) {
    this.config = config;
    this.seed = String(seed ?? Date.now().toString(36));
    this.market = new Market(data, { seed: this.seed, config });
    const rng = createRng(`${this.seed}|start`);
    this.startDate = start || this.market.pickStartDate(rng, config.run.lengthDays);
    this.date = this.startDate;
    this.deadline = addDays(this.startDate, config.run.lengthDays);
    this.account = new FxAccount({ cash: config.run.initialFunds, config });
    this.cityId = config.homeCity ?? rng.pick(config.cities).id; // 東京から始まる
    this.startCityId = this.cityId; // 最初の都市（最初の週の雇用候補に、盾役と衛生兵が必ずいる）
    this.travel = null; // 移動中なら { to, arrive }

    const p = config.party;
    this.members = [{ id: "hero", ...heroProfile(config), role: "hero", weapon: p.heroWeapon, row: "front", traits: [], level: 1, trainingDays: 0, training: true }];
    this.spareWeapons = {}; // 誰も持っていない銃 { rifle: 1, ... }
    this.weaponLevels = {}; // 銃の種類ごとのレベル（書いていなければ1）
    this.ammo = Object.fromEntries(Object.keys(config.ammoTypes).map((k) => [k, p.startAmmo[k] ?? 0]));
    this.medkits = p.startMedkits;

    this.missionGen = {}; // 任務の世代（勝つと新しい任務に入れ替わる）
    this.scouted = [];
    this.hiredCandidates = [];
    this.nextMemberNo = 1;
    this.lost = []; // 失った仲間の名前
    this.logs = [];
    this.over = null; // 周回の終わり { reason: "clear" | "bankrupt" | "bossDefeat", route? }
    this.finalPending = false; // 期日を迎え、決戦を待っている

    // 決戦の準備
    this.feathers = 0; // 位相残晶（敵を倒すと手に入る）
    this.deviceStage = 0; // 対抗装置の完成した段階の数
    this.intelWeeks = []; // 東京で情報を集めた週
    this.lensLevel = 0; // 観測レンズの強化回数（0 は最初のレンズ）
    this.specialKinds = {}; // 特異な残滓の種類（現れたときに決まる） { key: { kind, level } }
    this.candidateProfiles = {}; // 雇用候補の名前・性別・年齢（はじめて出たときに決まる） { 候補id: { name, sex, age } }
    this.usedNames = []; // この周回で一度引いた名前（都市・年代が違っても、二度と引かない）
    this.shares = 0; // 研究財団の株式の保有比率（%）
    this.sharesPaid = 0; // 株式に払った額の合計（配当の元）
    this.sharesBought = 0; // 買った株式の量の合計（%）。研究の遅れ＝ボスのLvの低下はこれで決まる
    this.periodFactor = this.computePeriodFactor();

    // FXの手がかり
    this.memories = memoriesFor(this.market, this.startDate, this.deadline, config, this.seed); // 記憶の断片（recallAt の日に思い出す）
    this.hints = []; // 偵察・東京で得た噂

    // 特異な残滓
    this.specialsDone = []; // 済んだ特異な残滓の key
    this.rareOwned = {}; // 手に入れた特殊な銃 { antimateriel: true }

    this.stats = {}; // プレイの記録（キー → 数）
    this.addLog(`${formatJa(this.date)}の東京に戻ってきた。ドゥームズデイは${formatJa(this.deadline)}`);
  }

  // ── 保存と再開（ブラウザの localStorage に入れる。相場データと設定は含めない） ──

  toSave() {
    const state = {};
    for (const [k, v] of Object.entries(this)) {
      if (k === "config" || k === "market" || k === "account") continue;
      state[k] = v;
    }
    const a = this.account;
    return { version: 1, state, account: { cash: a.cash, positions: a.positions, closed: a.closed, _nextId: a._nextId } };
  }

  static fromSave(data, save, config = CONFIG) {
    if (!save || save.version !== 1) throw new Error("保存データの形式が違います");
    const g = new Game(data, { seed: save.state.seed, start: save.state.startDate, config });
    Object.assign(g, JSON.parse(JSON.stringify(save.state)));
    Object.assign(g.account, JSON.parse(JSON.stringify(save.account)));
    // 古い保存データ：こよみの年齢・性別・出自を補う
    Object.assign(g.members[0], { ...heroProfile(config), ...g.members[0], origin: g.members[0].origin ?? heroProfile(config).origin });
    return g;
  }

  // ── 状態の参照 ──

  get city() {
    return this.config.cities.find((c) => c.id === this.cityId);
  }

  get daysLeft() {
    return daysBetween(this.date, this.deadline);
  }

  get hero() {
    return this.members[0];
  }

  // いまの相場（その日の終値）
  prices() {
    return this.market.midPrices(this.date);
  }

  status() {
    return this.account.status(this.prices(), this.date);
  }

  // 実効レバレッジ：持っているポジションの金額の合計 ÷ 有効証拠金（extraUnits を足すと、注文後の見込み）
  effectiveLeverage(extra = null) {
    const pr = this.prices();
    let notional = this.account.positions.reduce((s, p) => s + p.units * pr[p.ccy], 0);
    if (extra) notional += extra.units * pr[extra.ccy];
    const eq = this.status().equity;
    return eq > 0 ? notional / eq : Infinity;
  }

  // ロスカットまでの値幅（このポジションだけが逆に動き、ほかはそのままと仮定したときの目安。円／通貨）
  losscutDistance(pos) {
    const pr = this.prices();
    const st = this.status();
    const r = this.config.fx.losscutRatio;
    const lev = this.account.effectiveLeverage(pos, this.date);
    const s = pos.side === "buy" ? 1 : -1; // 買いは値下がりで必要証拠金も減る
    const d = (st.equity - r * st.required) / (pos.units * (1 - (r * s) / lev));
    const mid = pr[pos.ccy];
    return { width: Math.max(0, d), price: mid - s * Math.max(0, d), share: Math.max(0, d) / mid };
  }

  // プレイの記録。key は "buy.ammo.ap" のような文字列
  track(key, n = 1) {
    this.stats[key] = (this.stats[key] ?? 0) + n;
  }

  trackMax(key, v) {
    if (!(this.stats[key] >= v)) this.stats[key] = v;
  }

  addLog(text) {
    this.logs.unshift({ date: this.date, text });
    if (this.logs.length > 300) this.logs.length = 300;
  }

  isInjured(m) {
    return m.injuredUntil != null && this.date < m.injuredUntil;
  }

  injuryDaysLeft(m) {
    return this.isInjured(m) ? daysBetween(this.date, m.injuredUntil) : 0;
  }

  // 出撃に出られる仲間（編成に入っていて、負傷していない）
  available() {
    return this.members.filter((m) => m.active !== false && !this.isInjured(m));
  }

  // 編成に入っている仲間
  activeMembers() {
    return this.members.filter((m) => m.active !== false);
  }

  // 編成に入れる・外す（主人公は外せない。最大 maxMembers 人）
  setActive(memberId, on) {
    const m = this.members.find((x) => x.id === memberId);
    if (!m) return fail("その仲間はいません");
    if (m.id === "hero" && !on) return fail(`${this.hero.name}は外せません`);
    if (on && m.active === false && this.activeMembers().length >= this.config.party.maxMembers) {
      return fail(`編成は${this.config.party.maxMembers}人までです`);
    }
    m.active = !!on;
    return { ok: true };
  }

  // 仲間の平均Lv（雇用候補のLvの目安）
  averageLevel() {
    return this.members.reduce((s, m) => s + (m.level ?? 1), 0) / this.members.length;
  }

  // 町での行動（買い物・雇用など）ができない理由（できるなら null）。期日に決戦を待っている間も、買い物と編成はできる
  busyReason() {
    if (this.over) return "周回は終了しています";
    if (this.travel) return `移動中です（${this.cityName(this.travel.to)}に${formatJa(this.travel.arrive)}到着）`;
    return null;
  }

  cityName(id) {
    return this.config.cities.find((c) => c.id === id)?.name ?? id;
  }

  // ── お金の換算（手数料は「両替上手」がいれば軽くなる） ──

  feeRate() {
    let fee = this.config.settlement.conversionFee;
    for (const m of this.members) for (const t of m.traits ?? []) if (this.config.traits[t]?.feeCut) fee *= 1 - this.config.traits[t].feeCut;
    return fee;
  }

  // 現地通貨の金額 → 払うときの円
  payYen(amountLocal, ccy, prices = this.prices()) {
    return ccy === "JPY" ? amountLocal : amountLocal * prices[ccy] * (1 + this.feeRate()); // 円なら換算も手数料もない
  }

  // 現地通貨の金額 → 受け取るときの円
  receiveYen(amountLocal, ccy, prices = this.prices()) {
    return ccy === "JPY" ? amountLocal : amountLocal * prices[ccy] * (1 - this.feeRate());
  }

  // 基準の値段 → その通貨での値段
  localPrice(base, ccy = this.city.currency) {
    return base * (this.config.currencies[ccy].priceFactor ?? 1);
  }

  // 造兵廠の値段の倍率（都市の得意品、地元の顔役、株主優待）
  shopFactor(item, city = this.city) {
    let f = city.shop?.discounts?.[item] ?? 1;
    for (const m of this.members) {
      for (const t of m.traits ?? []) {
        const d = this.config.traits[t]?.discount;
        if (d && m.homeCityId === city.id) f *= 1 - d;
      }
    }
    return f * (1 - (this.perk()?.discount ?? 0));
  }

  // 造兵廠の品の値段（現地通貨）
  shopPrice(item, count = 1) {
    const base = item === "medkit" ? this.config.supplies.medkit.price : (this.config.ammoTypes[item] ?? this.config.weapons[item]).price;
    return this.localPrice(base * count) * this.shopFactor(item);
  }

  // 造兵廠の品をいま買うと何円か
  shopYen(item, count = 1) {
    return this.payYen(this.shopPrice(item, count), this.city.currency);
  }

  // 基準の値段 → いまの都市で払うと何円か（表示用）
  yenCost(base, ccy = this.city.currency) {
    return this.payYen(this.localPrice(base, ccy), ccy);
  }

  // ── 町での行動（時間は進まない） ──

  pay(yen) {
    const busy = this.busyReason();
    if (busy) return fail(busy);
    const r = this.account.spend(yen, this.prices(), this.date);
    if (!r.ok) return r;
    return { ok: true, yen };
  }

  buyAmmo(type, count) {
    const def = this.config.ammoTypes[type];
    if (!def || !(count > 0)) return fail("買えません");
    const r = this.pay(this.shopYen(type, count));
    if (!r.ok) return r;
    this.ammo[type] += count;
    this.track(`buy.ammo.${type}`, count);
    this.track(`spend.ammo.${type}`, r.yen);
    return r;
  }

  buyMedkits(count) {
    if (!(count > 0)) return fail("買えません");
    const r = this.pay(this.shopYen("medkit", count));
    if (!r.ok) return r;
    this.medkits += count;
    this.track("buy.medkit", count);
    this.track("spend.medkit", r.yen);
    return r;
  }

  shopWeapons(city = this.city) {
    return city.shop?.weapons ?? Object.keys(this.config.weapons);
  }

  buyWeapon(id) {
    const def = this.config.weapons[id];
    if (!def) return fail("その銃はありません");
    if (!this.shopWeapons().includes(id)) return fail(`${this.city.name}では${def.name}は売っていません`);
    const r = this.pay(this.shopYen(id));
    if (!r.ok) return r;
    this.spareWeapons[id] = (this.spareWeapons[id] ?? 0) + 1;
    this.track(`buy.weapon.${id}`);
    this.track(`spend.weapon.${id}`, r.yen);
    return r;
  }

  // 銃を持ち替える（持っていた銃は予備に戻る）
  equip(memberId, weaponId) {
    const m = this.members.find((x) => x.id === memberId);
    if (!m) return fail("その仲間はいません");
    if (m.weapon === weaponId) return { ok: true };
    if (!(this.spareWeapons[weaponId] > 0)) return fail("予備の銃がありません");
    this.spareWeapons[weaponId]--;
    this.spareWeapons[m.weapon] = (this.spareWeapons[m.weapon] ?? 0) + 1;
    m.weapon = weaponId;
    // 列の決まった銃なら、その列へ移る
    const rows = this.config.weapons[weaponId].rows;
    if (rows && !rows.includes(m.row)) m.row = rows[0];
    return { ok: true };
  }

  setRow(memberId, row) {
    const m = this.members.find((x) => x.id === memberId);
    if (!m) return fail("その仲間はいません");
    row = row === "back" ? "back" : "front";
    const rows = this.config.weapons[m.weapon].rows;
    if (rows && !rows.includes(row)) return fail(`${this.config.weapons[m.weapon].name}は${rows[0] === "front" ? "前列" : "後列"}でしか使えません`);
    m.row = row;
    return { ok: true };
  }

  setTraining(memberId, on) {
    const m = this.members.find((x) => x.id === memberId);
    if (!m) return fail("その仲間はいません");
    if (on && (m.level ?? 1) >= this.config.levels.member.maxLevel) return fail("これ以上は鍛えられません");
    m.training = !!on;
    return { ok: true };
  }

  // ── 銃のレベル（種類ごと。お金で強化する。同じ種類の銃はすべて同じレベル） ──

  weaponLevel(type) {
    return this.weaponLevels[type] ?? 1;
  }

  // 持っている銃の種類（装備中＋予備）
  ownedWeaponTypes() {
    const set = new Set(this.members.map((m) => m.weapon));
    for (const [k, n] of Object.entries(this.spareWeapons)) if (n > 0) set.add(k);
    return [...set];
  }

  // 次のレベルに上げる値段（現地通貨）。高い銃ほど高い。株主優待の割引は効かない
  weaponUpgradeLocal(type) {
    const w = this.config.levels.weapon;
    const def = this.config.weapons[type];
    const grade = Math.sqrt((def.price ?? 600) / 300);
    return this.localPrice(w.basePrice * w.growth ** (this.weaponLevel(type) - 1) * grade);
  }

  weaponUpgradeYen(type) {
    return this.payYen(this.weaponUpgradeLocal(type), this.city.currency);
  }

  upgradeWeapon(type) {
    const def = this.config.weapons[type];
    if (!def) return fail("その銃はありません");
    if (!this.ownedWeaponTypes().includes(type)) return fail(`${def.name}を持っていません`);
    if (this.weaponLevel(type) >= this.config.levels.weapon.maxLevel) return fail("これ以上は強化できません");
    const r = this.pay(this.weaponUpgradeYen(type));
    if (!r.ok) return r;
    this.weaponLevels[type] = this.weaponLevel(type) + 1;
    this.track("weapon.upgrade");
    this.track(`weapon.upgrade.${type}`);
    this.track("spend.upgrade", r.yen);
    return r;
  }

  // 雇用候補の入れ替わりの回（周回の開始から何週目か）
  hireWeek() {
    return Math.floor(daysBetween(this.startDate, this.date) / this.config.party.candidateRefreshDays);
  }

  // 雇用候補の名前・性別・年齢。性別と年齢を抽選し、その都市の、生まれた年代の人気の名前から選ぶ（一度引いた名前は使わない）
  candidateProfile(id, cityId) {
    const known = this.candidateProfiles[id];
    if (known) return known;
    const p = this.config.party;
    const rng = createRng(`${this.seed}|name|${id}`);
    const sex = rng.next() < 0.5 ? "male" : "female";
    const age = rng.int(p.ageRange[0], p.ageRange[1]);
    const born = Number(this.date.slice(0, 4)) - age;
    const name = this.pickName(rng, cityId, sex, born) ?? null;
    const v = { name, sex, age };
    this.candidateProfiles[id] = v;
    if (name) this.usedNames.push(name);
    return v;
  }

  // 名前を1つ選ぶ。生まれた年代 → 近い年代 → 架空の名前、の順に探す。順位が高いほど選ばれやすい
  pickName(rng, cityId, sex, born) {
    const data = NAMES[cityId]?.[sex] ?? {};
    const decade = Math.floor(born / 10) * 10;
    const decades = Object.keys(data).map(Number).sort((a, b) => Math.abs(a - decade) - Math.abs(b - decade) || a - b);
    const used = new Set(this.usedNames);
    for (const d of decades) {
      const pool = data[d].map((n, i) => [n, i]).filter(([n]) => !used.has(n));
      if (pool.length) return weightedPick(rng, pool.map(([n, i]) => [n, nameWeight(i)]));
    }
    const fict = (FICTIONAL[cityId]?.[sex] ?? []).filter((n) => !used.has(n));
    if (fict.length) return rng.pick(fict);
    return null;
  }

  daysUntilRefresh() {
    const n = this.config.party.candidateRefreshDays;
    return n - (daysBetween(this.startDate, this.date) % n);
  }

  // その都市の雇用候補（周回のシード・都市・週から決まる。雇った人は消える）
  candidates(cityId = this.cityId) {
    const city = this.config.cities.find((c) => c.id === cityId);
    const p = this.config.party;
    const week = this.hireWeek();
    const rng = createRng(`${this.seed}|hire|${cityId}|${week}`);
    const traitKeys = Object.keys(this.config.traits);
    const list = [];
    // 最初の都市の最初の週は、盾役と衛生兵を必ず候補に入れる（序盤の運の差を減らす）
    const fixed = cityId === this.startCityId && week === 0 ? p.startCandidates ?? [] : [];
    for (let i = 0; i < p.candidatesPerCity; i++) {
      const rolled = weightedKey(rng, city.roleWeights);
      const role = fixed[i] ?? rolled;
      const def = this.config.roles[role];
      const traits = [];
      const n = rng.int(p.traitCount[0], p.traitCount[1]);
      while (traits.length < n) {
        const t = rng.pick(traitKeys);
        if (!traits.includes(t)) traits.push(t);
      }
      const level = Math.max(1, Math.min(this.config.levels.member.maxLevel, Math.round(this.averageLevel()) + rng.pick(p.hireLevelSpread)));
      let wage = def.wage * (1 + p.wagePerLevel * (level - 1));
      for (const t of traits) wage *= this.config.traits[t].wage ?? 1;
      const id = `${cityId}-${week}-${i}`;
      list.push({
        id,
        ...this.candidateProfile(id, cityId),
        role,
        roleName: def.name,
        level,
        origin: rng.pick(p.origins),
        weapon: rng.pick(def.weapons),
        traits,
        currency: city.currency,
        homeCityId: city.id,
        wageLocal: Math.max(1, Math.round(this.localPrice(wage, city.currency))),
      });
    }
    return list.filter((c) => !this.hiredCandidates.includes(c.id));
  }

  hire(candidateId) {
    const busy = this.busyReason();
    if (busy) return fail(busy);
    const c = this.candidates().find((x) => x.id === candidateId);
    if (!c) return fail("その候補はいません");
    if (this.members.length >= this.config.party.maxRoster) return fail(`雇えるのは${this.config.party.maxRoster}人までです`);
    const no = this.nextMemberNo++;
    this.members.push({
      id: `m${no}`,
      name: c.name ?? `${c.roleName}${String.fromCharCode(64 + ((no - 1) % 26) + 1)}`, // 名前がなければ 射手A、盾役B…
      sex: c.sex,
      age: c.age,
      origin: c.origin,
      role: c.role,
      weapon: c.weapon,
      traits: c.traits,
      level: c.level,
      baseWageLocal: c.wageLocal,
      active: this.activeMembers().length < this.config.party.maxMembers, // 編成に空きがあれば入る
      training: true, // 訓練は最初から選択している
      trainingDays: 0,
      row: this.config.weapons[c.weapon].rows?.[0] ?? (c.role === "medic" ? "back" : "front"),
      currency: c.currency,
      homeCityId: c.homeCityId,
      wageLocal: c.wageLocal,
      unpaidDays: 0,
      arrearsLocal: 0,
    });
    this.hiredCandidates.push(c.id);
    this.track(`hire.role.${c.role}`);
    this.track(`hire.city.${this.cityId}`);
    for (const t of c.traits) this.track(`hire.trait.${t}`);
    this.addLog(`${this.city.name}で${c.origin}の${c.roleName}（Lv${c.level}）を雇った（日給 ${c.wageLocal}${c.currency}）`);
    return { ok: true, member: this.members[this.members.length - 1] };
  }

  dismiss(memberId) {
    const i = this.members.findIndex((x) => x.id === memberId);
    if (i <= 0) return fail(`${this.hero.name}は外せません`);
    const m = this.members[i];
    this.spareWeapons[m.weapon] = (this.spareWeapons[m.weapon] ?? 0) + 1;
    this.members.splice(i, 1);
    this.track("party.dismiss");
    this.addLog(`${m.name}を解雇した`);
    return { ok: true };
  }

  // 1日あたりの日給の合計（いまのレートでの円換算）
  dailyWagesYen() {
    const pr = this.prices();
    return this.members.filter((m) => m.wageLocal).reduce((s, m) => s + this.payYen(m.wageLocal, m.currency, pr), 0);
  }

  // 1日あたりの訓練費（いまの都市で払う）
  dailyTrainingYen() {
    return this.members.filter((m) => m.training && !this.isInjured(m)).reduce((s, m) => s + this.trainingFeeYen(m), 0);
  }

  // その仲間の1日あたりの訓練費（レベルが上がるほど高い）
  trainingFeeYen(m) {
    return this.yenCost(this.config.party.training.fee * (m.level ?? 1));
  }

  // 訓練の進み（days 日分）。レベルが上がった仲間の名前を返す
  addTraining(m, days) {
    const tr = this.config.party.training;
    const max = this.config.levels.member.maxLevel;
    const up = [];
    if ((m.level ?? 1) >= max) return up;
    m.trainingDays = (m.trainingDays ?? 0) + days;
    while (m.trainingDays >= tr.daysPerLevel && (m.level ?? 1) < max) {
      m.trainingDays -= tr.daysPerLevel;
      m.level = (m.level ?? 1) + 1;
      // Lvが上がると日給も上がる
      if (m.wageLocal) m.wageLocal = Math.max(1, Math.round((m.wageLocal / (1 + this.config.party.wagePerLevel * (m.level - 2))) * (1 + this.config.party.wagePerLevel * (m.level - 1))));
      up.push(m.name);
      this.track("train.levelUp");
    }
    // 一度に2以上上がっても、記録は1行にまとめる
    if (up.length) this.addLog(`${m.name}がLv${m.level}に上がった${up.length > 1 ? `（+${up.length}）` : ""}`);
    if (m.level >= max) {
      m.training = false;
      m.trainingDays = 0;
    }
    return up;
  }

  // ── 移動 ──

  travelDays(from, to) {
    if (from === to) return 0;
    const a = this.config.cities.find((c) => c.id === from).region;
    const b = this.config.cities.find((c) => c.id === to).region;
    if (a === b) return 0;
    const t = this.config.travel;
    return t.days[`${a}-${b}`] ?? t.days[`${b}-${a}`] ?? t.defaultDays;
  }

  get homeId() {
    return this.config.homeCity ?? this.startCityId;
  }

  // いる都市（移動中なら行き先）から東京へ戻る日数
  returnDays(from = this.travel?.to ?? this.cityId) {
    return this.travelDays(from, this.homeId);
  }

  // 同じ地域ならすぐ着く。大陸をまたぐなら移動中になり、日を進めると着く
  travelTo(cityId) {
    const busy = this.busyReason() ?? this.timeBlock();
    if (busy) return fail(busy);
    if (!this.config.cities.some((c) => c.id === cityId)) return fail("その都市はありません");
    if (cityId === this.cityId) return { ok: true, days: 0 };
    const days = this.travelDays(this.cityId, cityId);
    this.track("travel.count");
    this.track(`travel.to.${cityId}`);
    if (days === 0) {
      this.cityId = cityId;
      this.addLog(`${this.cityName(cityId)}に移動した`);
      return { ok: true, days: 0 };
    }
    if (days > this.daysLeft) return fail("ドゥームズデイまでに着きません");
    if (cityId !== this.homeId && days + this.travelDays(cityId, this.homeId) > this.daysLeft) return fail(`ドゥームズデイまでに${this.cityName(this.homeId)}へ戻れません`);
    this.travel = { from: this.cityId, to: cityId, arrive: addDays(this.date, days) };
    this.addLog(`${this.cityName(cityId)}へ出発（${days}日）`);
    return { ok: true, days, arrive: this.travel.arrive };
  }

  // ── 時間 ──

  // 時間が進む行動ができない理由
  timeBlock() {
    if (this.over) return "周回は終了しています";
    if (this.finalPending) return "ドゥームズデイです。決戦に臨んでください";
    return null;
  }

  // 町で日を進める（移動中なら、移動を進める）
  wait(days = 1) {
    const blocked = this.timeBlock();
    if (blocked) return fail(blocked);
    days = Math.min(days, this.daysLeft);
    if (days <= 0) return fail("ドゥームズデイです");
    this.track(this.travel ? "days.travel" : "days.wait", days);
    const passed = this.passDays(days, { training: !this.travel });
    return { ok: true, ...passed };
  }

  // 移動中なら到着まで進める
  waitUntilArrival() {
    if (!this.travel) return fail("移動中ではありません");
    return this.wait(daysBetween(this.date, this.travel.arrive));
  }

  // 日数を進める。相場の記録（frames）と、その間の出来事・日給を返す
  //   training: 訓練を進めるか（町にいるときだけ）
  passDays(days, { training = false } = {}) {
    const frames = [];
    const events = [];
    const acc = { wages: 0, trainingFees: 0, left: [], leveled: [], healed: [] };
    for (let i = 0; i < days && !this.over && !this.finalPending; i++) {
      const r = advanceDaysWithFrames(this.market, this.account, this.date, 1);
      frames.push(...(frames.length ? r.frames.slice(1) : r.frames));
      events.push(...r.events);
      this.newDay(r.date);
      for (const ev of r.events) this.noteFxEvent(ev);
      this.dailyUpkeep({ training }, acc);
    }
    if (acc.wages) this.addLog(`日給 ${yen(acc.wages)}（${days}日分）`);
    if (acc.trainingFees) this.addLog(`訓練費 ${yen(acc.trainingFees)}`);
    return { frames, events, ...acc };
  }

  // 日付が変わったとき（月が変われば配当）
  newDay(date) {
    const prevMonth = this.date.slice(0, 7);
    this.date = date;
    if (this.date.slice(0, 7) !== prevMonth) this.payDividends();
  }

  noteFxEvent(ev) {
    const text = describeEvent(ev);
    if (text) this.addLog(text);
    this.trackFxEvent(ev);
  }

  // 1日の終わりの処理：日給・訓練・負傷の回復・移動の到着・終了判定
  dailyUpkeep({ training = false } = {}, acc = { wages: 0, trainingFees: 0, left: [], leveled: [], healed: [] }) {
    const pr = this.prices();
    // 日給（雇った都市の通貨建て）。払えなければ未払いがたまり、猶予を過ぎると去る
    for (const m of [...this.members]) {
      if (!m.wageLocal) continue;
      const dueLocal = m.wageLocal + (m.arrearsLocal ?? 0);
      const cost = this.payYen(dueLocal, m.currency, pr);
      const paid = this.account.spend(cost, pr, this.date);
      if (paid.ok) {
        acc.wages += cost;
        this.track("spend.wage", cost);
        if (m.unpaidDays) this.addLog(`${m.name}に未払いの日給を払った`);
        m.arrearsLocal = 0;
        m.unpaidDays = 0;
      } else {
        m.arrearsLocal = dueLocal;
        m.unpaidDays = (m.unpaidDays ?? 0) + 1;
        if (m.unpaidDays >= this.config.party.wageGraceDays) {
          this.spareWeapons[m.weapon] = (this.spareWeapons[m.weapon] ?? 0) + 1;
          this.members.splice(this.members.indexOf(m), 1);
          acc.left.push(m.name);
          this.track("party.leftUnpaid");
          this.addLog(`日給の未払いが${m.unpaidDays}日続き、${m.name}が去った`);
        } else {
          this.addLog(`★${m.name}の日給を払えなかった（あと${this.config.party.wageGraceDays - m.unpaidDays}日で去る）`);
        }
      }
    }

    // 訓練（町にいる日だけ）
    if (training && !this.travel) {
      for (const m of this.members) {
        if (!m.training || this.isInjured(m)) continue;
        const fee = this.trainingFeeYen(m);
        if (!this.account.spend(fee, pr, this.date).ok) continue;
        acc.trainingFees += fee;
        this.track("spend.training", fee);
        this.track("train.days");
        acc.leveled.push(...this.addTraining(m, 1));
      }
    }

    // 負傷の回復
    for (const m of this.members) {
      if (m.injuredUntil && this.date >= m.injuredUntil) {
        m.injuredUntil = null;
        acc.healed.push(m.name);
        this.addLog(`${m.name}が回復した`);
      }
    }

    // 期日が迫ったら東京へ戻る（決戦は東京）。間に合わない分は、端末の転送で期日に着く
    if (!this.travel && this.cityId !== this.homeId && this.daysLeft <= this.returnDays() && this.daysLeft > 0) {
      const days = this.returnDays();
      this.travel = { from: this.cityId, to: this.homeId, arrive: addDays(this.date, Math.min(days, this.daysLeft)), forced: true };
      this.track("travel.forcedHome");
      this.addLog(`★ドゥームズデイが迫った。${this.cityName(this.homeId)}へ戻る（${formatJa(this.travel.arrive)}着）`);
    }

    // 移動の到着
    if (this.travel && this.date >= this.travel.arrive) {
      this.cityId = this.travel.to;
      this.travel = null;
      acc.arrived = this.cityId;
      this.addLog(`${this.city.name}に到着した`);
    }
    this.checkOver();
    return acc;
  }

  // ── 敵のレベル：日が経つほど上がる。規模とばらつきで前後する ──

  // いまの基準のレベル（周回の始めは1、期日には 1 ＋ perRun）
  baseEnemyLevel() {
    const p = Math.min(1, Math.max(0, daysBetween(this.startDate, this.date) / this.config.run.lengthDays));
    return 1 + Math.floor(p * this.config.levels.mission.perRun);
  }

  missionLevel(seed, tier, special = false) {
    const ml = this.config.levels.mission;
    const spread = createRng(`${seed}|level`).pick(ml.spread);
    const lv = this.baseEnemyLevel() + (ml.tierOffset[tier] ?? 0) + (special ? ml.special : 0) + spread;
    return Math.max(1, Math.min(ml.max, lv));
  }

  // ── FXの手がかり ──

  // 思い出した記憶の断片
  knownMemories() {
    return this.memories.filter((m) => m.recallAt <= this.date);
  }

  // 答え合わせ：周回の期間に実際に起きた出来事（すべて）。思い出したかどうかも付ける
  answerKey() {
    const recalled = new Set(this.memories.map((m) => m.date));
    return eventsInRange(this.market, this.startDate, this.deadline, this.config).map((e) => ({ ...e, recalled: recalled.has(e.date) }));
  }

  // まだ有効な噂
  activeHints() {
    return this.hints.filter((h) => h.until >= this.date);
  }

  // ── 任務 ──

  // その都市の任務（通常の任務 ＋ 特異な残滓）。敵のレベルは日が経つと上がり、報酬もそれに応じて上がる（出撃した時点で確定）
  missions(cityId = this.cityId) {
    if (this.config.cities.find((c) => c.id === cityId)?.noMissions) return []; // 東京には任務がない
    const normal = this.config.missionTiers.map((t) => {
      const gen = this.missionGen[`${cityId}|${t.tier}`] ?? 0;
      const seed = `${this.seed}|${cityId}|${t.tier}|${gen}`;
      const m = generateMission(seed, cityId, t.tier, this.config, { level: this.missionLevel(seed, t.tier) });
      return { ...m, key: m.seed, scouted: this.scouted.includes(m.seed), feathers: this.missionFeathers(t.tier, m.days) };
    });
    return [...normal, ...this.activeSpecials().filter((m) => m.cityId === cityId)];
  }

  // 任務で必ず手に入る位相残晶の数（勝ったとき）。日数 × 最低保証の割合（切り上げ）。特異な残滓には使わない（凝相の残滓は specialFeathers）
  //   勝つと、さらに1日ごとに bonusChance の確率で1個ずつ上乗せ（最大 日数 個）
  missionFeathers(tier, days, special = false) {
    if (special) return 0;
    const rate = this.config.endgame.feathers.perDay[tier] ?? 0;
    return Math.ceil(days * rate - 1e-9);
  }

  // 勝ったときに拾う位相残晶の数（最低保証＋上乗せの抽選）
  rollFeathers(mission) {
    if (!mission.feathers) return 0;
    if (mission.special) return mission.feathers; // 凝相の残滓：現れたときに決まった数（上乗せはない）
    const rng = createRng(`${this.seed}|feathers|${mission.key}|${this.date}`);
    let n = mission.feathers;
    for (let d = 0; d < mission.days; d++) if (rng.next() < this.config.endgame.feathers.bonusChance) n++;
    return n;
  }

  // ── 特異な残滓：everyDays 日ごとに、どこかの都市に期限付きで現れる ──

  specialSchedule() {
    if (this._specials) return this._specials;
    const sp = this.config.specials;
    const rng = createRng(`${this.seed}|specials`);
    const list = [];
    for (let i = 0; ; i++) {
      const appear = addDays(this.startDate, sp.everyDays * (i + 1) - rng.int(0, 3));
      if (appear >= this.deadline) break;
      const city = rng.pick(this.config.cities.filter((c) => !c.noMissions));
      const key = `${this.seed}|special|${i}`;
      list.push({ i, key, appear, expires: addDays(appear, sp.lifeDays), cityId: city.id, weapon: city.rareWeapon ?? null });
    }
    // 観測レンズを強化していると見つかる、追加の特異な残滓（現れたときのレンズが lens 段階以上なら見つかる）
    for (const [j, extra] of (sp.lensExtra ?? []).entries()) {
      const r2 = createRng(`${this.seed}|specials|lens${j}`);
      for (let i = 0; ; i++) {
        const appear = addDays(this.startDate, extra.offset + extra.everyDays * i + r2.int(0, 2));
        if (appear >= this.deadline) break;
        const city = r2.pick(this.config.cities.filter((c) => !c.noMissions));
        const key = `${this.seed}|special|L${j}|${i}`;
        list.push({ i, key, appear, expires: addDays(appear, sp.lifeDays), cityId: city.id, weapon: city.rareWeapon ?? null, lensOnly: extra.lens });
      }
    }
    list.sort((a, b) => (a.appear < b.appear ? -1 : a.appear > b.appear ? 1 : 0));
    this._specials = list;
    return list;
  }

  // 特異な残滓の種類を決める（現れたとき、その時点の観測レンズで観測できる種類から）
  specialKindOf(s) {
    const known = this.specialKinds[s.key];
    if (known) return known;
    // 追加の特異な残滓は、そのときのレンズで見えなければ、見つからなかったことになる
    if (s.lensOnly && this.lensLevel < s.lensOnly) {
      this.specialKinds[s.key] = { hidden: true };
      return this.specialKinds[s.key];
    }
    const kinds = this.config.specials.kinds;
    const pool = Object.entries(kinds)
      .filter(([k, d]) => d.lens <= this.lensLevel && (!s.lensOnly || d.lens > 0) && (!d.weapon || (s.weapon && !this.rareOwned[s.weapon])))
      .map(([k]) => k);
    const rng = createRng(`${s.key}|kind|${this.lensLevel}`);
    const kind = rng.pick(pool.length ? pool : ["cash"]);
    // 位相残晶の数（凝相の残滓だけ）と敵Lvも、現れたときに固定する（日が経っても上がらない）
    const v = { kind, feathers: this.specialFeathers(s.key, kind), level: this.missionLevel(s.key, 3, true) };
    this.specialKinds[s.key] = v;
    return v;
  }

  // 特異な残滓で手に入る位相残晶の数（種類に feathers の範囲があるものだけ。凝相の残滓）
  specialFeathers(key, kind) {
    const f = this.config.specials.kinds[kind]?.feathers;
    return f ? createRng(`${key}|feathers`).int(f[0], f[1]) : 0;
  }

  activeSpecials() {
    const sp = this.config.specials;
    return this.specialSchedule()
      .filter((s) => s.appear <= this.date && this.date < s.expires && !this.specialsDone.includes(s.key) && !this.specialKindOf(s).hidden)
      .map((s) => {
        const known = this.specialKindOf(s);
        if (known.level == null) known.level = this.missionLevel(s.key, 3, true); // 古い保存データ
        if (known.feathers == null) known.feathers = this.specialFeathers(s.key, known.kind); // 古い保存データ
        let { kind } = known;
        // 特殊な銃をもう持っていたら、黄金の残滓として扱う（追加の残滓なら群星の残滓として扱う）
        if (kind === "rare" && this.rareOwned[s.weapon]) kind = s.lensOnly ? "echo" : "cash";
        const d = sp.kinds[kind];
        const level = known.level + (d.levelBonus ?? 0);
        const m = generateMission(s.key, s.cityId, 3, this.config, { budgetScale: sp.strength, level });
        return {
          ...m,
          tierName: d.name,
          rewardLocal: Math.round(m.rewardLocal * (d.rewardMult ?? 1)),
          key: s.key,
          scouted: this.scouted.includes(s.key),
          feathers: kind === known.kind ? known.feathers : 0, // 位相残晶は凝相の残滓でだけ手に入る（決まった数）
          special: { kind, weapon: d.weapon ? s.weapon : null, xp: d.xp ?? 0, expires: s.expires, appear: s.appear, desc: d.desc },
        };
      });
  }

  // ── 東京：観測レンズの強化（特異な残滓の種類が増える） ──
  nextLens() {
    return this.config.lens[this.lensLevel] ?? null;
  }

  // いまの観測レンズの名前
  lensName() {
    return this.lensLevel ? this.config.lens[this.lensLevel - 1].name : this.config.lensBaseName;
  }

  upgradeLens() {
    const busy = this.busyReason();
    if (busy) return fail(busy);
    if (this.cityId !== this.homeId) return fail(`観測レンズは${this.cityName(this.homeId)}でしか強化できません`);
    const next = this.nextLens();
    if (!next) return fail("観測レンズは最大まで強化しています");
    if (this.feathers < (next.feathers ?? 0)) return fail(`位相残晶が足りません（${this.feathers}/${next.feathers}）`);
    const r = this.account.spend(next.yen, this.prices(), this.date);
    if (!r.ok) return r;
    this.feathers -= next.feathers ?? 0;
    this.track("spend.lensFeathers", next.feathers ?? 0);
    this.lensLevel++;
    this.track("lens.upgrade");
    this.track("spend.lens", next.yen);
    const opened = Object.values(this.config.specials.kinds).filter((d) => d.lens === this.lensLevel).map((d) => d.name);
    this.addLog(`観測レンズを強化した（${next.name}）${opened.length ? `。「${opened.join("・")}」を観測できるようになった` : ""}`);
    return { ok: true, lens: next, opened };
  }

  findMission(key) {
    for (const c of this.config.cities) {
      const m = this.missions(c.id).find((x) => x.key === key);
      if (m) return m;
    }
    return null;
  }

  battleSetup({ policy = "smart", retreatLine = 0.3, ammo = this.ammo, medkits = this.medkits } = {}) {
    return {
      allies: this.available().map((m) => this.allySpec(m)),
      enemies: [],
      ammo: { ...ammo },
      medkits,
      policy,
      retreatLine,
      field: this.deviceField(),
    };
  }

  // 対抗装置の、ブラックスワン以外への小さな効果（完成した段階のもの）
  deviceField() {
    const f = {};
    for (const st of this.config.endgame.device.slice(0, this.deviceStage)) Object.assign(f, st.field ?? {});
    return f;
  }

  allySpec(m) {
    return {
      id: m.id, name: m.name, role: m.role, weapon: m.weapon, row: m.row, traits: m.traits ?? [],
      level: m.level ?? 1, weaponLevel: this.weaponLevel(m.weapon),
    };
  }

  // 任務の戦闘の設定（偵察済みなら、最初の戦闘で奇襲できる）
  missionSetup(mission, options = {}) {
    const setup = this.battleSetup(options);
    setup.enemyLevel = mission.level ?? 1;
    if (mission.scouted) setup.ambush = this.config.battle.ambushBonus;
    return setup;
  }

  // 勝率予測（偵察済みなら正確に、未偵察なら編成を推測して）
  //   options.ammo / options.medkits で「これだけ持っていたら」を試せる
  predict(mission, options = {}) {
    const setup = this.missionSetup(mission, options);
    const runs = options.runs;
    if (mission.scouted) {
      return { scouted: true, ...predict(setup, { seed: `${mission.key}|pred`, config: this.config, stages: mission.stages, runs }) };
    }
    const sets = plausibleStageSets(mission, this.config.battle.unscoutedCandidates, this.config);
    return { scouted: false, ...predictRange(setup, sets, { seed: `${mission.key}|range`, config: this.config, runs }) };
  }

  // 出撃準備の改善案：何を足すと勝率がどれだけ上がるか
  suggestions(mission, options = {}) {
    const runs = options.runs ?? 120;
    const base = this.predict(mission, { ...options, runs });
    const types = mission.scouted
      ? Object.keys(countTypes(mission.enemies))
      : Object.entries(this.city.enemyWeights)
          .filter(([k]) => (this.config.enemyTypes[k].minTier ?? 1) <= mission.tier)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k]) => k);
    const tries = [];
    for (const t of types) {
      const ammoType = COUNTER_AMMO[t];
      // 敵の体力から必要な量の目安を出し、その半分を100発単位で足す
      const hp = mission.enemies.filter((e) => e.type === t).reduce((s, e) => s + this.config.enemyTypes[e.type].hp, 0) || this.config.enemyTypes[t].hp * 2;
      const n = Math.max(100, Math.round(hp / 18 / 2 / 100) * 100);
      tries.push({ item: ammoType, count: n, label: `${this.config.ammoTypes[ammoType].name}+${n}発` });
    }
    if (this.available().some((m) => m.role === "medic")) tries.push({ item: "medkit", count: 10, label: `${this.config.supplies.medkit.name}+10個` });
    const out = [];
    for (const t of tries) {
      const ammo = { ...this.ammo };
      let medkits = this.medkits;
      if (t.item === "medkit") medkits += t.count;
      else ammo[t.item] += t.count;
      const p = this.predict(mission, { ...options, ammo, medkits, runs });
      out.push({ ...t, yen: this.shopYen(t.item, t.count), winRate: p.winRate, delta: p.winRate - base.winRate });
    }
    return { base, items: out.filter((x) => x.delta > 0.02).sort((a, b) => b.delta - a.delta) };
  }

  scoutDays() {
    const p = this.config.party;
    return this.available().some((m) => m.role === "scout") ? p.scoutDaysWithScout : p.scoutDays;
  }

  // 偵察：日数を使って、任務の敵の編成を明らかにする（その間も訓練は進む）
  scout(key) {
    const busy = this.busyReason() ?? this.timeBlock();
    if (busy) return fail(busy);
    const m = this.findMission(key);
    if (!m) return fail("その探索先はありません");
    if (m.scouted) return fail("偵察済みです");
    const days = Math.min(this.scoutDays(), this.daysLeft);
    if (days <= 0) return fail("ドゥームズデイです");
    this.addLog(`${m.cityName}・${m.tierName}の探索先を偵察（${days}日）`);
    this.track("scout.count");
    this.track("days.scout", days);
    const passed = this.passDays(days, { training: true });
    this.scouted.push(key);
    // 現地の噂：その都市の通貨の、この先の向き
    const hint = scoutHint(this.market, m.currency, this.date, this.seed, this.config);
    if (hint) {
      this.hints.push(hint);
      this.track("hint.scout");
      this.addLog(`偵察で耳にした噂：${hint.text}`);
    }
    return { ok: true, hint, ...passed };
  }

  // ── 出撃 ──
  // beginSortie で日数が進み（相場とFX口座はこの時点で確定）、画面で戦闘を再生してから finishSortie を呼ぶ。
  // 戦闘は画面で撤退・方針の切り替えができるので、MissionRun をそのまま返す。
  // 撤退・全滅しても、帰還までに任務の日数はかかる。

  canSortie(mission) {
    const busy = this.busyReason() ?? this.timeBlock();
    if (busy) return busy;
    if (!mission) return "その探索先はありません";
    if (mission.cityId !== this.cityId) return "この都市の探索先ではありません";
    if (this.isInjured(this.hero)) return `${this.hero.name}が負傷しています（あと${this.injuryDaysLeft(this.hero)}日）`;
    if (mission.days > this.daysLeft) return "ドゥームズデイまでに戻れません";
    if (mission.days + this.returnDays() > this.daysLeft) return `ドゥームズデイまでに${this.cityName(this.homeId)}へ戻れません`;
    return null;
  }

  beginSortie(key, options = {}) {
    const mission = this.findMission(key);
    const why = this.canSortie(mission);
    if (why) return fail(why);
    const startPrices = this.prices();
    const participants = this.available().map((m) => m.id);
    const run = new MissionRun(this.missionSetup(mission, options), mission.stages, {
      seed: `${this.seed}|battle|${key}|${this.date}`, config: this.config, record: true,
    });
    this.addLog(`${mission.cityName}・${mission.tierName}の探索に出撃（${mission.days}日・${mission.stages.length}戦）`);
    const setup = run.setup;
    this.track(`mission.start.t${mission.tier}`);
    this.track(`mission.city.${mission.cityId}`);
    this.track(`mission.policy.${setup.policy}`);
    this.track(`mission.retreatLine.${setup.retreatLine}`);
    if (mission.scouted) this.track("mission.scouted");
    if (mission.special) this.track(`mission.special.${mission.special.kind}`);
    this.track("mission.partySize", participants.length);
    if (this.account.positions.length) this.track("mission.withPositions");
    if (this.account.positions.some((p) => p.stopLoss == null)) this.track("mission.withUnprotectedPositions");
    this.track("days.sortie", mission.days);
    // 出撃中は破産を判定しない（帰還して報酬を受け取ってから判定する）
    this.onSortie = true;
    let passed;
    try {
      passed = this.passDays(mission.days);
    } finally {
      this.onSortie = false;
    }
    return { ok: true, mission, run, participants, startPrices, ...passed };
  }

  finishSortie(sortie) {
    const { mission, run } = sortie;
    while (!run.done) {
      if (!run.battle.done) run.battle.run(); // 結果まで飛ばしたとき
      run.nextStage();
    }
    const r = run.result();
    let gainedFeathers = 0;
    const pr = this.prices();
    let rewardLocal = 0;
    this.track(`mission.outcome.${r.outcome}.t${mission.tier}`);
    for (const k in r.used) this.track(`used.ammo.${k}`, r.used[k]);
    this.track("used.medkit", r.usedMedkits);
    this.track("used.fallback", r.fallbackShots);
    const lostNow = [];
    const injured = [];
    let rareWeapon = null;
    const leveled = [];
    const injuryDays = (id) => (id === "hero" ? this.config.party.heroWipeInjuryDays : this.config.party.injuryDays);

    // 弾・医薬品は、使った分だけ減る（負けても同じ）
    for (const k in r.used) this.ammo[k] = Math.max(0, this.ammo[k] - r.used[k]);
    this.medkits = Math.max(0, this.medkits - r.usedMedkits);
    // 倒れた仲間：こよみ以外は、一定の確率で死亡する（銃は残る）。助かれば負傷して数日休む
    //   こよみは死なない（倒れたら休む）。全員倒れたら outcome は "wipe"
    const deathRng = createRng(`${this.seed}|death|${mission.key}|${this.date}`);
    for (const id of r.fallen) {
      const m = this.members.find((x) => x.id === id);
      if (!m) continue;
      if (id !== "hero" && deathRng.next() < (this.config.party.deathChanceOnFall ?? 0)) {
        this.spareWeapons[m.weapon] = (this.spareWeapons[m.weapon] ?? 0) + 1;
        this.members.splice(this.members.indexOf(m), 1);
        lostNow.push(m.name);
        this.lost.push(m.name);
        this.track("party.killed");
        continue;
      }
      m.injuredUntil = addDays(this.date, injuryDays(id));
      m.training = false;
      injured.push(m.name);
      this.track(id === "hero" ? "party.heroWipe" : "party.injured");
    }
    if (r.outcome === "wipe") {
      this.addLog(`部隊が全滅した（${this.hero.name}は${injuryDays("hero")}日休養）${lostNow.length ? `。死亡：${lostNow.join("、")}` : ""}`);
    } else {
      // 任務に勝つと、位相残晶を拾う（最低保証＋上乗せ）
      const gained = r.outcome === "win" ? this.rollFeathers(mission) : 0;
      gainedFeathers = gained;
      if (gained) {
        this.feathers += gained;
        this.track("feathers.gained", gained);
      }
      // 出撃した仲間は、戦いの経験で訓練が進む（お金はかからない）
      for (const id of sortie.participants) {
        const m = this.members.find((x) => x.id === id);
        if (m) leveled.push(...this.addTraining(m, this.config.party.training.sortieXp * mission.days));
      }
      if (r.outcome === "win") {
        rewardLocal = mission.rewardLocal;
        if (mission.special) {
          this.specialsDone.push(mission.key);
          this.track(`mission.specialWin.${mission.special.kind}`);
          // 群星の残滓・高純度の残滓：戦った仲間が大きく成長する
          if (mission.special.xp) {
            for (const id of sortie.participants) {
              const m = this.members.find((x) => x.id === id);
              if (m) leveled.push(...this.addTraining(m, mission.special.xp));
            }
            this.track("xp.special", mission.special.xp);
          }
          if (mission.special.weapon) {
            const w = mission.special.weapon;
            this.rareOwned[w] = true;
            this.spareWeapons[w] = (this.spareWeapons[w] ?? 0) + 1;
            this.weaponLevels[w] = Math.max(this.weaponLevel(w), mission.level ?? 1); // 任務の敵と同じレベルで手に入る
            rareWeapon = w;
            this.track(`rare.${w}`);
            this.addLog(`★特殊な銃「${this.config.weapons[w].name}」を手に入れた`);
          }
        } else {
          const slot = `${mission.cityId}|${mission.tier}`;
          this.missionGen[slot] = (this.missionGen[slot] ?? 0) + 1; // 新しい任務に入れ替わる
        }
      } else {
        rewardLocal = Math.floor(mission.rewardLocal * (r.stagesCleared / r.stageCount) * this.config.party.retreatRewardShare);
      }
    }

    const rewardYen = rewardLocal ? this.receiveYen(rewardLocal, mission.currency, pr) : 0;
    const rewardYenAtStart = rewardLocal ? this.receiveYen(rewardLocal, mission.currency, sortie.startPrices) : 0;
    if (rewardYen) {
      this.account.receive(rewardYen);
      this.track("income.reward", rewardYen);
    }
    if (r.outcome === "win") this.addLog(`探索成功。回収品を売った ${rewardLocal}${mission.currency}（${yen(rewardYen)}）`);
    else if (r.outcome === "retreat") {
      this.addLog(`撤退した（${r.stagesCleared}/${r.stageCount}戦突破）${rewardLocal ? `。回収品の一部を売った ${rewardLocal}${mission.currency}（${yen(rewardYen)}）` : ""}`);
    }
    if (injured.length) this.addLog(`負傷して休む仲間：${injured.join("、")}（${this.config.party.injuryDays}日）`);
    if (r.outcome !== "wipe" && lostNow.length) this.addLog(`死亡した仲間：${lostNow.join("、")}`);
    this.checkOver();
    const feathers = gainedFeathers;
    return { ok: true, result: r, rewardLocal, rewardYen, rewardYenAtStart, lost: lostNow, injured, feathers, rareWeapon, leveled };
  }

  // ── FX（画面も自動プレイも、ここを通して取引する。記録のため） ──

  // レバレッジは選ばない：その時代の上限で建てる（どれだけ危ないかは、数量と実効レバレッジで決まる）
  fxOpen(order) {
    const busy = this.timeBlock();
    if (busy) return fail(busy);
    const r = this.account.open({ ...order, leverage: maxLeverage(this.date, this.config) }, this.prices(), this.date);
    if (!r.ok) return r;
    const p = r.position;
    this.track("fx.open");
    this.track(`fx.open.${p.ccy}`);
    this.track(`fx.open.${p.side}`);
    if (p.stopLoss == null) this.track("fx.open.noStop");
    if (p.takeProfit != null) this.track("fx.open.withTP");
    this.track("fx.notional", p.units * this.prices()[p.ccy]);
    this.track("fx.leverageSum", p.leverage);
    // 建てた直後の実効レバレッジ（持っている数量の合計 ÷ 資金）
    const st = this.status();
    const notional = this.account.positions.reduce((s, x) => s + x.units * this.prices()[x.ccy], 0);
    this.trackMax("fx.maxEffectiveLeverage", st.equity > 0 ? notional / st.equity : 0);
    this.addLog(`新規 ${p.ccy}/JPY ${p.side === "buy" ? "買い" : "売り"} ${p.units.toLocaleString()} @${p.entryPrice.toFixed(3)}（${p.leverage}倍）`);
    return r;
  }

  fxClose(id) {
    const rec = this.account.close(id, this.prices(), this.date);
    if (!rec) return fail("そのポジションはありません");
    this.track("fx.close.manual");
    this.trackClosed(rec);
    this.addLog(`決済 ${rec.ccy}/JPY @${rec.exitPrice.toFixed(3)}（${signedYen(rec.pnl)}）`);
    this.checkOver();
    return { ok: true, record: rec };
  }

  fxSetOrders(id, levels) {
    const r = this.account.setOrders(id, levels);
    if (r.ok) this.track("fx.setOrders");
    return r;
  }

  trackClosed(rec) {
    this.track("income.fx", rec.pnl);
    this.track(`fx.pnl.${rec.ccy}`, rec.pnl);
    this.track(rec.pnl >= 0 ? "fx.wins" : "fx.losses");
  }

  trackFxEvent(ev) {
    if (ev.type === "swap") this.track("income.swap", ev.amount);
    else if (ev.type === "stopLoss" || ev.type === "takeProfit") {
      this.track(`fx.${ev.type}`);
      this.trackClosed(ev.record);
    } else if (ev.type === "losscut") {
      this.track("fx.losscut");
      for (const rec of ev.records) this.trackClosed(rec);
    } else if (ev.type === "regulation") this.track("fx.regulationHit");
  }

  // ── 決戦の準備：対抗装置（研究室で頼むと、その場で完成する） ──

  // 次に建造する段階（なければ null）
  nextDeviceStage() {
    return this.config.endgame.device[this.deviceStage] ?? null;
  }

  // 完成した段階の数（自動プレイ用。建造期間がないので deviceStage と同じ）
  devicePlanned() {
    return this.deviceStage;
  }

  // 決戦の規則（対抗装置の段階で変わる）
  bossRules() {
    const eg = this.config.endgame;
    const rules = { ...eg.bossRulesBase };
    for (const st of eg.device.slice(0, this.deviceStage)) Object.assign(rules, st.rules);
    return rules;
  }

  deviceComplete() {
    return this.deviceStage >= this.config.endgame.device.length;
  }

  // 対抗装置を建造する：東京の研究室でだけ。その場で完成する
  buildDevice() {
    const busy = this.busyReason();
    if (busy) return fail(busy);
    if (this.cityId !== this.homeId) return fail(`対抗装置は${this.cityName(this.homeId)}の研究室でしか作れません`);
    const st = this.nextDeviceStage();
    if (!st) return fail("対抗装置は完成しています");
    if (this.feathers < st.feathers) return fail(`位相残晶が足りません（${this.feathers}/${st.feathers}）`);
    const r = this.account.spend(st.yen, this.prices(), this.date);
    if (!r.ok) return r;
    this.feathers -= st.feathers;
    this.deviceStage++;
    this.track("device.stage");
    this.track("spend.device", st.yen);
    if (!this.stats["device.firstDay"]) this.stats["device.firstDay"] = daysBetween(this.startDate, this.date);
    if (this.deviceComplete()) this.stats["device.completeDay"] = daysBetween(this.startDate, this.date);
    this.addLog(`★対抗装置「${st.name}」が完成した（${this.deviceStage}/${this.config.endgame.device.length}）`);
    return { ok: true, stage: st };
  }

  // ── 東京：情報を集める（日銀・財務省筋の噂）。週に1度、1日かかる。円全体の、この先の向きの噂 ──
  canGatherIntel() {
    const busy = this.busyReason() ?? this.timeBlock();
    if (busy) return busy;
    if (this.cityId !== this.homeId) return `情報は${this.cityName(this.homeId)}でしか集められません`;
    if (this.intelWeeks.includes(this.hireWeek())) return `今週の情報はもう集めた（あと${this.daysUntilRefresh()}日で新しい噂が入る）`;
    if (this.daysLeft < 1) return "ドゥームズデイです";
    return null;
  }

  gatherIntel() {
    const why = this.canGatherIntel();
    if (why) return fail(why);
    const h = this.config.hints.tokyo;
    this.intelWeeks.push(this.hireWeek());
    this.track("intel.count");
    const date = this.date;
    const passed = this.passDays(h.takeDays, { training: true });
    const found = [];
    const hint = yenHint(this.market, date, this.seed, this.config, h);
    if (hint) {
      hint.source = this.cityName(this.homeId);
      this.hints.push(hint);
      found.push(hint);
      this.addLog(`${this.cityName(this.homeId)}で集めた噂：${hint.text}`);
    }
    this.track("hint.tokyo", found.length);
    return { ok: true, hints: found, ...passed };
  }

  // ── 研究財団の株式 ──

  // 期間の補正：周回の期間に相場が大きく動いたほど株価を上げる（稼ぎやすい期間ほど資金ルートを難しくする）
  computePeriodFactor() {
    let maxMove = 0;
    for (const c of this.market.currencies) {
      const a = this.market.close(c, this.startDate);
      const b = this.market.close(c, this.deadline);
      maxMove = Math.max(maxMove, Math.abs(Math.log(b / a)));
    }
    return 1 + this.config.endgame.shares.trendFactor * maxMove;
  }

  // 保有比率 h% のときに、次の1%を買う値段（節目を越えると上がる）
  sharePriceAt(h) {
    const sh = this.config.endgame.shares;
    let mult = 1;
    for (const s of sh.steps ?? []) if (h >= s.at) mult *= s.mult;
    return sh.firstPrice * mult * this.periodFactor;
  }

  // 次の値上がりの節目（なければ null）
  nextShareStep() {
    return (this.config.endgame.shares.steps ?? []).find((s) => this.shares < s.at) ?? null;
  }

  shareCost(pct, from = this.shares) {
    let sum = 0;
    for (let i = 0; i < pct; i++) sum += this.sharePriceAt(from + i);
    return sum;
  }

  // 過半数まで、いまの値段で買うといくらかかるか（自動プレイ用。画面には出さない）
  shareCostToMajority() {
    return this.shareCost(Math.max(0, Math.ceil(this.config.endgame.shares.majority - this.shares)));
  }

  buyShares(pct) {
    const busy = this.busyReason();
    if (busy) return fail(busy);
    if (!(pct > 0)) return fail("買えません");
    const cost = this.shareCost(pct);
    const r = this.account.spend(cost, this.prices(), this.date);
    if (!r.ok) return r;
    this.shares += pct;
    this.sharesBought += pct;
    this.sharesPaid += cost;
    this.track("shares.buys");
    this.track("shares.pct", pct);
    this.track("spend.shares", cost);
    const sh = this.config.endgame.shares;
    const before0 = this.shares - pct;
    this.addLog(`財団の株式を${pct}%買い増した（${yen(cost)}）。保有比率 ${this.shares.toFixed(1)}%`);
    const events = [];
    for (const s of sh.steps ?? []) {
      if (before0 < s.at && this.shares >= s.at && this.shares < sh.majority) {
        events.push({ type: "step", title: s.title, text: s.text });
        this.addLog(`★${s.text}（以後の値段 ×${s.mult}）`);
      }
    }
    if (this.shares >= sh.majority) {
      this.over = { reason: "clear", route: "funds" };
      this.stats["clear.day"] = daysBetween(this.startDate, this.date);
      this.addLog(`財団の株式の過半数を握った。「${this.config.endgame.shares.research}」は中止された`);
    }
    return { ok: true, cost, events };
  }

  // 株主優待の段階（保有比率に応じて。なければ null）
  perk() {
    let best = null;
    for (const p of this.config.endgame.shares.perks ?? []) if (this.shares >= p.at) best = p;
    return best;
  }

  // 毎月1日の配当：株式に払った額の dividendMonthly（円）と、株主優待の現物
  payDividends() {
    const sh = this.config.endgame.shares;
    if (!(this.shares > 0)) return;
    const cash = Math.round(this.sharesPaid * (sh.dividendMonthly ?? 0));
    if (cash > 0) {
      this.account.receive(cash);
      this.track("income.dividend", cash);
    }
    const gift = this.perk()?.gift ?? {};
    const parts = [];
    for (const [k, n] of Object.entries(gift)) {
      if (k === "medkit") this.medkits += n;
      else if (k in this.ammo) this.ammo[k] += n;
      else continue;
      this.track(`gift.${k}`, n);
      parts.push(`${k === "medkit" ? this.config.supplies.medkit.name : this.config.ammoTypes[k].name}${n}`);
    }
    this.addLog(`財団から配当 ${yen(cash)}${parts.length ? `と株主優待（${parts.join("・")}）` : ""}を受け取った`);
  }

  // ブラックスワンのレベル（株式を買うほど下がる）
  // 株式を買うと研究が遅れ、ボスのLvが下がる。買った量の合計で数える
  bossLevel() {
    const eg = this.config.endgame;
    return Math.max(1, eg.bossLevel - this.shareReduction());
  }

  // 株式によるボスのLvの低下（上限なし。過半数に届けば資金ルートでクリア）
  shareReduction() {
    const eg = this.config.endgame;
    return Math.floor(this.sharesBought / eg.sharesPerBossLevel);
  }

  bossForms() {
    return this.config.endgame.bossForms;
  }

  // ── 決戦 ──

  // 決戦に進む：FXのポジションをすべて決済し、期日まで日を進める（訓練は続く）
  declareFinal() {
    const busy = this.timeBlock(); // 移動中でも進める（東京へ向かいながら期日を待つ）
    if (busy) return fail(busy);
    this.closeAllForFinal();
    this.track("final.declared");
    this.stats["final.declareDay"] = daysBetween(this.startDate, this.date);
    const days = this.daysLeft;
    this.track("days.skip", days);
    this.addLog(`決戦に進むことを決めた（${days}日後）`);
    const passed = this.passDays(days, { training: true });
    return { ok: true, ...passed };
  }

  closeAllForFinal() {
    for (const rec of this.account.closeAll(this.prices(), this.date, "final")) {
      if (rec) this.trackClosed(rec);
    }
  }

  // 決戦の戦闘を用意する（画面で再生するか、finishFinal で一気に計算する）
  startFinal(options = {}) {
    if (!this.finalPending) return fail("まだ決戦の時ではありません");
    this.closeAllForFinal();
    const forms = this.bossForms();
    for (const k in this.ammo) this.stats[`final.ammo.${k}`] = this.ammo[k];
    this.stats["final.medkits"] = this.medkits;
    this.stats["final.members"] = this.members.length;
    const setup = {
      ...this.battleSetup({ policy: options.policy ?? "smart", retreatLine: 0 }),
      maxSeconds: this.config.battle.bossMaxSeconds,
      enemyLevel: this.bossLevel(),
      bossRules: this.bossRules(),
      stageRecovery: this.config.endgame.stageRecovery,
    };
    // 決戦には負傷者も出る（最後の戦いなので）
    setup.allies = this.members.map((m) => this.allySpec(m));
    this.finalSetup = { setup: JSON.parse(JSON.stringify(setup)), stages: forms.map((f) => f.enemies) }; // 調整用（自動プレイで、決戦だけをやり直す）
    const run = new MissionRun(setup, forms.map((f) => f.enemies), { seed: `${this.seed}|final`, config: this.config, record: options.record ?? true });
    return { ok: true, run, forms };
  }

  finishFinal(run) {
    while (!run.done) {
      if (!run.battle.done) run.battle.run();
      run.nextStage();
    }
    const r = run.result();
    this.finalPending = false;
    for (const k in r.used) this.track(`used.ammo.${k}`, r.used[k]);
    this.track("used.medkit", r.usedMedkits);
    this.stats["final.formsCleared"] = r.stagesCleared;
    this.stats["final.formsTotal"] = r.stageCount;
    if (r.outcome === "win") {
      this.over = { reason: "clear", route: "battle" };
      this.addLog("ブラックスワンを倒した");
    } else {
      this.over = { reason: "bossDefeat" };
      this.addLog("決戦に敗れた");
    }
    return { ok: true, result: r };
  }

  checkOver() {
    if (this.over || this.finalPending) return;
    if (this.date >= this.deadline) {
      // 決戦は東京。移動中でも、期日には着いている
      if (this.travel) this.travel = null;
      this.cityId = this.homeId;
      this.finalPending = true;
      this.addLog(this.deviceComplete() ? "ドゥームズデイ。ブラックスワンが顕現した" : `ドゥームズデイ。ブラックスワンが顕現した（対抗装置 ${this.deviceStage}/${this.config.endgame.device.length}段階）`);
    } else if (!this.onSortie && this.account.isBankrupt()) {
      this.over = { reason: "bankrupt" };
      this.addLog("資金が尽きた（破産）");
    }
  }

  // 周回のまとめ（自動プレイの集計用）
  summary() {
    const st = this.status();
    return {
      seed: this.seed,
      startDate: this.startDate,
      endDate: this.date,
      reason: this.over?.reason ?? (this.finalPending ? "finalPending" : "running"),
      route: this.over?.route ?? null,
      equity: st.equity,
      members: this.members.length,
      levels: this.members.reduce((s, m) => s + (m.level ?? 1), 0),
      weaponLevels: this.members.reduce((s, m) => s + this.weaponLevel(m.weapon), 0),
      finalSetup: this.finalSetup ?? null,
      deviceStage: this.deviceStage,
      shares: this.shares,
      feathers: this.feathers,
      periodFactor: this.periodFactor,
      stats: { ...this.stats },
    };
  }

  // 仲間の能力の表示用
  memberStats(m) {
    return allyStats(m, this.config);
  }
}

// こよみの名前・年齢・性別・出自（config.party.hero から）
function heroProfile(config) {
  const h = config.party.hero ?? {};
  return { name: h.name ?? "こよみ", age: h.age, sex: h.sex, origin: h.origin };
}

// 相場の出来事を文章にする（ログ用）
export function describeEvent(ev) {
  const d = formatJa(ev.date);
  const pair = (c) => `${c}/JPY`;
  switch (ev.type) {
    case "stopLoss":
      return `${d} 損切り約定 ${pair(ev.record.ccy)} ${ev.record.exitPrice.toFixed(3)}（${signedYen(ev.record.pnl)}）`;
    case "takeProfit":
      return `${d} 利確約定 ${pair(ev.record.ccy)} ${ev.record.exitPrice.toFixed(3)}（${signedYen(ev.record.pnl)}）`;
    case "losscut":
      return `${d} ★ロスカット（維持率 ${(ev.ratio * 100).toFixed(0)}%）全ポジション決済。残り現金 ${yen(ev.cashAfter)}`;
    case "regulation":
      return `${d} ★レバレッジ規制：上限が${ev.from}倍 → ${ev.to}倍に下がった`;
    default:
      return null;
  }
}

export function countTypes(enemies) {
  const out = {};
  for (const e of enemies) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

function fail(error) {
  return { ok: false, error };
}

export function yen(v) {
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
}

// 符号付きの円（マイナスは半角の「-」）
export function signedYen(v) {
  return `${v >= 0 ? "+" : "-"}${yen(Math.abs(v))}`;
}

function weightedKey(rng, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

// 名前の順位（0が1位）による抽選の重み。上位ほど選ばれやすいが、偏りすぎないように緩やかにする
function nameWeight(rankIndex) {
  return 1 / (rankIndex + 10);
}

function weightedPick(rng, pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  for (const [v, w] of pairs) {
    x -= w;
    if (x < 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
