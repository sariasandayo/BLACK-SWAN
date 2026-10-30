// BLACK SWAN（為替×オートバトル）：画面
//
// 画面の状態（ui）と、1周の進行（game）を分けている。
// game は src/game/game.js（計算と規則）、ここは表示と操作の受け付けだけを担当する。
// 名前・説明・数値は、できるだけ src/config.js から読む（ここに直接書かない）。

import { CONFIG } from "../config.js";
import { Game, describeEvent, countTypes, yen, signedYen } from "../game/game.js";
import { formatJa, daysBetween, addDays } from "../core/calendar.js";
import { drawHistory, drawSortie, drawAnswerChart } from "./charts.js";
import { loadLandPath, mapPosition } from "./worldmap.js";
import { playStory, storyPlaying } from "./story.js";
import { STORY, ENDING_STORY } from "../data/story.js";

const $ = (id) => document.getElementById(id);
const app = $("app");
const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => v.toFixed(3);
const round3 = (v) => Math.round(v * 1000) / 1000;
const signClass = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const pair = (c) => `${c}/JPY`;
const opt = (v, label, sel) => `<option value="${v}"${sel ? " selected" : ""}>${label}</option>`;
const ccyName = (c) => CONFIG.currencies[c].name;
const enemyText = (enemies) => Object.entries(countTypes(enemies)).map(([k, n]) => `${CONFIG.enemyTypes[k].name}×${n}`).join("、");
// 金額と通貨（例：1500USD、8.8JPY）
const money = (v, ccy) => `${v}${ccy}`;
const MEDKIT = CONFIG.supplies.medkit.name;
// 品の名前（弾か医薬品）
const itemName = (k) => (k === "medkit" ? MEDKIT : CONFIG.ammoTypes[k].name);
const HERO = CONFIG.party.hero.name;
const lensStages = CONFIG.lens.length + 1; // 最初のレンズ（Mk.I）を含めた段階の数

let data = null;
let game = null;
let landPath = null; // 世界地図の陸地（読み込めなければ null）
const ui = {
  trainDays: 1,
  view: "title", // title / main / prep / sortie / result / end
  tab: "town", // map / town / party / fx
  toast: null,
  prep: null,
  sortie: null,
  result: null,
  fx: { ccy: null, units: 10000, sl: "", tp: "", riskPct: "5", editing: null },
  policy: "smart",
  retreatLine: 0.3,
  story: null, // 再生中のストーリー { id, i }（途中で閉じても、その台詞から再開する）
};

// ───────── ⓘの説明に使う文（config から作る） ─────────

// 特効の対応表（例：装甲型←徹甲弾、群体型←散弾・焼夷弾）
function counterText() {
  const top = Math.max(...Object.values(CONFIG.enemyTypes).flatMap((d) => Object.values(d.mods ?? {})));
  const rows = Object.values(CONFIG.enemyTypes)
    .filter((d) => !d.boss)
    .map((d) => {
      const ammo = Object.entries(d.mods ?? {}).filter(([, v]) => v === top).map(([k]) => CONFIG.ammoTypes[k].name);
      const burn = d.regen && d.burnSeconds ? "（燃えている間は再生しない）" : "";
      return `${d.name}←${ammo.join("・")}${burn}`;
    });
  return { top, text: rows.join("、") };
}

// 移動の日数の説明（例：同じ地域（ロンドン⇔フランクフルト）は0日。アメリカ⇔ヨーロッパと日本⇔オーストラリアは1日、ほかは2日）
function travelText() {
  const t = CONFIG.travel;
  const byRegion = {};
  for (const c of CONFIG.cities) (byRegion[c.region] ??= []).push(c.name);
  const same = Object.values(byRegion).filter((names) => names.length > 1).map((names) => names.join("⇔"));
  const regionName = (r) => t.names?.[r] ?? r;
  const groups = {};
  for (const [k, d] of Object.entries(t.days)) {
    const [a, b] = k.split("-");
    (groups[d] ??= []).push(`${regionName(a)}⇔${regionName(b)}`);
  }
  const pairs = Object.entries(groups).map(([d, list]) => `${list.join("と")}は${d}日`).join("、");
  return `${same.length ? `同じ地域（${same.join("、")}）は0日。` : ""}${pairs}、ほかは${t.defaultDays}日。`;
}

// 対抗装置が足りないときの不利（まだ作っていない段階の説明。複数あれば「、」でつなぐ）
function deviceMissingText() {
  const missing = CONFIG.endgame.device.slice(game.deviceStage);
  const damage = Math.round(CONFIG.endgame.bossRulesBase.damageTaken * 100);
  const fill = (s) => s.replace("{damageTaken}", damage);
  return missing.map((d, i) => fill(d.missing[i === missing.length - 1 ? 1 : 0])).join("、");
}

// 株主優待の品（例：医薬品10・共鳴弾100）
function giftText(gift) {
  return Object.entries(gift).map(([k, n]) => `${itemName(k)}${n}`).join("・");
}

// ───────── ヒント（ⓘを押すと出る説明） ─────────
// 常に出しておく説明は最小限にして、必要なときだけ読めるようにする

const TIPS = {
  currency: () => game.city.currency === "JPY"
    ? "東京は円建て。物価と日給に換算も手数料もかからず、為替に左右されない。海外では、円高なら安く、円安なら高くなる。"
    : `この都市の物価・日給・回収品の売却額は${ccyName(game.city.currency)}建て。払う・受け取るときのレートで円に換算する（手数料${(game.feeRate() * 100).toFixed(1)}%）。`,
  wait: () => "町で、決めた日数だけ訓練して過ごす。「部隊」で訓練を選択している仲間が経験を積む（訓練費がかかる）。日給はかかる。過ぎた日の相場の動きは、チャートで再生される。1日ずつ進めれば、毎日相場を見て取引できる。",
  explore: () => `残滓を探して倒し、残留物を回収して売る。日数がかかり、その間は取引できない（相場は動き続ける）。<br>
    ・敵のLvは日が経つほど上がる（いまLv${game.baseEnemyLevel()}前後、ドゥームズデイにはLv${1 + CONFIG.levels.mission.perRun}前後）。規模が大きいほど高く、売却額も大きい<br>
    ・偵察すると敵の編成が分かり、最初の戦闘で奇襲できる（攻撃力+${pct(CONFIG.battle.ambushBonus)}）。その都市の通貨の噂も聞ける<br>
    ・倒すと位相残晶が手に入る（対抗装置・観測レンズの素材）<br>
    ・ドゥームズデイまでに東京へ戻れない探索には出られない`,
  counters: () => {
    const c = counterText();
    return `特効（ダメージ${c.top}倍）：${c.text}。<br>
    ${MEDKIT}は、衛生兵が仲間を回復するとき1回1個使う（衛生兵がいなければ使われない）。弾と${MEDKIT}は、使った分だけ減る。`;
  },
  rows: () => `前列：装甲型・再生型に狙われる。盾役が強く引きつける。<br>
    後列：装甲型・再生型には狙われにくい（前列が全員倒れるか退くまで）。<br>
    群体型は前列・後列を問わず狙い（盾役は半分ほど引きつける）、位相型は弱っている仲間を狙う（盾役でも引きつけられない）。<br>
    ショットガンなど前列専用、スナイパーなど後列専用の銃がある。持ち替えると、その列へ移る。買った銃は「部隊」で持ち替える。`,
  hire: () => `候補は${game.daysUntilRefresh()}日後に入れ替わる。候補のLvは部隊の平均くらい。日給は雇った都市の通貨で毎日払い、Lvが上がると高くなる。日給を払えない日が${CONFIG.party.wageGraceDays}日続くと去る。`,
  party: () => `出撃するのは「編成」に入れた${CONFIG.party.maxMembers}人まで（${HERO}は必須）。編成外の仲間も日給はかかり、訓練はできる。`,
  training: () => {
    const tr = CONFIG.party.training;
    return `訓練でLvが上がる（最大${CONFIG.levels.member.maxLevel}）。体力・命中・回避・撃つ速さが上がる（攻撃力は銃のLvで決まる）。町で過ごす日に、1日 ${yen(game.yenCost(tr.fee))}×Lvで、${tr.daysPerLevel}日で1上がる。出撃した仲間も、1日あたり${tr.sortieXp}日分鍛えられる。`;
  },
  weaponUp: () => `銃は種類ごとにLvを上げる（最大${CONFIG.levels.weapon.maxLevel}）。同じ種類の銃はすべて同じLv。1つ上げるごとに攻撃力が${Math.round((CONFIG.levels.allyGrowth - 1) * 100)}%上がる。`,
  retreat: () => `撤退ラインは仲間ごと。体力がラインを下回った仲間は、すぐに戦闘から退く。退いた仲間は死なない。<br>
    倒れた仲間（${HERO}以外）は${pct(CONFIG.party.deathChanceOnFall)}の確率で死亡する。助かれば${CONFIG.party.injuryDays}日休む。<br>
    ラインを高くするほど死者は減るが、戦う人が減って勝ちにくくなる。`,
  stages: () => `戦闘と戦闘の間に、生き残った仲間は体力が少し回復する。途中で撤退したら、突破した戦闘の数に応じて売却額の一部（最大${pct(CONFIG.party.retreatRewardShare)}）を受け取る。`,
  prediction: () => `${HERO}の見立て。偵察していなければ、敵の編成しだいで幅がある。`,
  specials: () => {
    const kinds = Object.values(CONFIG.specials.kinds);
    return `特異な残滓は${CONFIG.specials.everyDays}日ほどごとに、どこかの都市に期限付きで現れる。敵は強いが、見返りが大きい。どの種類が現れるかは、東京で強化する観測レンズで変わる。レンズを強化していると、レンズでしか見えない残滓も現れるようになり、数も増える。<br>
      ${kinds.map((d) => `・${d.name}：${d.desc}${d.lens ? `（観測レンズ${d.lens + 1}段階目から）` : ""}${d.lens <= game.lensLevel ? "" : '<span class="muted">　未観測</span>'}`).join("<br>")}<br>
      一部を除き、特異な残滓からは位相残晶は手に入らない。`;
  },
  lens: () => `${HERO}の観測レンズを強化すると、観測できる特異な残滓の種類が増え、レンズでしか見えない残滓も現れるようになる（${lensStages}段階）。強化は東京でだけでき、お金のほかに位相残晶を少し使う（${CONFIG.lens.map((l) => l.feathers).join("・")}個）。`,
  map: () => `${travelText()}移動中も取引はできる。`,
  lab: () => {
    const eg = CONFIG.endgame;
    return `対抗装置は東京の研究室で作る。位相残晶とお金を持ち帰って頼むと、その場で完成する。建造した装置は、ブラックスワン以外との戦闘でもわずかに効く。<br>
      位相残晶：探索で残滓を倒すと手に入る。日数の${pct(eg.feathers.perDay[1])}は必ず、さらに1日ごとに${pct(eg.feathers.bonusChance)}の確率で1個増える。一部を除き、特異な残滓からは手に入らない。`;
  },
  intel: () => {
    const h = CONFIG.hints.tokyo;
    return `${h.takeDays}日かけて、日銀・財務省筋から、円全体のこの先${h.days}日の向き（円高か円安か）の噂を集める（${pct(h.accuracy)}くらいの確からしさ）。新しい噂が入るのは週に1度。集めた噂は、FX口座の「手がかり」に出る。`;
  },
  fxTrade: () => "取引は1日単位。訓練などで日を進めると、その日の終値で取引できる。損切り・利確は日の途中でも働く。出撃中・偵察中は取引できない。",
  fxAccount: () => `有効証拠金＝現金＋含み損益。証拠金維持率（有効証拠金÷必要証拠金）が${CONFIG.fx.losscutRatio * 100}%を下回ると、すべてのポジションが強制決済される（ロスカット）。<br>
    レバレッジはその時代の上限で固定。どれだけ危ないかは数量で決まり、「実効レバレッジ」（ポジションの金額の合計÷資金）で分かる。`,
  fxOrder: () => "損切り幅・利確幅は「建値から何円離すか」。リスクから数量を計算すると、損切りに届いたときに資金のその割合を失う数量が入る（数量はあとから変えてよい）。",
  memories: () => `記憶の断片：この期間に相場を動かした出来事を、近づくとときどき思い出す。思い出したことは確実に起こる。<br>
    噂：偵察（${pct(CONFIG.hints.scout.accuracy)}）や東京の情報収集で、この先の向きが分かる。`,
  shares: () => {
    const eg = CONFIG.endgame;
    const sh = eg.shares;
    return `株式を買い集めると研究が遅れ、ブラックスワンのLvが、買った量の合計${eg.sharesPerBossLevel}%ごとに1下がる。<br>
      ${(sh.steps ?? []).map((s) => `${s.at}%を超えると${s.title}で値段が×${s.mult}`).join("、")}。売ることはできない。この期間に相場が大きく動いているほど、値段は高い。<br>
      毎月1日に、株式に払った額の${(sh.dividendMonthly * 100).toFixed(1)}%が配当として届く。株主優待も同じ日に届く（${sh.perks.map((p) => `${p.at}%以上：造兵廠${pct(p.discount)}引き＋${giftText(p.gift)}`).join("／")}。銃の強化は割引にならない）。`;
  },
  boss: () => "決戦は撤退できない。全員が倒れれば敗北。形態と形態の間に、体力が少し回復する。取り巻きも同じLv。",
  declare: () => "決戦に進むと、FXのポジションをすべて決済し、ドゥームズデイまで日を進める（日給はかかり、訓練は進む）。当日、決戦の前に買い物と編成ができる。",
};

// ⓘボタン
function ti(key) {
  return `<button class="tip" data-act="tip" data-tip="${key}" aria-label="説明">i</button>`;
}

// 押したⓘの近くに出す。同じⓘをもう一度押すと閉じる
function showTip(key, anchor) {
  const open = document.getElementById("tipbox");
  closeTip();
  if (open && open.dataset.key === key) return;
  const text = TIPS[key]?.();
  if (!text) return;
  const box = document.createElement("div");
  box.className = "tipbox";
  box.id = "tipbox";
  box.dataset.key = key;
  box.innerHTML = `${text}<div class="row" style="justify-content:flex-end;margin:6px 0 0"><button class="mini" data-act="closeTip">閉じる</button></div>`;
  document.body.appendChild(box);
  const vw = document.documentElement.clientWidth;
  const width = Math.min(360, vw - 24);
  box.style.width = `${width}px`;
  const r = anchor?.getBoundingClientRect();
  if (!r) return;
  const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, vw - width - 12));
  // 下に出す。画面の下にはみ出すなら上に出す
  const below = r.bottom + 6;
  const h = box.offsetHeight;
  const top = below + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : below;
  box.style.left = `${left + window.scrollX}px`;
  box.style.top = `${top + window.scrollY}px`;
}

function closeTip() {
  document.getElementById("tipbox")?.remove();
}

// ───────── 保存と再開 ─────────
// 町にいるときの状態を、ブラウザ（localStorage）に保存する。出撃・決戦を始めたときは「始めた」ことも保存し、
// 途中で閉じても、再開したときに同じ結果（戦闘は最後まで自動）で決着させる（やり直しはできない）

const SAVE_KEY = "blackswan.save";

function saveGame(pending = null) {
  if (!game || game.over) return clearSave();
  try {
    const body = { game: game.toSave(), pending, ui: { tab: ui.tab, ccy: ui.fx.ccy, policy: ui.policy, retreatLine: ui.retreatLine, memSeen: ui.memSeen, story: ui.story }, savedAt: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(body));
  } catch {
    // 保存できない環境（プライベートモードなど）では、保存しないで続ける
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

function readSave() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function continueRun() {
  const save = readSave();
  if (!save) return render();
  try {
    game = Game.fromSave(data, save.game);
  } catch (err) {
    clearSave();
    ui.toast = { text: `保存データを読み込めませんでした（${err.message}）。最初から始めてください。`, error: true };
    return render();
  }
  Object.assign(ui, { view: "main", tab: save.ui?.tab ?? "town", policy: save.ui?.policy ?? "smart", retreatLine: save.ui?.retreatLine ?? 0.3, memSeen: save.ui?.memSeen ?? 0 });
  ui.fx.ccy = save.ui?.ccy ?? fxCcyOf(game.city);
  ui.toast = { text: `${formatJa(game.date)}、${game.city.name}から再開した。` };
  // ストーリーの途中で閉じた：その台詞から続ける
  const story = save.ui?.story;
  if (story && STORY[story.id]) {
    ui.toast = null;
    render();
    return startStory(story.id, story.i ?? 0);
  }
  const p = save.pending;
  if (p?.type === "sortie") {
    // 出撃の途中で閉じた：同じ戦闘を最後まで自動で進めて決着させる
    const r = game.beginSortie(p.key, p.options);
    if (r.ok) {
      const before = game.status().equity;
      const fin = game.finishSortie(r);
      ui.result = { mission: r.mission, r: fin, wages: r.wages, left: r.left, equityBefore: before, equityAfter: game.status().equity, fxEvents: r.events.map(describeEvent).filter(Boolean) };
      ui.view = "result";
      ui.toast = null;
      saveGame();
      return render();
    }
  } else if (p?.type === "final") {
    const r = game.startFinal(p.options);
    if (r.ok) {
      game.finishFinal(r.run);
      ui.view = "end";
      clearSave();
      return render();
    }
  }
  render();
}

// その都市で最初に見るFXの通貨（東京は円なので米ドル）
function fxCcyOf(city) {
  return city.currency === "JPY" ? "USD" : city.currency;
}

// ───────── 起動 ─────────

async function boot() {
  try {
    const res = await fetch(CONFIG.data.ratesUrl);
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    data = null;
  }
  render();
  loadLandPath().then((path) => {
    landPath = path;
    if (ui.view === "main" && ui.tab === "map") render();
  });
}

function newRun() {
  const params = new URLSearchParams(location.search);
  // URLに ?seed=abc&start=2008-09-01 を付けると同じ周回を再現できる（最初の1回だけ使う）
  game = new Game(data, { seed: params.get("seed") || undefined, start: params.get("start") || undefined });
  if (params.has("debug")) Object.assign(window, { game, ui, render }); // 開発用：ブラウザのコンソールから game・ui を触れるようにする
  history.replaceState(null, "", location.pathname);
  ui.view = "main";
  ui.tab = "town";
  ui.memSeen = game.knownMemories().length;
  ui.toast = null;
  ui.fx.ccy = fxCcyOf(game.city);
  render();
  // 開始の説明はストーリー（導入とチュートリアル）で示す
  startStory("intro");
}

// 最初から思い出している記憶があるときだけ知らせる（導入のストーリーのあと）
function memoryToast() {
  return ui.memSeen ? { text: "★この先の出来事を、いくつか覚えている（FX口座の「手がかり」）" } : null;
}

// ストーリーを再生する。replay（決戦タブの「もう一度見る」）のときは、進み具合を保存せず、終わったら元のタブに戻る
function startStory(id, startAt = 0, { replay = false } = {}) {
  const back = ui.tab;
  if (!replay) ui.story = { id, i: startAt };
  closeTip();
  playStory(STORY[id], game, {
    startAt,
    onTab: (tab) => {
      ui.tab = tab;
      ui.toast = null;
      render();
      window.scrollTo(0, 0);
    },
    onProgress: (i) => {
      if (replay) return;
      ui.story = { id, i };
      saveGame();
    },
    onEnd: () => {
      if (replay) ui.tab = back;
      else {
        ui.story = null;
        ui.toast = memoryToast();
      }
      render();
      window.scrollTo(0, 0);
    },
  });
}

// ───────── 描画 ─────────

function render() {
  if (ui.view === "title") return renderTitle();
  if (ui.view === "end") {
    clearSave();
    // 結果の画面の前に、終わり方に応じたエンディングの場面を流す（1周につき1回）
    if (storyPlaying()) return;
    const id = ENDING_STORY[game.over?.reason === "clear" ? game.over.route : game.over?.reason];
    if (id && STORY[id] && ui.endingShown !== game) {
      ui.endingShown = game;
      closeTip();
      app.innerHTML = "";
      return playStory(STORY[id], game, { onEnd: () => { render(); window.scrollTo(0, 0); } });
    }
    renderEnd();
    return drawAnswerChart($("endChart"), game);
  }
  if (ui.view === "prep") return renderPrep();
  if (ui.view === "sortie" || ui.view === "pass") return; // 出撃中・時の流れの再生中は専用の描画ループが更新する
  if (ui.view === "result") return renderResult();
  renderMain();
  saveGame();
}

function toastHtml() {
  if (!ui.toast) return "";
  return `<div class="toast ${ui.toast.error ? "error" : ""}">${ui.toast.text}</div>`;
}

// 資金繰りの警告
function warnings() {
  const out = [];
  const unpaid = game.members.filter((m) => m.unpaidDays > 0);
  if (unpaid.length) out.push(`日給の未払い：${unpaid.map((m) => `${m.name}（あと${CONFIG.party.wageGraceDays - m.unpaidDays}日で去る）`).join("、")}`);
  const st = game.status();
  const wage = game.dailyWagesYen() + game.dailyTrainingYen();
  if (wage > 0 && st.available < wage * 3) out.push(`使える額が日給・訓練費の${Math.floor(st.available / wage)}日分しかない`);
  if (game.isInjured(game.hero) && !game.finalPending) out.push(`${HERO}が負傷して休養中（あと${game.injuryDaysLeft(game.hero)}日）。出撃できない`);
  if (game.finalPending) return `<div class="toast">ドゥームズデイ。ブラックスワンが顕現した。準備を済ませ、「決戦」に臨もう。</div>`;
  return out.length ? `<div class="toast error">${out.join("\n")}</div>` : "";
}

function topbar(notices = "") {
  const st = game.status();
  const ratio = st.ratio === Infinity ? null : st.ratio;
  const where = game.travel ? `${game.cityName(game.travel.to)}へ移動中` : game.city.name;
  return `<div class="topbar">
    <div class="row between" style="margin:0">
      <span class="date">${formatJa(game.date)}${game.market.isTradingDay(game.date) ? "" : ' <span class="muted small">休場</span>'}</span>
      <span class="small muted">ドゥームズデイまで <b class="${game.daysLeft <= 14 ? "down" : "warn"}">${game.daysLeft}日</b></span>
    </div>
    <div class="stats">
      <span>資金（有効証拠金） <b>${yen(st.equity)}</b></span>
      <span>使える額 <b>${yen(st.available)}</b></span>
      ${ratio != null ? `<span>維持率 <b class="${ratio < 1 ? "down" : ratio < 2 ? "warn" : ""}">${pct(ratio)}</b></span>` : ""}
      <span>現在地 <b>${where}</b></span>
    </div>
    ${notices}
  </div>`;
}

function tabs() {
  const t = (id, label) => `<button class="${ui.tab === id ? "on" : ""}" data-act="tab" data-tab="${id}">${label}</button>`;
  return `<nav class="tabs">${t("map", "地図")}${t("town", game.travel ? "移動中" : "町")}${t("party", "部隊")}${t("fx", "FX口座")}${t("final", game.finalPending ? "★決戦" : "決戦")}</nav>`;
}

function titleButtons() {
  const save = readSave();
  const st = save?.game?.state;
  if (!st) return '<div class="row"><button class="go" data-act="newRun">始める</button></div>';
  const city = CONFIG.cities.find((c) => c.id === st.cityId)?.name ?? "";
  return `<div class="row"><button class="go" data-act="continueRun">続きから（${formatJa(st.date)}・${city}${save.pending ? "・出撃中" : ""}）</button></div>
    <div class="row"><button data-act="newRun">最初から始める</button></div>
    <p class="muted small">最初から始めると、保存されているデータは消えます。</p>`;
}

function renderTitle() {
  if (!data) {
    app.innerHTML = `<div class="title-screen"><h1>BLACK SWAN</h1>
      <section><p class="warn">相場データ（${CONFIG.data.ratesUrl}）が見つかりません。</p></section></div>`;
    return;
  }
  app.innerHTML = `<div class="title-screen">
    <h1>BLACK SWAN</h1>
    ${titleButtons()}
    ${toastHtml()}</div>`;
}

function renderMain() {
  const body = { map: mapTab, town: townTab, party: partyTab, fx: fxTab, final: finalTab }[ui.tab]();
  app.innerHTML = topbar(toastHtml() + warnings()) + body + tabs();
  if (ui.tab === "fx") {
    drawHistory($("fxChart"), game.market, ui.fx.ccy, game.date);
    updateOrderPreview();
  }
}

// 訓練（日を進める）のボタン（町・移動中・FX口座の画面で共通）
function waitButtons() {
  if (game.travel) {
    const left = daysBetween(game.date, game.travel.arrive);
    return `<div class="row"><button data-act="wait" data-n="1">1日進める</button>
      <button class="go" data-act="arrive">到着まで進める（${left}日）</button></div>`;
  }
  const training = game.members.filter((m) => m.training && !game.isInjured(m));
  return `<div class="row"><label><input class="w" id="trainDays" type="number" min="1" max="${Math.max(1, game.daysLeft)}" step="1" value="${ui.trainDays}"> 日</label>
    <button data-act="wait">訓練する</button>
    <span class="muted small">${training.length ? `訓練に出る仲間：${training.map((m) => m.name).join("、")}` : "訓練に出る仲間なし（日だけ進む）"}</span></div>`;
}

// ───────── 地図 ─────────

function mapTab() {
  const pr = game.prices();
  const pins = CONFIG.cities.map((c) => {
    const { left, top } = mapPosition(c.lon, c.lat);
    return `<button class="pin ${c.id === game.cityId ? "here" : ""} ${c.mapLabel ?? ""}" style="left:${left}%;top:${top}%" data-act="goCity" data-city="${c.id}">
      <span class="dot"></span><span class="lbl">${c.name}</span></button>`;
  }).join("");
  const cards = CONFIG.cities.map((c) => {
    const ch = c.currency === "JPY" ? null : game.market.dayChange(c.currency, game.date);
    const ms = game.missions(c.id);
    const days = game.travelDays(game.cityId, c.id);
    const here = c.id === game.cityId && !game.travel;
    const going = game.travel?.to === c.id;
    return `<div class="card">
      <div class="title"><span>${c.name}${here ? ' <span class="tag">現在地</span>' : ""}${going ? ' <span class="tag">移動中</span>' : ""}</span>
        <span>${ch ? `${pair(c.currency)} ${px(pr[c.currency])} <span class="small ${signClass(ch.change)}">${ch.change >= 0 ? "+" : ""}${(ch.pct * 100).toFixed(2)}%</span>` : "円建て"}</span></div>
      <div class="small">${c.feature}</div>
      ${c.noMissions ? `<div class="small muted">研究室（対抗装置 ${game.deviceStage}/${CONFIG.endgame.device.length}）・情報収集</div>` : `<div class="small muted">探索：${ms.filter((m) => !m.special).map((m) => `${m.tierName} ${money(m.rewardLocal, c.currency)}（${m.days}日）`).join("／")}</div>`}
      ${ms.filter((m) => m.special).map((m) => `<div class="small warn">★${specialLabel(m)}${ti("specials")}</div>`).join("")}
      ${here || game.travel ? "" : `<div class="row"><button class="mini" data-act="goCity" data-city="${c.id}">移動する（${days}日）</button></div>`}
    </div>`;
  }).join("");
  const logs = game.logs.slice(0, 12).map((l) => l.text).join("\n");
  return `
    <section><h2>世界地図${ti("map")}</h2><div class="map">
      ${landPath ? `<svg viewBox="-180 -80 360 140" preserveAspectRatio="none" aria-hidden="true"><path d="${landPath}"/></svg>` : ""}
      <div class="equator"></div>${pins}</div>
      ${landPath ? "" : '<p class="muted small">世界地図のデータを読み込めませんでした。</p>'}</section>
    <section><h2>各都市</h2>${cards}</section>
    <section><h2>最近の出来事</h2><pre>${logs}</pre></section>`;
}

// 特異な残滓の1行説明
function specialLabel(m) {
  const left = daysBetween(game.date, m.special.expires);
  const extra = (m.special.weapon ? `特殊な銃「${CONFIG.weapons[m.special.weapon].name}」＋` : m.feathers ? `位相残晶${m.feathers}個＋` : "") +
    (m.special.xp ? `仲間の経験（Lv${Math.round(m.special.xp / CONFIG.party.training.daysPerLevel)}つ分）＋` : "");
  return `${m.tierName}：${extra}売却額 ${money(m.rewardLocal, m.currency)}・敵Lv${m.level}・${m.days}日・${m.stages.length}戦（あと${left}日で消える）`;
}

function weaponNote(id) {
  const w = CONFIG.weapons[id];
  return `${w.name}：${w.desc}`;
}

// 年齢・性別（あれば）
function profileText(p) {
  if (!p.age) return "";
  return `${p.age}歳・${p.sex === "female" ? "女性" : "男性"}・`;
}

// 列の決まった銃なら、その旨を出す
function rowNote(m) {
  const rows = CONFIG.weapons[m.weapon].rows;
  return rows ? `<span class="muted">（${rows[0] === "front" ? "前列" : "後列"}専用の銃）</span>` : "";
}

// ───────── 町 ─────────

function townTab() {
  if (game.travel) {
    return `<section><h1 style="margin-top:0">移動中</h1>
      <p>${game.cityName(game.travel.from)} → ${game.cityName(game.travel.to)}（${formatJa(game.travel.arrive)}到着）</p>
      <p class="muted small">移動中、FX口座から取引可能</p>
      ${waitButtons()}<div class="row"><button class="mini" data-act="tab" data-tab="fx">FX口座へ</button></div></section>`;
  }
  const c = game.city;
  const pr = game.prices();
  const ccy = c.currency;
  const loc = (v) => money(v < 10 ? v.toFixed(ccy === "JPY" ? 1 : 2) : Math.round(v).toLocaleString(), ccy);
  const cheap = (item) => (game.shopFactor(item) < 1 ? ` <span class="tag up">割引中</span>` : "");

  const missions = game.missions().map((m) => {
    const enemies = m.scouted ? enemyText(m.enemies) : `<span class="muted">不明（出現率の目安：${tendency(c, m.tier)}）</span>`;
    return `<div class="card">
      <div class="title"><span>${m.special ? "★" : ""}${m.tierName} <span class="tag ${levelClass(m.level)}">敵Lv${m.level}</span><span class="tag">${m.days}日</span><span class="tag">${m.stages.length}戦</span>${m.feathers ? `<span class="tag warn">位相残晶${m.special ? m.feathers : `${m.feathers}〜${m.feathers + m.days}`}</span>` : ""}${m.scouted ? '<span class="tag">偵察済み</span>' : ""}</span>
        <span>${money(m.rewardLocal, ccy)}<br><span class="muted small">いまなら ${yen(game.receiveYen(m.rewardLocal, ccy))}</span></span></div>
      <div class="small">敵：${enemies}</div>
      ${m.special ? `<div class="small warn">${m.special.desc}${m.special.weapon ? `<br>勝てば ${weaponNote(m.special.weapon)}` : ""}<br>あと${daysBetween(game.date, m.special.expires)}日で消える</div>` : ""}
      <div class="row">
        ${m.scouted ? "" : `<button class="mini" data-act="scout" data-key="${m.key}">偵察（${game.scoutDays()}日）</button>`}
        <button class="mini go" data-act="prep" data-key="${m.key}">出撃準備</button>
      </div>
    </div>`;
  }).join("");

  const ammoRows = Object.entries(CONFIG.ammoTypes).map(([k, a]) => `
    <tr><td>${a.name}${cheap(k)}<br><span class="muted small">所持 ${game.ammo[k].toLocaleString()}発</span></td>
      <td class="small">1発 ${loc(game.shopPrice(k))}<br><span class="muted">100発 ${yen(game.shopYen(k, 100))}</span></td>
      <td><button class="mini" data-act="buyAmmo" data-type="${k}" data-n="100">+100</button>
        <button class="mini" data-act="buyAmmo" data-type="${k}" data-n="500">+500</button></td></tr>`).join("");
  const hasMedic = game.members.some((m) => m.role === "medic");
  const medRow = `<tr><td>${MEDKIT}${cheap("medkit")}<br><span class="muted small">所持 ${game.medkits}個</span></td>
    <td class="small">1個 ${loc(game.shopPrice("medkit"))}<br><span class="muted">10個 ${yen(game.shopYen("medkit", 10))}</span></td>
    <td><button class="mini" data-act="buyMed" data-n="5">+5</button> <button class="mini" data-act="buyMed" data-n="20">+20</button></td></tr>
    ${hasMedic ? "" : `<tr><td colspan="3" class="small warn">衛生兵がいないので、${MEDKIT}は使われない。</td></tr>`}`;
  const weaponRows = game.shopWeapons().map((k) => {
    const w = CONFIG.weapons[k];
    return `<tr><td>${w.name}<br><span class="muted small">予備${game.spareWeapons[k] ?? 0}</span></td>
      <td class="small">${loc(game.shopPrice(k))}<br><span class="muted">${yen(game.shopYen(k))}</span></td>
      <td><button class="mini" data-act="buyWeapon" data-weapon="${k}">買う</button></td></tr>
      <tr><td colspan="3" class="muted small wrap">${w.desc}</td></tr>`;
  }).join("");

  const full = game.members.length >= CONFIG.party.maxRoster;
  const cands = game.candidates().map((h) => `<div class="card">
      <div class="title"><span><b>Lv${h.level}</b> ${h.name ? `${h.name} ` : ""}<span class="muted small">${profileText(h)}${h.origin}の</span>${h.roleName}</span><span class="small">日給 ${money(h.wageLocal, h.currency)}<br><span class="muted">${yen(game.payYen(h.wageLocal, h.currency))}</span></span></div>
      <div class="small">${traitsHtml(h.traits)}</div>
      <div class="small muted">${CONFIG.weapons[h.weapon].name}・体力${game.memberStats(h).maxHp}${roleNote(h.role)}</div>
      <div class="row"><button class="mini" data-act="hire" data-id="${h.id}" ${full ? "disabled" : ""}>雇う</button></div>
    </div>`).join("") || `<p class="muted small">現在、この都市では協力者は見当たらない。</p>`;

  return `
    <section>
      <div class="row between" style="margin:0"><h1 style="margin:0">${c.name}${ti("currency")}</h1><span>${ccy === "JPY" ? "円建て" : `${pair(ccy)} ${px(pr[ccy])}`}</span></div>
      <p class="small">${c.feature}</p>
    </section>
    ${c.noMissions ? homeSection() : `<section><h2>探索${ti("explore")}</h2>${missions}
      <p class="muted small">部隊：${partyLevelText()}</p></section>`}
    <section><h2>訓練${ti("wait")}</h2>${waitButtons()}</section>
    <section><h2>造兵廠${ti("counters")}</h2><table>${ammoRows}${medRow}</table></section>
    <section><h2>銃${ti("rows")}</h2><table>${weaponRows}</table></section>
    <section><h2>雇用（${game.members.length}/${CONFIG.party.maxRoster}人）${ti("hire")}</h2>${cands}</section>`;
}

// 対抗装置の段階の一覧（完成・次に作るもの）
function deviceRows(busy) {
  const eg = CONFIG.endgame;
  const st = game.status();
  const atHome = game.cityId === game.homeId;
  return eg.device.map((d, i) => {
    const done = i < game.deviceStage;
    const next = i === game.deviceStage;
    const ok = next && atHome && game.feathers >= d.feathers && st.available >= d.yen;
    const state = done
      ? '<span class="up small">完成</span>'
      : next
        ? `<button class="mini go" data-act="build" ${ok && !busy ? "" : "disabled"}>${atHome ? "建造する" : `${game.cityName(game.homeId)}で建造する`}</button>`
        : "";
    return `<tr><td>${done ? "✓ " : ""}${d.name}</td><td class="small">${yen(d.yen)}<br>位相残晶 ${d.feathers}</td><td>${state}</td></tr>
      <tr><td colspan="3" class="muted small" style="white-space:normal">${d.desc}${d.fieldDesc ? `（ブラックスワン以外への効果：${d.fieldDesc}）` : ""}</td></tr>`;
  }).join("");
}

// 東京（本拠地）：研究室と情報収集。探索はない
function homeSection() {
  const eg = CONFIG.endgame;
  const intelWhy = game.canGatherIntel();
  const h = CONFIG.hints.tokyo;
  return `<section><h2>研究室（対抗装置 ${game.deviceStage}/${eg.device.length}段階）${ti("lab")}</h2>
      <p class="small">位相残晶：<b class="warn">${game.feathers}</b></p>
      <table>${deviceRows(game.busyReason())}</table></section>
    ${lensSection()}
    <section><h2>情報を集める${ti("intel")}</h2>
      <div class="row"><button class="mini go" data-act="gatherIntel" ${intelWhy ? "disabled" : ""}>日銀・財務省筋の噂を集める（${h.takeDays}日）</button></div>
      ${intelWhy ? `<p class="muted small">${intelWhy}</p>` : ""}</section>`;
}

// 観測レンズ（東京）。表示は最初のレンズ（Mk.I）を1段階目と数える
function lensSection() {
  const next = game.nextLens();
  const kinds = Object.values(CONFIG.specials.kinds);
  const seen = kinds.filter((d) => d.lens <= game.lensLevel).map((d) => d.name).join("・");
  const opens = next ? kinds.filter((d) => d.lens === game.lensLevel + 1).map((d) => `${d.name}（${d.desc}）`).join("<br>") : "";
  return `<section><h2>観測レンズ（${game.lensLevel + 1}/${lensStages}段階）${ti("lens")}</h2>
    <p class="small">${game.lensName()}　観測できる特異な残滓：${seen}</p>
    ${next ? `<div class="row"><button class="mini go" data-act="upgradeLens" ${game.status().available >= next.yen && game.feathers >= next.feathers ? "" : "disabled"}>${next.name}に強化（${yen(next.yen)}・位相残晶${next.feathers}）</button></div>
      ${opens ? `<p class="muted small">強化後に観測できる残滓：<br>${opens}</p>` : ""}` : '<p class="muted small">最大強化済み</p>'}</section>`;
}

// 部隊のレベルの目安（仲間の平均・銃の平均）
function partyLevel() {
  const ms = game.activeMembers();
  const avg = (f) => ms.reduce((a, m) => a + f(m), 0) / Math.max(1, ms.length);
  return { member: avg((m) => m.level ?? 1), weapon: avg((m) => game.weaponLevel(m.weapon)) };
}

function partyLevelText() {
  const p = partyLevel();
  return `仲間Lv${p.member.toFixed(1)}・銃Lv${p.weapon.toFixed(1)}`;
}

// 敵のレベルの色（部隊より高いほど赤い）
function levelClass(lv) {
  const p = partyLevel();
  const ours = Math.min(p.member, p.weapon);
  return lv >= ours + 3 ? "down" : lv >= ours + 1 ? "warn" : "up";
}

function traitsHtml(traits = []) {
  return traits.map((t) => `<span class="tag warn">${CONFIG.traits[t].name}</span><span class="muted">${CONFIG.traits[t].desc}</span>`).join("　");
}

// 役割の補足（config の roles.note）
function roleNote(role) {
  const note = CONFIG.roles[role]?.note;
  return note ? `・${note}` : "";
}

// 敵の型の出現率の目安（その都市の出やすさから）
function tendency(city, tier) {
  const list = Object.entries(city.enemyWeights).filter(([k, w]) => w > 0 && (CONFIG.enemyTypes[k].minTier ?? 1) <= tier);
  const sum = list.reduce((a, [, w]) => a + w, 0);
  return list
    .sort((a, b) => b[1] - a[1])
    .map(([k, w]) => `${CONFIG.enemyTypes[k].name} ${Math.round((w / sum) * 100)}%`)
    .join("・");
}

// ───────── 部隊 ─────────

// 銃の強化（種類ごと）
function weaponSection() {
  const types = game.ownedWeaponTypes();
  const max = CONFIG.levels.weapon.maxLevel;
  const rows = types.map((k) => {
    const w = CONFIG.weapons[k];
    const lv = game.weaponLevel(k);
    const users = game.members.filter((m) => m.weapon === k).map((m) => m.name).join("、") || `予備${game.spareWeapons[k] ?? 0}`;
    return `<tr><td>${w.name}<br><span class="muted small">${users}</span></td>
      <td><b>Lv${lv}</b><br><span class="muted small">攻撃力${Math.round(w.damage * CONFIG.levels.allyGrowth ** (lv - 1))}</span></td>
      <td>${lv < max ? `<button class="mini" data-act="upgrade" data-weapon="${k}" ${game.travel ? "disabled" : ""}>強化 ${yen(game.weaponUpgradeYen(k))}</button>` : '<span class="muted small">最大</span>'}</td></tr>
      <tr><td colspan="3" class="muted small wrap">${w.desc}</td></tr>`;
  }).join("");
  return `<section><h2>銃の強化${ti("weaponUp")}</h2><table>${rows}</table></section>`;
}

function partyTab() {
  const tr = CONFIG.party.training;
  const maxLv = CONFIG.levels.member.maxLevel;
  const members = game.members.map((m) => {
    const role = CONFIG.roles[m.role];
    const st = game.memberStats(m);
    const choices = [m.weapon, ...Object.keys(game.spareWeapons).filter((k) => game.spareWeapons[k] > 0 && k !== m.weapon)];
    const injured = game.isInjured(m);
    const lv = m.level ?? 1;
    return `<div class="card" ${m.active === false ? 'style="opacity:.6"' : ""}>
      <div class="title"><span>${m.name}${m.origin ? ` <span class="muted small">${profileText(m)}${m.origin}</span>` : ""}${m.active === false ? ' <span class="tag">編成外</span>' : ""}
        ${injured ? `<span class="tag down">負傷 あと${game.injuryDaysLeft(m)}日</span>` : ""}${m.unpaidDays ? '<span class="tag down">日給未払い</span>' : ""}</span>
        <span class="small">${m.wageLocal ? `日給 ${money(m.wageLocal, m.currency)}` : ""}</span></div>
      <div class="small"><b>Lv${lv}</b> <span class="muted">${role.name}・体力${st.maxHp}・${CONFIG.weapons[m.weapon].name} Lv${game.weaponLevel(m.weapon)}${roleNote(m.role)}</span>${rowNote(m)}</div>
      ${m.traits?.length ? `<div class="small">${traitsHtml(m.traits)}</div>` : ""}
      <div class="row">
        <select data-change="equip" data-id="${m.id}">${choices.map((k) => opt(k, CONFIG.weapons[k].name, k === m.weapon)).join("")}</select>
        <select data-change="row" data-id="${m.id}" ${CONFIG.weapons[m.weapon].rows ? "disabled" : ""}>${opt("front", "前列", m.row === "front")}${opt("back", "後列", m.row === "back")}</select>
        ${lv < maxLv ? `<label><input type="checkbox" data-change="training" data-id="${m.id}" ${m.training ? "checked" : ""} style="width:auto"> 訓練（${(m.trainingDays ?? 0).toFixed(1).replace(".0", "")}/${tr.daysPerLevel}日）</label>` : '<span class="muted small">Lv最大</span>'}
        ${m.id === "hero" ? "" : `<label><input type="checkbox" data-change="active" data-id="${m.id}" ${m.active !== false ? "checked" : ""} style="width:auto"> 編成</label>`}
        ${m.id === "hero" ? "" : `<button class="mini danger" data-act="dismiss" data-id="${m.id}">解雇</button>`}
      </div>
    </div>`;
  }).join("");
  const ammo = Object.entries(CONFIG.ammoTypes).map(([k, a]) => `<div>${a.name}</div><div>${game.ammo[k].toLocaleString()}発</div>`).join("");
  const spares = Object.entries(game.spareWeapons).filter(([, n]) => n > 0).map(([k, n]) => `${CONFIG.weapons[k].name}×${n}`).join("、") || "なし";
  const wage = game.dailyWagesYen();
  const trainFee = game.dailyTrainingYen();
  return `
    <section><h2>部隊（雇用${game.members.length}/${CONFIG.party.maxRoster}人・編成${game.activeMembers().length}/${CONFIG.party.maxMembers}人）${ti("party")}</h2>
      <p class="muted small">前列・後列${ti("rows")}　訓練${ti("training")}</p>${members}</section>
    ${weaponSection()}
    <section><h2>所持品</h2><div class="kv">${ammo}<div>${MEDKIT}</div><div>${game.medkits}個</div><div>予備の銃</div><div>${spares}</div></div></section>
    <section><h2>1日あたりの出費</h2><div class="kv"><div>日給</div><div>${yen(wage)}</div><div>訓練費</div><div>${yen(trainFee)}</div>
      <div>ドゥームズデイまでの日給の見込み</div><div>${yen(wage * game.daysLeft)}</div></div></section>
    ${game.lost.length ? `<section><h2>失った仲間</h2><p class="small">${game.lost.join("、")}</p></section>` : ""}`;
}

// ───────── FX口座 ─────────

function fxQuotesHtml() {
  const pr = game.prices();
  return game.market.currencies.map((c) => {
    const q = game.market.quote(c, pr[c]);
    const prev = game.market.close(c, addDays(game.date, -1));
    const ch = pr[c] - prev;
    const on = c === ui.fx.ccy;
    return `<tr class="pick ${on ? "on" : ""}" data-act="fxCcy" data-ccy="${c}"><td>${on ? "▶ " : ""}${pair(c)}</td><td>${px(q.bid)}</td><td>${px(q.ask)}</td>
      <td class="${signClass(ch)}">${ch >= 0 ? "+" : ""}${((ch / prev) * 100).toFixed(2)}%</td></tr>`;
  }).join("");
}

function fxAcctHtml() {
  const st = game.status();
  const ratio = st.ratio === Infinity ? "—" : pct(st.ratio);
  return `
      <div>現金</div><div>${yen(st.cash)}</div>
      <div>含み損益</div><div class="${signClass(st.unrealized)}">${signedYen(st.unrealized)}</div>
      <div>有効証拠金</div><div>${yen(st.equity)}</div>
      <div>必要証拠金</div><div>${yen(st.required)}</div>
      <div>証拠金維持率</div><div class="${st.ratio < 1 ? "down" : st.ratio < 2 ? "warn" : ""}">${ratio}</div>
      <div>使える額</div><div>${yen(st.available)}</div>
`;
}

function fxPositionsHtml() {
  const pr = game.prices();
  const f = ui.fx;
  return game.account.positions.map((p) => {
    const pnl = game.account.unrealized(p, pr[p.ccy]);
    const lv = [
      p.stopLoss != null ? `損切り ${px(p.stopLoss)}（${signedYen(pnlAt(p.side, p.entryPrice, p.units, p.stopLoss))}）` : '<span class="warn">損切りなし</span>',
      p.takeProfit != null ? `利確 ${px(p.takeProfit)}（${signedYen(pnlAt(p.side, p.entryPrice, p.units, p.takeProfit))}）` : "利確なし",
    ].join("　");
    let html = `<tr><td>${p.ccy}</td><td class="${p.side === "buy" ? "up" : "down"}">${p.side === "buy" ? "買" : "売"}</td>
      <td>${p.units.toLocaleString()}</td><td>${px(p.entryPrice)}</td><td class="${signClass(pnl)}">${signedYen(pnl)}</td>
      <td><button class="mini" data-act="close" data-id="${p.id}">決済</button></td></tr>
      <tr><td colspan="6" class="small muted wrap">${lv}<br>${losscutText(p)}<br>スワップ ${signedYen(p.swapTotal)}
        <button class="mini" data-act="editOrders" data-id="${p.id}">${f.editing === p.id ? "閉じる" : "損切り・利確"}</button></td></tr>`;
    if (f.editing === p.id) {
      html += `<tr><td colspan="6"><div class="row">
        <label>損切り幅 <input class="w" id="editSL" type="number" step="0.1" min="0" placeholder="なし"> 円</label>
        <label>利確幅 <input class="w" id="editTP" type="number" step="0.1" min="0" placeholder="なし"> 円</label>
        <button class="mini" data-act="applyOrders" data-id="${p.id}">設定</button></div>
        <div class="muted small">いまの決済値段 ${px(game.account.exitPrice(p, pr[p.ccy]))} から何円離すか（空欄は取り消し）</div></td></tr>`;
    }
    return html;
  }).join("") || `<tr><td colspan="6" class="muted">なし</td></tr>`;
}

function fxTab() {
  const f = ui.fx;
  return `
    <section><h2>相場${ti("fxTrade")}</h2>
      <table><tr><th>通貨</th><th>売値</th><th>買値</th><th>前日比</th></tr><tbody id="fxQuotes">${fxQuotesHtml()}</tbody></table>
      <div class="row between"><span class="big warn">${pair(f.ccy)}</span><span class="muted small">直近90営業日の終値</span></div>
      <canvas id="fxChart" style="height:150px"></canvas></section>
    ${hintsSection()}
    <section><h2>口座${ti("fxAccount")}</h2><div class="kv" id="fxAcct">${fxAcctHtml()}</div></section>
    <section><h2>新規注文${ti("fxOrder")}</h2>
      <div class="row"><select data-change="fxCcy">${game.market.currencies.map((c) => opt(c, pair(c), c === f.ccy)).join("")}</select>
        <label>数量 <input id="fxUnits" data-fx="units" type="number" step="1000" min="1000" value="${f.units}"></label>
        <span class="small" id="orderLev"></span></div>
      <div class="row"><label>損切り幅 <input class="w" data-fx="sl" type="number" step="0.1" min="0" placeholder="なし" value="${f.sl}"> 円</label>
        <label>利確幅 <input class="w" data-fx="tp" type="number" step="0.1" min="0" placeholder="なし" value="${f.tp}"> 円</label></div>
      <div class="row small"><label>損切りで失ってよい資金 <input class="w" data-fx="riskPct" type="number" step="0.5" min="0.1" max="100" value="${f.riskPct}"> %</label>
        <button class="mini" data-act="riskUnits">数量を計算</button></div>
      <div id="orderPreview" class="small" style="line-height:1.7"></div>
      <div class="row"><button class="buy" data-act="order" data-side="buy">${pair(f.ccy)}を買う</button><button class="sell" data-act="order" data-side="sell">${pair(f.ccy)}を売る</button></div></section>
    <section><h2>ポジション</h2><table><tr><th>通貨</th><th>売買</th><th>数量</th><th>建値</th><th>損益</th><th></th></tr><tbody id="fxPos">${fxPositionsHtml()}</tbody></table></section>`;
}

// FXの手がかり：記憶の断片と、偵察・東京で聞いた噂
function hintsSection() {
  // 過ぎた出来事は出さない（答え合わせは周回の終わりに）
  const mems = game.knownMemories().filter((m) => m.period.to >= game.date);
  const memHtml = mems.length
    ? mems.map((m) => `<div class="card"><div class="title"><span>${m.when}ごろ${m.title ? `：${m.title}` : ""}</span></div>
          ${m.memory ? `<div class="small">${m.memory}</div>` : ""}<div class="small warn">${m.effect}</div></div>`).join("")
    : '<p class="muted small">いまは、思い出せることがない。</p>';
  const hints = game.activeHints();
  const hintHtml = hints.length
    ? hints.map((h) => `<div class="small">・${h.text}<span class="muted">（${h.source ? `${h.source}で集めた噂` : `${CONFIG.cities.find((c) => c.currency === h.ccy)?.name ?? ""}で偵察したときの噂`}）</span></div>`).join("")
    : '<p class="muted small">なし（偵察などで噂を聞ける）</p>';
  const left = game.memories.filter((m) => m.recallAt > game.date).length;
  return `<section><h2>手がかり${ti("memories")}</h2>
    <h3 class="small">記憶の断片</h3>${memHtml}
    ${left ? `<p class="muted small">まだ思い出していない断片がある。</p>` : ""}
    <h3 class="small">噂</h3>${hintHtml}</section>`;
}

function widthOf(v) {
  const n = Number(v);
  return v === "" || v == null || !(n > 0) ? null : n;
}

function levels(side, base, slW, tpW) {
  const dir = side === "buy" ? 1 : -1;
  return {
    stopLoss: slW == null ? null : round3(base - dir * slW),
    takeProfit: tpW == null ? null : round3(base + dir * tpW),
  };
}

function pnlAt(side, entry, units, price) {
  return (price - entry) * units * (side === "buy" ? 1 : -1);
}

// 実効レバレッジの表示
function levText(v) {
  return v === Infinity ? "—" : `${v.toFixed(1)}倍`;
}
function levClass(v) {
  return v === Infinity || v < 5 ? "" : v < 15 ? "warn" : "down";
}

// ロスカットまでの距離（このポジションだけが逆に動いたときの目安）。値幅が値段の何%かで色を変える
function losscutText(p) {
  const d = game.losscutDistance(p);
  const cls = d.share < 0.015 ? "down" : d.share < 0.04 ? "warn" : "";
  return `<span class="${cls}">ロスカットまで あと約${d.width.toFixed(2)}円（目安 ${px(d.price)}）</span>`;
}

// 注文前の確認：損切り・利確の値段と損益、資金に対するリスク
function updateOrderPreview() {
  const el = $("orderPreview");
  if (!el) return;
  const f = ui.fx;
  const pr = game.prices();
  const st = game.status();
  const units = Number(f.units) || 0;
  const lev = st.maxLeverage;
  const slW = widthOf(f.sl);
  const line = (side) => {
    const entry = game.account.entryPrice(f.ccy, side, pr[f.ccy]);
    const { stopLoss, takeProfit } = levels(side, entry, slW, widthOf(f.tp));
    return `<span class="${side === "buy" ? "up" : "down"}">${side === "buy" ? "買い" : "売り"}</span> ${px(entry)}　` +
      (stopLoss == null ? "損切りなし" : `損切り ${px(stopLoss)}（<span class="down">${signedYen(pnlAt(side, entry, units, stopLoss))}</span>）`) + "　" +
      (takeProfit == null ? "利確なし" : `利確 ${px(takeProfit)}（<span class="up">${signedYen(pnlAt(side, entry, units, takeProfit))}</span>）`);
  };
  const required = (units * pr[f.ccy]) / lev;
  const wage = game.dailyWagesYen() + game.dailyTrainingYen();
  const afterAvail = Math.max(0, st.available - required);
  let risk;
  if (slW != null) {
    const loss = slW * units;
    const share = st.equity > 0 ? loss / st.equity : 1;
    risk = `<span class="${share > 0.2 ? "down" : share > 0.08 ? "warn" : "muted"}">損切りに届くと資金の${pct(share)}を失う${wage ? `（日給${Math.floor(loss / wage)}日分）` : ""}</span>`;
  } else {
    // 損切りなし：ロスカットまでの値幅
    const room = Math.max(0, st.equity - (st.required + required) * CONFIG.fx.losscutRatio) / Math.max(1, units);
    risk = `<span class="warn">損切りなし。${room.toFixed(2)}円ほど逆に動くとロスカット</span>`;
  }
  const short = wage > 0 && afterAvail < wage * 3 ? `<br><span class="down">注文後の使える額は約${yen(afterAvail)}。日給・訓練費の${Math.floor(afterAvail / wage)}日分しか残らない</span>` : "";
  const effAfter = game.effectiveLeverage({ ccy: f.ccy, units });
  const lv = $("orderLev");
  if (lv) lv.innerHTML = `実効レバレッジ <span class="${levClass(effAfter)}">${levText(effAfter)}</span>`;
  el.innerHTML = `${line("buy")}<br>${line("sell")}<br><span class="muted">必要証拠金 約${yen(required)}／1円動くと ${yen(units)} の損益</span><br>` +
    `<span class="muted">実効レバレッジは注文後の見込み（ポジションの金額の合計が資金の何倍か）</span><br>${risk}${short}`;
}

// ───────── 出撃準備 ─────────

function renderPrep() {
  const m = game.findMission(ui.prep.key);
  if (!m) {
    ui.view = "main";
    return render();
  }
  const pr = game.prices();
  const enemies = m.scouted
    ? m.stages.map((st, i) => `${i + 1}戦目：${enemyText(st)}`).join("<br>")
    : `<span class="muted">不明（出現率の目安：${tendency(CONFIG.cities.find((c) => c.id === m.cityId), m.tier)}）</span>`;
  const avail = game.available();
  const resting = game.members.filter((x) => game.isInjured(x));
  const party = avail.map((x) => `${x.name}（${CONFIG.weapons[x.weapon].name}・${x.row === "front" ? "前" : "後"}）`).join("、");
  const ammo = Object.entries(CONFIG.ammoTypes).filter(([k]) => game.ammo[k] > 0).map(([k, a]) => `${a.name}${game.ammo[k]}`).join("、") || "なし";
  const noStop = game.account.positions.filter((p) => p.stopLoss == null).length;
  const st = game.status();
  const fxWarn = game.account.positions.length
    ? `<p class="${noStop ? "down" : "warn"} small">未決済のポジションが${game.account.positions.length}件ある。この探索では${m.days}日たち、その間は取引できない（相場は動き続け、損切り・利確・ロスカットは働く）。</p>
       ${game.account.positions.map((p) => {
         const pnl = game.account.unrealized(p, pr[p.ccy]);
         return `<div class="card small"><div>${pair(p.ccy)} <span class="${p.side === "buy" ? "up" : "down"}">${p.side === "buy" ? "買い" : "売り"}</span> ${p.units.toLocaleString()}通貨　含み損益 <span class="${signClass(pnl)}">${signedYen(pnl)}</span></div>
           <div>${p.stopLoss != null ? `損切り ${px(p.stopLoss)}` : '<span class="down">損切りなし：出かけている間に急変すると、ロスカットまで止まらない</span>'}　${p.takeProfit != null ? `利確 ${px(p.takeProfit)}` : "利確なし"}</div>
           <div>${losscutText(p)}</div></div>`;
       }).join("")}
       <p class="small">維持率 ${pct(st.ratio)}／実効レバレッジ <span class="${levClass(game.effectiveLeverage())}">${levText(game.effectiveLeverage())}</span></p>`
    : `<p class="muted small">ポジションなし。出撃中の${m.days}日間は取引できない。</p>`;
  const wageCost = game.dailyWagesYen() * m.days;
  const why = game.canSortie(m);
  const noMedic = !avail.some((x) => x.role === "medic");

  app.innerHTML = topbar(toastHtml()) + `
    <section><h1 style="margin-top:0">出撃準備</h1>
      <div class="kv small">
        <div>探索</div><div>${m.cityName}・${m.tierName}</div>
        <div>敵Lv・戦闘数・日数</div><div><span class="${levelClass(m.level)}">Lv${m.level}</span>・${m.stages.length}戦・${m.days}日</div>
        <div>売却額</div><div>${money(m.rewardLocal, m.currency)}（約${yen(game.receiveYen(m.rewardLocal, m.currency))}）${m.feathers ? (m.special ? `＋位相残晶${m.feathers}個` : `＋位相残晶${m.feathers}〜${m.feathers + m.days}個（${m.feathers}個は確実）`) : ""}</div>
        <div>日給（${m.days}日分）</div><div>約${yen(wageCost)}</div>
        <div>差し引き（弾・${MEDKIT}の代金は別）</div><div class="${game.receiveYen(m.rewardLocal, m.currency) >= wageCost ? "up" : "down"}">約${yen(game.receiveYen(m.rewardLocal, m.currency) - wageCost)}</div>
      </div>
      <p class="small">敵：${enemies}${ti("stages")}</p></section>
    <section><h2>出撃する部隊と所持品</h2>
      <p class="small">${party}</p>
      ${resting.length ? `<p class="warn small">負傷して休む：${resting.map((x) => `${x.name}（あと${game.injuryDaysLeft(x)}日）`).join("、")}</p>` : ""}
      <p class="small">弾：${ammo}／${MEDKIT}：${game.medkits}個${noMedic ? ' <span class="warn">（衛生兵がいないので使われない）</span>' : ""}</p>
      <div id="ammoGuide" class="small"></div>
      <div class="row"><button class="mini" data-act="tab" data-tab="town">造兵廠へ</button><button class="mini" data-act="tab" data-tab="party">編成へ</button></div></section>
    <section><h2>作戦</h2>
      <div class="row"><label>弾の方針 <select data-change="policy">${Object.entries(CONFIG.ammoPolicies).map(([k, v]) => opt(k, v, k === ui.policy)).join("")}</select></label></div>
      <div class="row"><label>撤退ライン <select data-change="retreat">${[0, 0.2, 0.3, 0.4, 0.5].map((v) => opt(v, v ? `体力が${v * 100}%を下回った人から退く` : "なし（最後まで戦う）", v === ui.retreatLine)).join("")}</select></label>${ti("retreat")}</div></section>
    <section><h2>勝率の見立て${ti("prediction")}</h2><div id="pred" class="kv"><div class="muted">計算中…</div><div></div></div></section>
    <section><h2>改善案</h2><div id="sugg" class="small muted">${m.scouted ? "計算中…" : `偵察すると、詳細な情報を把握できる
      ${m.cityId === game.cityId ? `<div class="row"><button class="mini" data-act="scoutFromPrep" data-key="${m.key}">偵察する（${game.scoutDays()}日）</button></div>` : ""}`}</div></section>
    <section><h2>FX口座</h2>${fxWarn}<div class="row"><button class="mini" data-act="tab" data-tab="fx">FX口座へ</button></div></section>
    ${why ? `<p class="down small">${why}</p>` : ""}
    <div class="row between"><button data-act="cancelPrep">戻る</button><button class="go" data-act="launch" ${why ? "disabled" : ""}>出撃する</button></div>`;
  setTimeout(() => fillPrediction(m), 30);
}

function fillPrediction(m) {
  if (ui.view !== "prep" || !$("pred")) return;
  const options = { policy: ui.policy, retreatLine: ui.retreatLine };
  const p = game.predict(m, options);
  ui.prep.prediction = p;
  const loc = (base) => money(base.toFixed(1), m.currency);
  const color = (w) => (w >= 0.7 ? "up" : w < 0.4 ? "down" : "warn");
  const names = Object.fromEntries(game.members.map((x) => [x.id, x.name]));
  const risky = Object.entries(p.downRisk).filter(([, v]) => v >= 0.2).map(([k, v]) => `${names[k]} ${pct(v)}`).join("、") || "なし";
  // 偵察前は勝率だけ（敵の編成が分からないので、細かい見立てはできない）
  if (!p.scouted) {
    $("pred").innerHTML = `<div>勝率</div><div class="big ${color(p.winRate)}">約${pct(p.winRate)}</div>
       <div class="muted small">　敵の編成しだいで</div><div class="muted small">${pct(p.winLow)}〜${pct(p.winHigh)}</div>
       <div class="muted small">偵察すると、詳細な情報を把握できる</div><div></div>`;
    return;
  }
  const head = `<div>勝率</div><div class="big ${color(p.winRate)}">${pct(p.winRate)}</div>`;
  $("pred").innerHTML = `${head}
    <div>撤退・時間切れ</div><div>${pct(p.retreatRate)}</div>
    <div>全滅</div><div class="${p.wipeRate > 0.02 ? "down" : ""}">${pct(p.wipeRate)}</div>
    <div>突破する戦闘の数</div><div>平均 ${p.avgStagesCleared.toFixed(1)}/${m.stages.length}</div>
    <div>戦闘の時間</div><div>合計 約${p.avgSeconds.toFixed(0)}秒</div>
    <div>消費する弾薬・${MEDKIT}</div><div>平均 ${loc(m.currency ? game.localPrice(p.avgCostBase, m.currency) : p.avgCostBase)}</div>
    <div>弾切れの恐れ</div><div class="${p.ammoShortRate > 0.1 ? "warn" : ""}">${pct(p.ammoShortRate)}</div>
    <div>倒れる恐れ</div><div class="small">${risky}</div>`;

  // 弾の使用量の目安
  const rows = Object.entries(CONFIG.ammoTypes)
    .filter(([k]) => p.avgUsed[k] >= 1 || game.ammo[k] > 0)
    .map(([k, a]) => {
      const need = Math.ceil(p.avgUsed[k]);
      const short = need > game.ammo[k] * 0.9;
      return `<span class="${short ? "warn" : "muted"}">${a.name} 使う目安${need}／所持${game.ammo[k]}</span>`;
    });
  if (rows.length) $("ammoGuide").innerHTML = `<p>${rows.join("　")}</p>`;
  setTimeout(() => fillSuggestions(m, options), 30);
}

function fillSuggestions(m, options) {
  if (ui.view !== "prep" || !$("sugg")) return;
  const s = game.suggestions(m, options);
  ui.prep.suggestions = s.items;
  // 買い物では足りないとき、部隊の弱点を示す
  const avail = game.available();
  const hints = [];
  if (s.base.winRate < 0.7) {
    if (!avail.some((x) => x.role === "medic")) hints.push(`衛生兵がいない（${MEDKIT}で回復できない）`);
    if (!avail.some((x) => x.role === "tank")) hints.push("盾役がいない（前列が倒れやすい）");
    if (avail.length < CONFIG.party.maxMembers - 1) hints.push(`部隊が${avail.length}人しかいない`);
  }
  const buys = s.items.map((x, i) => `<div class="row between" style="margin:4px 0"><span class="small">${x.label}：勝率 <span class="up">+${Math.round(x.delta * 100)}%</span>（${yen(x.yen)}）</span>
        <button class="mini" data-act="buySuggestion" data-i="${i}" ${m.cityId !== game.cityId ? "disabled" : ""}>買う</button></div>`).join("");
  $("sugg").innerHTML = (buys || `<p class="muted small">弾や${MEDKIT}を足しても、勝率はほとんど変わらない。</p>`) +
    (hints.length ? `<p class="warn small">${hints.join("<br>")}</p>` : "");
}

// ───────── 出撃（戦闘とチャートを同時に再生） ─────────

const SPEEDS = [1, 2, 4];

function launch() {
  saveGame({ type: "sortie", key: ui.prep.key, options: { policy: ui.policy, retreatLine: ui.retreatLine } });
  const before = game.status().equity;
  const r = game.beginSortie(ui.prep.key, { policy: ui.policy, retreatLine: ui.retreatLine });
  if (!r.ok) return toast(r.error, true);
  const held = r.frames[0]?.positions ?? [];
  const n = r.mission.stages.length;
  ui.sortie = {
    s: r,
    run: r.run,
    frames: r.frames,
    equityBefore: before,
    // 1戦あたりの予想時間（チャートの進み方を戦闘に合わせる）
    expected: Math.max(4, (ui.prep.prediction?.avgSeconds ?? 12 * n) / Math.max(1, ui.prep.prediction?.avgStagesCleared || n)),
    i: 0,
    acc: 0,
    last: performance.now(),
    speed: 0,
    lastEvent: 0,
    lastHit: {},
    ccy: held.length ? held[0].ccy : r.mission.currency,
    warnedAmmo: false,
    phase: "battle", // battle / interlude / tail / done
    pauseUntil: 0,
  };
  ui.view = "sortie";
  ui.toast = null;
  buildSortieView();
  setStageRange();
  requestAnimationFrame(sortieTick);
}

// 決戦：戦闘だけを再生する（FXのポジションは決済済み）
function launchFinal() {
  if (!game.deviceComplete() && !confirm(`対抗装置が${game.deviceStage ? "未完成です" : "ありません"}。\n${deviceMissingText()}。\nそれでも決戦に臨みますか？`)) return;
  saveGame({ type: "final", options: { policy: ui.policy } });
  const r = game.startFinal({ policy: ui.policy });
  if (!r.ok) return toast(r.error, true);
  const f = game.market.midPrices(game.date);
  const frame = { date: game.date, step: game.market.steps, trading: false, prices: f, status: game.status(), positions: [], events: [] };
  const mission = { cityName: "ブラックスワン", tierName: "決戦", stages: r.forms.map((x) => x.enemies), days: 0, final: true };
  ui.sortie = {
    s: { mission, run: r.run, frames: [frame], events: [], wages: 0, left: [] },
    final: true,
    run: r.run,
    frames: [frame],
    equityBefore: game.status().equity,
    expected: 30,
    i: 0, acc: 0, last: performance.now(), speed: 0, lastEvent: 0, lastHit: {},
    ccy: game.market.currencies[0], warnedAmmo: false, phase: "battle", pauseUntil: 0,
  };
  ui.view = "sortie";
  ui.toast = null;
  buildSortieView();
  setStageRange();
  requestAnimationFrame(sortieTick);
}

// いまの戦闘が受け持つチャートの範囲（任務の日数を戦闘の数で分ける）
function setStageRange() {
  const s = ui.sortie;
  const n = s.frames.length - 1;
  const k = s.run.stageIndex;
  const count = s.run.stageCount;
  s.stageStart = Math.round((k / count) * n);
  s.stageEnd = Math.round(((k + 1) / count) * n);
  s.i = Math.max(s.i, s.stageStart);
}

function buildSortieView() {
  const s = ui.sortie;
  const m = s.s.mission;
  app.innerHTML = `
    <div class="topbar static"><div class="row between" style="margin:0">
      <span class="warn">${m.cityName}・${m.tierName}</span><span id="sStage" class="small"></span></div>
      <div id="sClock" class="small"></div>
      <div class="bar"><div id="sBar"></div></div></div>
    <section id="sortieBox" style="margin-top:6px"><div id="sField"></div></section>
    <section id="chartBox">
      <div class="row between" style="margin:0 0 4px"><select id="sCcy">${game.market.currencies.map((c) => opt(c, pair(c), c === s.ccy)).join("")}</select>
        <span id="sPnl"></span></div>
      <canvas id="sChart" style="height:130px"></canvas>
      <div id="sRatio" class="small muted"></div>
    </section>
    <section><pre id="sLog" style="min-height:4.5em"></pre></section>
    <div class="row" id="sControls">
      <button class="danger" data-act="retreat">撤退</button>
      <select data-change="livePolicy">${Object.entries(CONFIG.ammoPolicies).map(([k, v]) => opt(k, v, k === s.run.policy)).join("")}</select>
      <button data-act="speed" id="sSpeed">速度 ×${SPEEDS[s.speed]}</button>
      <button data-act="skip">結果まで飛ばす</button>
    </div>`;
  $("sCcy").addEventListener("change", (e) => {
    s.ccy = e.target.value;
    drawSortieFrame();
  });
  if (s.final) {
    $("chartBox").hidden = true;
    app.querySelector('[data-act="retreat"]').hidden = true;
  }
  buildField();
}

// いまの戦闘の敵と味方の札を並べる
function buildField() {
  const b = ui.sortie.run.battle;
  const card = (u) => `<div class="unit ${u.side}" id="u-${u.id}"><div class="name">${u.name}</div><div class="hpbar"><div></div></div><span class="pop"></span></div>`;
  // ブラックスワン：立ち絵の下部に体力バーを重ねる（立ち絵は config の enemyTypes[型].portrait）
  const portrait = (u) => CONFIG.enemyTypes[u.type]?.portrait;
  const bossCard = (u) => `<div class="unit enemy boss" id="u-${u.id}">
      <img class="boss-art" src="${portrait(u)}" alt="">
      <div class="boss-foot"><div class="name">${u.name}</div><div class="hpbar"><div></div></div></div><span class="pop"></span></div>`;
  const bosses = b.enemies.filter(portrait);
  const others = b.enemies.filter((u) => !portrait(u));
  const front = b.allies.filter((a) => a.row === "front");
  const back = b.allies.filter((a) => a.row === "back");
  $("sField").innerHTML = `
    ${bosses.map(bossCard).join("")}
    <div class="rowlabel">${bosses.length ? "取り巻き" : "敵"}（${others.length}体）</div><div class="field ${others.length > 8 ? "compact" : ""}">${others.map(card).join("") || '<span class="muted small">なし</span>'}</div>
    <div class="rowlabel">前列</div><div class="field">${front.map(card).join("") || '<span class="muted small">なし</span>'}</div>
    <div class="rowlabel">後列</div><div class="field">${back.map(card).join("") || '<span class="muted small">なし</span>'}</div>`;
  ui.sortie.compact = others.length > 8;
  ui.sortie.lastEvent = 0;
  ui.sortie.lastHit = {};
}

function sortieTick(now) {
  const s = ui.sortie;
  if (!s || ui.view !== "sortie") return;
  const run = s.run;
  const b = run.battle;
  const dt = Math.min(0.25, (now - s.last) / 1000) * SPEEDS[s.speed];
  s.last = now;
  const n = s.frames.length - 1;

  if (s.phase === "battle") {
    if (!b.done) {
      s.acc += dt;
      const tick = CONFIG.battle.tick;
      while (s.acc >= tick && !b.done) {
        b.step();
        s.acc -= tick;
      }
      // 予想より長引いたら、チャートの終わりも延ばす（戦闘が終わるまでその区間は終わらない）
      if (b.t > s.expected * 0.95) s.expected = b.t / 0.95;
      const span = s.stageEnd - s.stageStart;
      advanceChartTo(Math.min(s.stageEnd - 1, s.stageStart + Math.floor((b.t / s.expected) * span)));
    } else {
      // 戦闘が終わった：区間の終わりまでチャートを早送りしてから次へ
      advanceChartTo(Math.min(s.stageEnd, s.i + Math.max(1, Math.ceil(n / 60))));
      if (s.i >= s.stageEnd) {
        consumeBattleEvents();
        const more = run.nextStage();
        if (more) {
          s.phase = "interlude";
          s.pauseUntil = now + 1400 / SPEEDS[s.speed];
          sortieLog(s.final ? `── ブラックスワンが姿を変える（${run.stageIndex + 1}/${run.stageCount}）──` : `── ${run.stageIndex}戦目を突破。次の戦場へ（${run.stageIndex + 1}/${run.stageCount}戦目）──`);
        } else {
          s.phase = "tail"; // 任務は終わった。残りの日数を早送り
        }
      }
    }
  } else if (s.phase === "interlude") {
    if (now >= s.pauseUntil) {
      setStageRange();
      buildField();
      s.phase = "battle";
    }
  } else if (s.phase === "tail") {
    advanceChartTo(Math.min(n, s.i + Math.max(1, Math.ceil(n / 50))));
    if (s.i >= n) {
      s.phase = "done";
      setTimeout(finishSortie, 700);
    }
  }
  if (s.phase === "battle" || s.phase === "tail") consumeBattleEvents();
  drawSortieFrame();
  if (s.phase !== "done") requestAnimationFrame(sortieTick);
}

function advanceChartTo(target) {
  const s = ui.sortie;
  const n = s.frames.length - 1;
  target = Math.min(n, target);
  while (s.i < target) {
    s.i++;
    for (const ev of s.frames[s.i].events) {
      const text = describeEvent(ev);
      if (!text) continue;
      sortieLog(text.replace(/^\S+ /, "")); // 日付は省く
      if (ev.type === "losscut" || ev.type === "stopLoss") {
        const box = $("chartBox");
        box.classList.remove("flash");
        void box.offsetWidth;
        box.classList.add("flash");
      }
    }
  }
}

function sortieLog(text) {
  const el = $("sLog");
  if (!el) return;
  el.textContent = [text, ...el.textContent.split("\n").filter(Boolean)].slice(0, 6).join("\n");
}

function consumeBattleEvents() {
  const s = ui.sortie;
  const b = s.run.battle;
  const name = (id) => [...b.allies, ...b.enemies].find((u) => u.id === id)?.name ?? id;
  for (; s.lastEvent < b.events.length; s.lastEvent++) {
    const ev = b.events[s.lastEvent];
    if (ev.kind === "hit") {
      s.lastHit[ev.to] = { t: ev.t, text: `${Math.round(ev.damage)}${ev.crit ? "会心" : ""}${ev.mark ?? ""}`, cls: ev.mark === "特効" ? "eff" : ev.mark === "半減" ? "res" : "" };
    } else if (ev.kind === "hurt") {
      s.lastHit[ev.to] = { t: ev.t, text: `-${Math.round(ev.damage)}${ev.strong ? "強撃" : ""}`, cls: "" };
    } else if (ev.kind === "heal") {
      s.lastHit[ev.to] = { t: ev.t, text: `+${Math.round(ev.amount)}`, cls: "heal" };
    } else if (ev.kind === "enemyDown") sortieLog(`${name(ev.id)}を倒した`);
    else if (ev.kind === "allyDown") sortieLog(`★${name(ev.id)}が戦闘不能`);
    else if (ev.kind === "policy") sortieLog(`弾の方針：${CONFIG.ammoPolicies[ev.policy]}`);
    else if (ev.kind === "withdraw") sortieLog(`${name(ev.id)}が戦闘から退いた`);
    else if (ev.kind === "end") sortieLog({ win: "敵をすべて倒した", retreat: "撤退した", wipe: "部隊が全滅した", timeout: "時間切れ。撤退する" }[ev.outcome]);
  }
  if (b.fallbackShots && !s.warnedAmmo) {
    s.warnedAmmo = true;
    sortieLog("弾切れ。近接攻撃に切り替わった");
  }
}

function drawSortieFrame() {
  const s = ui.sortie;
  const run = s.run;
  const b = run.battle;
  const f = s.frames[s.i];
  for (const u of [...b.allies, ...b.enemies]) {
    const el = $(`u-${u.id}`);
    if (!el) continue;
    el.classList.toggle("dead", !u.alive);
    el.querySelector(".hpbar > div").style.width = `${(u.hp / u.maxHp) * 100}%`;
    const pop = el.querySelector(".pop");
    const h = s.lastHit[u.id];
    if (h && b.t - h.t < 0.5) {
      // 敵が多くて札が小さいときは、数字だけ（特効・半減は色で示す）
      pop.textContent = s.compact && u.side === "enemy" ? h.text.replace(/[^0-9+-]/g, "") : h.text;
      pop.className = `pop ${h.cls}`;
    } else pop.textContent = "";
  }
  const steps = game.market.steps;
  const hh = Math.floor((f.step * 24) / steps);
  const mm = Math.round(((f.step * 24 * 60) / steps) % 60);
  const time = !f.trading && f.step ? "休場" : f.step === 0 ? "出発" : `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const unit = s.final ? "形態" : "戦目";
  const label = s.phase === "tail" || run.done ? (s.final ? "決着" : "帰還中") : s.phase === "interlude" ? "移動中" : `${run.stageIndex + 1}/${run.stageCount}${unit} ${b.t.toFixed(1)}秒`;
  $("sStage").textContent = label;
  $("sClock").textContent = `${formatJa(f.date)} ${time}`;
  $("sBar").style.width = `${(s.i / Math.max(1, s.frames.length - 1)) * 100}%`;
  const st = f.status;
  $("sPnl").innerHTML = `含み損益 <span class="${signClass(st.unrealized)}">${signedYen(st.unrealized)}</span>`;
  $("sRatio").innerHTML = st.ratio === Infinity
    ? "ポジションなし"
    : `維持率 <span class="${st.ratio < 1 ? "down" : st.ratio < 2 ? "warn" : ""}">${pct(st.ratio)}</span>　有効証拠金 ${yen(st.equity)}`;
  drawSortie($("sChart"), s.frames, s.i, s.ccy);
  const ctl = $("sControls");
  if (ctl) ctl.hidden = s.phase !== "battle" || b.done;
}

function finishSortie() {
  const s = ui.sortie;
  if (!s) return;
  if (s.final) {
    game.finishFinal(s.run);
    ui.sortie = null;
    ui.view = "end";
    return render();
  }
  const r = game.finishSortie(s.s);
  saveGame(); // 決着した状態を保存（出撃中の印を消す）
  ui.result = {
    mission: s.s.mission,
    r,
    wages: s.s.wages,
    left: s.s.left,
    equityBefore: s.equityBefore,
    equityAfter: game.status().equity,
    fxEvents: s.s.events.map(describeEvent).filter(Boolean),
  };
  ui.sortie = null;
  ui.view = "result";
  render();
}

// ───────── 結果 ─────────

function renderResult() {
  const { mission: m, r, wages, left, equityBefore, equityAfter, fxEvents } = ui.result;
  const res = r.result;
  const label = { win: "探索成功", retreat: "撤退", wipe: "全滅" }[res.outcome];
  const used = Object.entries(res.used).filter(([, n]) => n > 0).map(([k, n]) => `${CONFIG.ammoTypes[k].name}${n}`).join("、") || "なし";
  const fxPart = equityAfter - equityBefore - r.rewardYen + wages;
  const fxEffect = r.rewardYen - r.rewardYenAtStart;
  const total = equityAfter - equityBefore;
  const wipe = res.outcome === "wipe";
  app.innerHTML = topbar() + `
    <section><h1 class="${res.outcome === "win" ? "up" : "down"}" style="margin-top:0">${label}</h1>
      <p class="muted small">${m.cityName}・${m.tierName}　${res.stagesCleared}/${res.stageCount}戦突破　戦闘 合計${res.seconds.toFixed(1)}秒</p>
      ${wipe ? `<p class="down">部隊が全滅した。${HERO}は${CONFIG.party.heroWipeInjuryDays}日休養が必要。</p>` : ""}
      <div class="kv">
        <div>回収品の売却</div><div class="up">${r.rewardYen ? `+${yen(r.rewardYen)}` : "なし"}</div>
        ${r.rewardYen ? `<div class="muted small">　${money(r.rewardLocal, m.currency)}${res.outcome === "win" ? "" : "（一部）"}</div><div class="muted small">為替の影響 ${signedYen(fxEffect)}</div>` : ""}
        <div>日給（${m.days}日分）</div><div class="down">-${yen(wages)}</div>
        <div>出撃中のFX損益</div><div class="${signClass(fxPart)}">${signedYen(fxPart)}</div>
        <div class="muted small">　含み損益の変化・スワップ込み</div><div></div>
        <div><b>資金の増減</b></div><div class="${signClass(total)}"><b>${signedYen(total)}</b></div>
      </div></section>
    <section><h2>部隊</h2>
      ${r.lost.length ? `<p class="down small">死亡：${r.lost.join("、")}（銃は予備に残る）</p>` : ""}
      ${r.injured.length ? `<p class="warn small">負傷して休む：${r.injured.join("、")}</p>` : ""}
      ${left.length ? `<p class="down small">日給の未払いで去った仲間：${left.join("、")}</p>` : ""}
      ${!r.lost.length && !r.injured.length && !left.length ? '<p class="small">全員無事</p>' : ""}
      ${r.rareWeapon ? `<p class="small up">★特殊な銃「${CONFIG.weapons[r.rareWeapon].name}」（Lv${game.weaponLevel(r.rareWeapon)}）を手に入れた。「部隊」で持たせられる。</p>` : ""}
      ${r.leveled?.length ? `<p class="small up">戦いの経験でLvが上がった：${leveledText(r.leveled)}</p>` : ""}
      ${r.feathers ? `<p class="small warn">位相残晶を${r.feathers}個回収した（所持 ${game.feathers}）</p>` : ""}
      <p class="small muted">使った弾：${used}／${MEDKIT}：${res.usedMedkits}個</p></section>
    ${fxEvents.length ? `<section><h2>出撃中の相場の出来事</h2><pre>${fxEvents.join("\n")}</pre></section>` : ""}
    <div class="row"><button class="go" data-act="afterResult">町へ戻る</button></div>`;
}

// ───────── 周回の終わり ─────────

function renderEnd() {
  const st = game.status();
  const o = game.over;
  const endings = {
    funds: `<h1 class="up" style="margin-top:0">クリア：エンド2（掌握・真エンド）</h1>
      <p>財団の株式の過半数を握り、「${CONFIG.endgame.shares.research}」を止めた。</p>
      <p>ドゥームズデイは来なかった。ブラックスワンという名前を、もう誰も知ることはない。</p>`,
    battle: `<h1 class="up" style="margin-top:0">クリア：エンド1（打破）</h1>
      <p>${formatJa(game.deadline)}、${game.deviceComplete() ? "対抗装置を建造し、" : game.deviceStage ? "未完成の対抗装置の力を借りて、" : "対抗装置なしで、"}部隊はブラックスワンを討ち果たした。</p>
      <p>破局は退けられた。世界は、残された爪痕の復興に向けて進んでいる。</p>`,
    bossDefeat: `<h1 class="down" style="margin-top:0">ゲームオーバー：エンド3（敗北）</h1>
      <p>ブラックスワンは止まらなかった。</p>`,
    bankrupt: `<h1 class="down" style="margin-top:0">ゲームオーバー：エンド4（破滅）</h1><p>破産した。お金は計画的に使おう。</p>`,
  };
  const head = o.reason === "clear" ? endings[o.route] : endings[o.reason];
  const diff = st.equity - CONFIG.run.initialFunds;
  const s = game.stats;
  app.innerHTML = `
    <section style="margin-top:16px">${head}
      <div class="kv">
        <div>期間</div><div>${formatJa(game.startDate)}〜${formatJa(game.date)}</div>
        <div>最終資金</div><div>${yen(st.equity)}</div>
        <div>初期資金からの増減</div><div class="${signClass(diff)}">${signedYen(diff)}</div>
        <div>対抗装置</div><div>${game.deviceStage}/${CONFIG.endgame.device.length}段階</div>
        <div>財団の株式</div><div>${game.shares.toFixed(1)}%</div>
        ${s["final.formsTotal"] ? `<div>決戦で倒した形態</div><div>${s["final.formsCleared"]}/${s["final.formsTotal"]}</div>` : ""}
        <div>部隊</div><div>${game.members.length}人（${partyLevelText()}）</div>
        <div>失った仲間</div><div>${game.lost.length}人</div>
        <div>回収品の売却（合計）</div><div>${yen(s["income.reward"] ?? 0)}</div>
        <div>FXの損益（合計）</div><div class="${signClass((s["income.fx"] ?? 0) + (s["income.swap"] ?? 0))}">${signedYen((s["income.fx"] ?? 0) + (s["income.swap"] ?? 0))}</div>
        <div>FXの取引回数</div><div>${game.account.closed.length}回</div>
      </div></section>
    <section><h2>この期間の相場</h2>
      <canvas id="endChart" style="height:200px"></canvas>
      <p class="muted small">4通貨の円に対する値動き（周回の初日を100とした）。縦線は下の出来事。</p>
      ${answerKeyHtml()}</section>
    <section><h2>この周回の記録</h2><pre style="max-height:300px;overflow:auto">${game.logs.map((l) => l.text).join("\n")}</pre></section>
    <div class="row"><button class="go" data-act="toTitle">タイトルへ</button></div>`;
}

// 答え合わせ：期間中に実際に起きた出来事
function answerKeyHtml() {
  const list = game.answerKey();
  if (!list.length) return '<p class="muted small">この期間には、大きな出来事はなかった。</p>';
  return list.map((e, i) => `<div class="card"><div class="title"><span>${i + 1}. ${formatJa(e.date)}　${e.title ?? "（一覧にない大きな値動き）"}</span>
      <span class="small ${e.recalled ? "up" : "muted"}">${e.recalled ? "思い出した" : "思い出せなかった"}</span></div>
      ${e.title ? `<div class="small">${e.memory}</div>` : ""}
      <div class="small warn">${e.effect.replace("気がする。", "。")}</div>
      <div class="small muted">${Object.entries(e.moves).map(([c, v]) => `${c} ${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`).join("　")}（前日〜${CONFIG.hints.memory.effectDays}日後）</div></div>`).join("");
}

// ───────── 決戦 ─────────

// ブラックスワンの形態の弱点（特効の弾の名前。config の敵の型から）
function weakText(type) {
  const mods = CONFIG.enemyTypes[type]?.mods ?? {};
  const top = Math.max(0, ...Object.values(mods));
  const names = Object.entries(mods).filter(([, v]) => v === top && v > 1).map(([k]) => CONFIG.ammoTypes[k].name);
  return names.join("・") || "？";
}

function finalTab() {
  const eg = CONFIG.endgame;
  const busy = game.busyReason();
  const devRows = deviceRows(busy);
  const sh = eg.shares;
  const next1 = game.shareCost(1);
  const forms = game.bossForms();
  const formRows = forms.map((f) => {
    const boss = f.enemies[0];
    const others = enemyText(f.enemies.slice(1));
    return `<div class="card"><div class="title"><span>${f.name}</span><span class="small warn">弱点：${weakText(boss.type)}</span></div>
      <div class="small muted">取り巻き：${others || "なし"}</div></div>`;
  }).join("");
  const perk = game.perk();
  return `
    <section><h1 style="margin-top:0">決戦への備え</h1>
      <p class="small">ドゥームズデイ（${formatJa(game.deadline)}）、ブラックスワンは東京に顕現する。その日が近づくと、部隊は自動で東京へ戻る。</p></section>
    <section><h2>対抗装置（${game.deviceStage}/${eg.device.length}段階）${ti("lab")}</h2>
      <p class="small">位相残晶：<b class="warn">${game.feathers}</b></p>
      <table>${devRows}</table></section>
    <section><h2>財団の株式（保有 ${game.shares.toFixed(1)}%）${ti("shares")}</h2>
      <div class="kv small">
        <div>次の1%の値段</div><div>${yen(next1)}</div>
        <div>この期間の値段の補正</div><div>×${game.periodFactor.toFixed(2)}</div>
        <div>毎月の配当</div><div>${yen(game.sharesPaid * sh.dividendMonthly)}（払った額の${(sh.dividendMonthly * 100).toFixed(1)}%）</div>
        <div>株主優待</div><div>${perk ? `造兵廠${pct(perk.discount)}引き・毎月 ${giftText(perk.gift)}` : "なし"}</div>
      </div>
      <div class="row"><button class="mini" data-act="buyShares" data-n="1" ${busy ? "disabled" : ""}>+1%（${yen(next1)}）</button>
        <button class="mini" data-act="buyShares" data-n="5" ${busy ? "disabled" : ""}>+5%（${yen(game.shareCost(5))}）</button></div></section>
    <section><h2>ブラックスワン（観測の記録）${ti("boss")}</h2>
      <p class="small">レベル：<b class="${levelClass(game.bossLevel())}">Lv${game.bossLevel()}</b>（株式なしならLv${eg.bossLevel}。買った株式 ${game.sharesBought}%）　部隊：${partyLevelText()}</p>
      ${formRows}
      <p class="small">持っていく量の目安：${Object.entries(eg.ammoGuide).map(([k, n]) => `${itemName(k)}${n}（所持${k === "medkit" ? game.medkits : game.ammo[k]}）`).join("・")}</p>
</section>
    <section><h2>決戦</h2>
      ${game.finalPending
        ? `<p class="small">ドゥームズデイ。弾・${MEDKIT}・編成を確かめて、決戦に臨む。</p>
           ${game.deviceComplete() ? "" : `<p class="small down">対抗装置が${game.deviceStage ? "未完成" : "ない"}：${deviceMissingText()}。</p>`}
           <div class="row"><button class="go" data-act="launchFinal">決戦に臨む</button></div>`
        : `${game.deviceComplete() ? "" : `<p class="small down">対抗装置が${game.deviceStage ? "未完成" : "ない"}。このままでは${deviceMissingText()}。</p>`}
             <div class="row"><button class="go" data-act="declare" ${game.finalPending ? "disabled" : ""}>決戦に進む（${game.daysLeft}日後）</button>${ti("declare")}</div>`}</section>
    <div class="row"><button class="mini" data-act="replayIntro">導入（ストーリーと遊び方）をもう一度見る</button></div>`;
}

// ───────── 操作 ─────────

function toast(text, error = false) {
  ui.toast = { text, error };
  render();
}

// 日数を飛ばしたときも、その間のチャートの動きを再生してから結果を出す
function afterTimePass(r, label, view = null) {
  // ポジションがなければ再生しない
  const held = r.frames?.some((f) => f.positions?.length);
  if (r.frames?.length > 1 && held && !ui.noPlayback) return playPass(r, () => afterTimePassDone(r, label, view));
  afterTimePassDone(r, label, view);
}

function playPass(r, done) {
  saveGame(); // 再生の途中で閉じても、日は進んだまま
  const frames = r.frames;
  const held = frames[0].positions ?? [];
  const days = Math.max(1, daysBetween(frames[0].date, frames[frames.length - 1].date));
  const p = { frames, i: 0, start: performance.now(), total: Math.min(6000, 1000 + days * 700), ccy: held[0]?.ccy ?? ui.fx.ccy ?? game.market.currencies[0], done };
  ui.pass = p;
  ui.view = "pass";
  closeTip();
  app.innerHTML = `
    <div class="topbar static"><div class="row between" style="margin:0"><span class="warn">時が流れる</span><span id="pDays" class="small"></span></div>
      <div id="pClock" class="small"></div><div class="bar"><div id="pBar"></div></div></div>
    <section style="margin-top:6px">
      <div class="row between" style="margin:0 0 4px"><select id="pCcy">${game.market.currencies.map((c) => opt(c, pair(c), c === p.ccy)).join("")}</select><span id="pPnl"></span></div>
      <canvas id="pChart" style="height:160px"></canvas>
      <div id="pRatio" class="small muted"></div></section>
    <div class="row"><button data-act="skipPass">結果まで飛ばす</button></div>`;
  $("pCcy").addEventListener("change", (e) => { p.ccy = e.target.value; drawPassFrame(); });
  const tick = (now) => {
    if (ui.pass !== p) return;
    p.i = Math.min(frames.length - 1, Math.floor(((now - p.start) / p.total) * (frames.length - 1)));
    drawPassFrame();
    if (p.i >= frames.length - 1) return setTimeout(() => finishPass(p), 400);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function drawPassFrame() {
  const p = ui.pass;
  if (!p) return;
  const f = p.frames[p.i];
  const steps = game.market.steps;
  const hh = Math.floor((f.step * 24) / steps);
  const time = !f.trading && f.step ? "休場" : `${String(hh).padStart(2, "0")}:00`;
  $("pClock").textContent = `${formatJa(f.date)} ${time}`;
  $("pDays").textContent = `${daysBetween(p.frames[0].date, f.date)}日目`;
  $("pBar").style.width = `${(p.i / Math.max(1, p.frames.length - 1)) * 100}%`;
  const st = f.status;
  $("pPnl").innerHTML = `含み損益 <span class="${signClass(st.unrealized)}">${signedYen(st.unrealized)}</span>`;
  $("pRatio").innerHTML = st.ratio === Infinity ? "ポジションなし" : `維持率 <span class="${st.ratio < 1 ? "down" : st.ratio < 2 ? "warn" : ""}">${pct(st.ratio)}</span>　有効証拠金 ${yen(st.equity)}`;
  drawSortie($("pChart"), p.frames, p.i, p.ccy);
}

function finishPass(p) {
  if (ui.pass !== p) return;
  ui.pass = null;
  ui.view = "main";
  p.done();
}

// Lvが上がった仲間の一覧。同じ仲間が何度も上がったときは1つにまとめる（例：ミア（Lv5、+2））
function leveledText(names) {
  const count = new Map();
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count].map(([n, k]) => {
    const lv = game.members.find((m) => m.name === n)?.level;
    return lv ? `${n}（Lv${lv}${k > 1 ? `、+${k}` : ""}）` : `${n}${k > 1 ? `（+${k}）` : ""}`;
  }).join("、");
}

function afterTimePassDone(r, label, view = null) {
  const lines = [label];
  for (const ev of r.events) {
    const t = describeEvent(ev);
    if (t) lines.push(t);
  }
  if (r.wages) lines.push(`日給 ${yen(r.wages)}`);
  if (r.trainingFees) lines.push(`訓練費 ${yen(r.trainingFees)}`);
  if (r.leveled?.length) lines.push(`Lvが上がった：${leveledText(r.leveled)}`);
  if (r.healed?.length) lines.push(`回復した：${r.healed.join("、")}`);
  if (r.left?.length) lines.push(`日給の未払いで去った：${r.left.join("、")}`);
  const known = game.knownMemories().length;
  if (known > (ui.memSeen ?? 0)) lines.push("★記憶の断片を思い出した（FX口座の「手がかり」）");
  ui.memSeen = known;
  if (game.over) {
    ui.view = "end";
    return render();
  }
  if (view) ui.view = view;
  toast(lines.join("\n"));
}

const actions = {
  tip(el) {
    showTip(el.dataset.tip, el);
  },
  closeTip,
  replayIntro() {
    startStory("intro", 0, { replay: true });
  },
  skipPass() {
    if (ui.pass) finishPass(ui.pass);
  },
  newRun() {
    if (readSave() && !confirm("保存されているデータは消えます。最初から始めますか？")) return;
    clearSave();
    newRun();
  },
  continueRun,
  upgradeLens() {
    const r = game.upgradeLens();
    if (!r.ok) return toast(r.error, true);
    toast(`観測レンズを強化した（${r.lens.name}）${r.opened.length ? `。「${r.opened.join("・")}」を観測できるようになった` : ""}`);
  },
  gatherIntel() {
    const r = game.gatherIntel();
    if (!r.ok) return toast(r.error, true);
    afterTimePass(r, r.hints.length ? `情報を集めた：${r.hints[0].text}` : "情報を集めたが、めぼしい噂はなかった");
  },
  build() {
    const r = game.buildDevice();
    toast(r.ok ? `対抗装置「${r.stage.name}」が完成した` : r.error, !r.ok);
  },
  buyShares(el) {
    const r = game.buyShares(Number(el.dataset.n));
    if (!r.ok) return toast(r.error, true);
    if (game.over) {
      ui.view = "end";
      return render();
    }
    const d = r.events.map((e) => `\n★${e.text}`).join("");
    toast(`株式を${el.dataset.n}%買い増した（${yen(r.cost)}）。保有 ${game.shares.toFixed(1)}%${d}`);
  },
  declare() {
    const warn = game.deviceComplete() ? "" : `\n\n★対抗装置が${game.deviceStage ? "未完成" : "ありません"}。${deviceMissingText()}。とても不利な戦いになります。`;
    if (!confirm(`決戦に進みますか？\nFXのポジションはすべて決済され、ドゥームズデイまで${game.daysLeft}日進みます。${warn}`)) return;
    const r = game.declareFinal();
    if (!r.ok) return toast(r.error, true);
    ui.tab = "final";
    afterTimePass(r, `ドゥームズデイを迎えた（${formatJa(game.date)}）`);
  },
  launchFinal,
  fxCcy(el) {
    ui.fx.ccy = el.dataset.ccy;
    render();
  },
  toTitle() {
    ui.view = "title";
    render();
  },
  tab(el) {
    ui.tab = el.dataset.tab;
    ui.view = "main";
    ui.toast = null;
    render();
    window.scrollTo(0, 0);
  },
  goCity(el) {
    const to = el.dataset.city;
    if (to === game.cityId && !game.travel) {
      ui.tab = "town";
      ui.toast = null;
      return render();
    }
    const r = game.travelTo(to);
    if (!r.ok) return toast(r.error, true);
    ui.tab = "town";
    toast(r.days ? `${game.cityName(to)}へ出発した（${r.days}日、${formatJa(r.arrive)}到着）。移動中も取引はできる` : `${game.cityName(to)}に着いた`);
    window.scrollTo(0, 0);
  },
  wait(el) {
    let n = Number(el.dataset.n);
    if (!n) {
      n = Math.floor(Number($("trainDays")?.value));
      if (!(n >= 1)) return toast("訓練の日数を1以上で入れてください", true);
      n = Math.min(n, Math.max(1, game.daysLeft));
      ui.trainDays = n;
    }
    const travel = game.travel;
    const r = game.wait(n);
    if (!r.ok) return toast(r.error, true);
    afterTimePass(r, travel ? `${n}日進めた（${formatJa(game.date)}）` : `${n}日訓練した（${formatJa(game.date)}）`);
  },
  arrive() {
    const r = game.waitUntilArrival();
    if (!r.ok) return toast(r.error, true);
    afterTimePass(r, `${game.city.name}に到着した（${formatJa(game.date)}）`);
  },
  buyAmmo(el) {
    const r = game.buyAmmo(el.dataset.type, Number(el.dataset.n));
    toast(r.ok ? `${CONFIG.ammoTypes[el.dataset.type].name}を${el.dataset.n}発買った（${yen(r.yen)}）` : r.error, !r.ok);
  },
  buyMed(el) {
    const r = game.buyMedkits(Number(el.dataset.n));
    toast(r.ok ? `${MEDKIT}を${el.dataset.n}個買った（${yen(r.yen)}）` : r.error, !r.ok);
  },
  buyWeapon(el) {
    const r = game.buyWeapon(el.dataset.weapon);
    toast(r.ok ? `${CONFIG.weapons[el.dataset.weapon].name}を買った（${yen(r.yen)}）。「部隊」で持ち替えられる` : r.error, !r.ok);
  },
  buySuggestion(el) {
    const x = ui.prep?.suggestions?.[Number(el.dataset.i)];
    if (!x) return;
    const r = x.item === "medkit" ? game.buyMedkits(x.count) : game.buyAmmo(x.item, x.count);
    toast(r.ok ? `${x.label}を買った（${yen(r.yen)}）` : r.error, !r.ok);
  },
  upgrade(el) {
    const k = el.dataset.weapon;
    const r = game.upgradeWeapon(k);
    toast(r.ok ? `${CONFIG.weapons[k].name}をLv${game.weaponLevel(k)}に強化した（${yen(r.yen)}）` : r.error, !r.ok);
  },
  hire(el) {
    const r = game.hire(el.dataset.id);
    toast(r.ok ? `${r.member.name}が仲間になった` : r.error, !r.ok);
  },
  dismiss(el) {
    const m = game.members.find((x) => x.id === el.dataset.id);
    if (!m || !confirm(`${m.name}を解雇しますか？`)) return;
    const r = game.dismiss(el.dataset.id);
    toast(r.ok ? `${m.name}を解雇した` : r.error, !r.ok);
  },
  scout(el) {
    const r = game.scout(el.dataset.key);
    if (!r.ok) return toast(r.error, true);
    afterTimePass(r, `偵察を終えた（${formatJa(game.date)}）。敵の編成が分かった${r.hint ? `\n噂：${r.hint.text}` : ""}`);
  },
  // 出撃準備の画面から偵察して、そのまま準備の画面に戻る
  scoutFromPrep(el) {
    const r = game.scout(el.dataset.key);
    if (!r.ok) return toast(r.error, true);
    ui.prep = { key: el.dataset.key, prediction: null };
    afterTimePass(r, `偵察を終えた（${formatJa(game.date)}）。敵の編成が分かった${r.hint ? `\n噂：${r.hint.text}` : ""}`, "prep");
  },
  prep(el) {
    ui.prep = { key: el.dataset.key, prediction: null };
    ui.view = "prep";
    ui.toast = null;
    render();
    window.scrollTo(0, 0);
  },
  cancelPrep() {
    ui.view = "main";
    ui.tab = "town";
    render();
  },
  launch,
  retreat() {
    ui.sortie?.run.battle.retreat();
  },
  speed() {
    const s = ui.sortie;
    s.speed = (s.speed + 1) % SPEEDS.length;
    $("sSpeed").textContent = `速度 ×${SPEEDS[s.speed]}`;
  },
  skip() {
    const s = ui.sortie;
    // 残りの戦闘をすべて計算して、帰還まで早送り
    while (!s.run.done) {
      if (!s.run.battle.done) s.run.battle.run();
      s.run.nextStage();
    }
    s.phase = "tail";
  },
  afterResult() {
    ui.result = null;
    ui.view = game.over ? "end" : "main";
    ui.tab = "town";
    ui.toast = null;
    render();
    window.scrollTo(0, 0);
  },
  order(el) {
    const f = ui.fx;
    const side = el.dataset.side;
    const pr = game.prices();
    const entry = game.account.entryPrice(f.ccy, side, pr[f.ccy]);
    const r = game.fxOpen({ ccy: f.ccy, side, units: Number(f.units), ...levels(side, entry, widthOf(f.sl), widthOf(f.tp)) });
    if (!r.ok) return toast(r.error, true);
    const p = r.position;
    toast(`${pair(p.ccy)}を${p.units.toLocaleString()}${side === "buy" ? "買った" : "売った"}（${px(p.entryPrice)}）`);
  },
  // 損切りまでの値幅と、資金の何%まで失ってよいかから、数量を逆算する（入力欄に入れるだけ。変えてよい）
  riskUnits(el) {
    const f = ui.fx;
    const slW = widthOf(f.sl);
    if (slW == null) return toast("リスクから数量を計算するには、先に損切り幅を入れてください", true);
    const st = game.status();
    const share = Number(f.riskPct) / 100;
    if (!(share > 0 && share <= 1)) return toast("失ってよい資金の割合を、0より大きく100以下の%で入れてください", true);
    const perUnit = slW + (CONFIG.currencies[f.ccy].spread ?? 0); // 損切りまでの値幅＋スプレッド
    let units = Math.floor((st.equity * share) / perUnit / 1000) * 1000;
    const byMargin = Math.floor((st.available * st.maxLeverage * 0.95) / game.prices()[f.ccy] / 1000) * 1000;
    const capped = units > byMargin;
    units = Math.max(0, Math.min(units, byMargin));
    if (units < CONFIG.fx.minUnits) return toast("損切り幅が広すぎるか、資金が足りず、最小の数量に届きません", true);
    f.units = String(units);
    render();
    toast(`損切りに届くと約${yen(units * perUnit)}（資金の${pct((units * perUnit) / st.equity)}）を失う数量：${units.toLocaleString()}通貨${capped ? "（証拠金の上限で抑えた）" : ""}。数量は自由に変えられる`);
  },
  close(el) {
    const res = game.fxClose(Number(el.dataset.id));
    if (!res.ok) return;
    const r = res.record;
    if (ui.fx.editing === r.id) ui.fx.editing = null;
    if (game.over) {
      ui.view = "end";
      return render();
    }
    toast(`決済した（${signedYen(r.pnl)}）`);
  },
  editOrders(el) {
    const id = Number(el.dataset.id);
    ui.fx.editing = ui.fx.editing === id ? null : id;
    ui.toast = null;
    render();
  },
  applyOrders(el) {
    const id = Number(el.dataset.id);
    const p = game.account.positions.find((x) => x.id === id);
    if (!p) return;
    const base = game.account.exitPrice(p, game.prices()[p.ccy]);
    const r = game.fxSetOrders(id, levels(p.side, base, widthOf($("editSL").value), widthOf($("editTP").value)));
    if (!r.ok) return toast(r.error, true);
    ui.fx.editing = null;
    toast("損切り・利確を設定した");
  },
};

const changes = {
  equip(el) {
    const r = game.equip(el.dataset.id, el.value);
    if (!r.ok) toast(r.error, true);
    else render();
  },
  row(el) {
    game.setRow(el.dataset.id, el.value);
    render();
  },
  active(el) {
    const r = game.setActive(el.dataset.id, el.checked);
    if (!r.ok) toast(r.error, true);
    else render();
  },
  training(el) {
    const r = game.setTraining(el.dataset.id, el.checked);
    if (!r.ok) toast(r.error, true);
    else render();
  },
  // チャートと注文の通貨は連動する（違う通貨を取引してしまわないように）
  fxCcy(el) {
    ui.fx.ccy = el.value;
    render();
  },
  policy(el) {
    ui.policy = el.value;
    render();
  },
  retreat(el) {
    ui.retreatLine = Number(el.value);
    render();
  },
  livePolicy(el) {
    const b = ui.sortie?.run.battle;
    if (b && !b.done) b.setPolicy(el.value);
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  // ヒントの外を押したら閉じる
  if (!e.target.closest("#tipbox") && !(el && el.dataset.act === "tip")) closeTip();
  if (!el || el.disabled) return;
  actions[el.dataset.act]?.(el);
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.change) changes[el.dataset.change]?.(el);
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.fx) {
    ui.fx[el.dataset.fx] = el.value;
    updateOrderPreview();
  }
});
window.addEventListener("resize", () => {
  if (ui.view === "main" && ui.tab === "fx") drawHistory($("fxChart"), game.market, ui.fx.ccy, game.date);
});

boot();
