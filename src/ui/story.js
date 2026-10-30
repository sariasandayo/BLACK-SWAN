// ストーリー（会話）の画面
//
// 画面下部に台詞の箱（発言者の名前・本文）、その右上に立ち絵を出す。
// 背景は黒画面・スチル・ゲーム画面（ゲーム画面のときは、後ろの本来の画面がそのまま見える）。
// 押す（クリック・タップ、Enter・スペース）と進む。文を出している途中で押すと、その文を全部出す。
// 「オート」で文字数に応じた時間で自動送り、「スキップ」で場面の最後まで飛ばす。
//
// 台本は src/data/story.js、時間などの設定は CONFIG.story。
// 画面の本体（app.js）とは、onTab（タブの切り替え）・onProgress（進み具合の保存）・onEnd だけでつながる。

import { CONFIG } from "../config.js";
import { SPEAKERS, STILLS } from "../data/story.js";
import { createRng } from "../core/rng.js";
import { addDays, daysBetween } from "../core/calendar.js";

const AUTO_KEY = "blackswan.story.auto";

// ── 台本の文に入れる値 ──

const ymd = (s) => s.split("-").map(Number);
const jaDate = (s) => {
  const [y, m, d] = ymd(s);
  return `${y}年${m}月${d}日`;
};

// 日付が遡る演出の始まりの日（ドゥームズデイの数年後。月日は周回ごとにランダム）
export function rewindFrom(game, config = CONFIG) {
  const year = ymd(game.deadline)[0] + config.story.rewindYearsAfter;
  const rng = createRng(`${game.seed}|story|rewind`);
  const jan1 = `${year}-01-01`;
  const days = daysBetween(jan1, `${year + 1}-01-01`);
  return addDays(jan1, rng.int(0, days - 1));
}

export function storyVars(game, config = CONFIG) {
  const [, dm, dd] = ymd(game.deadline);
  const hero = config.party.hero;
  return {
    hero: hero.name,
    origin: hero.origin ?? "",
    futureYear: ymd(rewindFrom(game, config))[0],
    startDate: jaDate(game.startDate),
    deadlineDate: jaDate(game.deadline),
    endDate: jaDate(game.date),
    daysLeft: Math.max(0, daysBetween(game.date, game.deadline)),
    yearsAfter: config.story.rewindYearsAfter,
    deadlineMD: `${dm}月${dd}日`,
    lengthDays: daysBetween(game.startDate, game.deadline),
    currencyCount: Object.keys(config.currencies).filter((c) => c !== "JPY").length,
    losscut: `${Math.round(config.fx.losscutRatio * 100)}%`,
    foundation: config.endgame.shares.foundation,
    research: config.endgame.shares.research,
    homeCity: game.cityName(game.homeId),
  };
}

// {名前} を値に置き換える（知らない名前は残す。テストで見つけるため）
export function fillText(text, vars) {
  return text.replace(/\{(\w+)\}/g, (all, k) => (vars[k] != null ? String(vars[k]) : all));
}

// 文を「1文字ずつ出す単位」に分ける。ルビ（｜漢字《かな》）は1つの単位にまとめる
export function tokenize(text) {
  const out = [];
  const re = /｜([^｜《》]+)《([^《》]+)》/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    for (const ch of text.slice(last, m.index)) out.push(ch);
    out.push({ base: m[1], ruby: m[2] });
    last = re.lastIndex;
  }
  for (const ch of text.slice(last)) out.push(ch);
  return out;
}

// 文字数（オート送りの待ち時間用。ルビは本体の文字数で数える）
export function textLength(tokens) {
  return tokens.reduce((n, t) => n + (typeof t === "string" ? (t === "\n" ? 0 : 1) : [...t.base].length), 0);
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// 意味の切れ目（文節に近いまとまり）に分ける。まとまりの途中では改行しない
//   漢字・カタカナ・英数字の並びに、後ろのひらがな・句読点・閉じかっこを付けたものを1つのまとまりにする
//   （例：「東京では、」「円相場の」「噂の」「情報収集と、」）。開きかっこは次のまとまりの頭に付ける
//   長すぎるまとまり（maxChunk 文字）は、そこで切る（狭い画面ではみ出さないように）
const OPEN = "「『（(【〈“";
const CLOSE = "、。，．！？!?」』）)】〉”….";
const PUNCT = "、。，．！？!?…."; // この後のひらがなは、新しいまとまりにする（閉じかっこの後の「は」などは付ける）
const isHira = (c) => /[\u3041-\u3096\u309d\u309e]/.test(c);
const maxChunk = 16;
export function chunkTokens(tokens) {
  const chunks = [];
  let cur = null;
  let len = 0;
  let last = "";
  const start = () => {
    cur = [];
    chunks.push(cur);
    len = 0;
  };
  tokens.forEach((t, i) => {
    if (t === "\n" || t === " " || t === "　") {
      chunks.push([i]); // 改行・空白は、まとまりの外
      cur = null;
      last = "";
      return;
    }
    const c = typeof t === "string" ? t : t.base[0];
    const w = typeof t === "string" ? 1 : [...t.base].length;
    let fresh;
    if (CLOSE.includes(c)) fresh = !cur; // 句読点・閉じかっこは、前に付ける
    else if (OPEN.includes(c)) fresh = !cur || !OPEN.includes(last);
    else if (isHira(c)) fresh = !cur || PUNCT.includes(last) || len >= maxChunk;
    else fresh = !cur || CLOSE.includes(last) || isHira(last) || len >= maxChunk;
    if (fresh) start();
    cur.push(i);
    len += w;
    last = typeof t === "string" ? t : t.base.at(-1);
  });
  return chunks;
}

// 先頭から n 単位だけ見せる。残りも見えない形で置いておくので、文字が出ていく途中で改行の位置が変わらない
function tokensHtml(tokens, n, chunks = chunkTokens(tokens)) {
  const one = (t) => (typeof t === "string" ? esc(t) : `<ruby>${esc(t.base)}<rt>${esc(t.ruby)}</rt></ruby>`);
  return chunks
    .map((ids) => {
      if (ids.length === 1 && tokens[ids[0]] === "\n") return "<br>";
      const shown = ids.filter((i) => i < n).map((i) => one(tokens[i])).join("");
      const hidden = ids.filter((i) => i >= n).map((i) => one(tokens[i])).join("");
      return `<span class="ph">${shown}${hidden ? `<span class="hid">${hidden}</span>` : ""}</span>`;
    })
    .join("");
}

// i 番目の手順の時点の背景とタブ（途中から再開するとき、それまでの手順を読んで決める）
export function stateAt(steps, i) {
  let bg = "black";
  let tab = null;
  for (const s of steps.slice(0, i)) {
    if (s.bg) bg = s.bg;
    if (s.tab) {
      bg = "game";
      tab = s.tab;
    }
  }
  return { bg, tab };
}

// 台詞の手順か
export const isLine = (s) => s.text != null;

// ── 再生 ──

let current = null;

export function storyPlaying() {
  return !!current;
}

// steps：台本、game：周回（値の計算用）
// opts：{ startAt, onTab(tab), onProgress(i), onEnd({ skipped }) }
export function playStory(steps, game, opts = {}) {
  stopStory();
  const cfg = CONFIG.story;
  const vars = storyVars(game);
  const root = document.createElement("div");
  root.id = "story";
  root.className = "story";
  root.innerHTML = `
    <div class="story-bg" data-layer="black"></div>
    <img class="story-bg story-still" alt="">
    <div class="story-rewind" hidden><div class="story-date"></div></div>
    <div class="story-stage">
      <img class="story-face" alt="" hidden>
      <div class="story-box" hidden>
        <div class="story-head"><span class="story-name"></span>
          <span class="story-ctl"><button type="button" data-story="auto">オート</button><button type="button" data-story="skip">スキップ</button></span></div>
        <div class="story-text"></div>
        <div class="story-next">▼</div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const el = {
    black: root.querySelector('[data-layer="black"]'),
    still: root.querySelector(".story-still"),
    rewind: root.querySelector(".story-rewind"),
    date: root.querySelector(".story-date"),
    face: root.querySelector(".story-face"),
    box: root.querySelector(".story-box"),
    name: root.querySelector(".story-name"),
    text: root.querySelector(".story-text"),
    next: root.querySelector(".story-next"),
    auto: root.querySelector('[data-story="auto"]'),
  };
  root.style.setProperty("--fade", `${cfg.fadeMs}ms`);
  // 台詞の箱は、下のタブより上に出す（タブの高さを測る。タブのない画面では0）
  const fitTabs = () => root.style.setProperty("--tabs-h", `${document.querySelector("#app .tabs")?.offsetHeight ?? 0}px`);
  const onTab = (tab) => {
    opts.onTab?.(tab);
    fitTabs();
  };

  const st = {
    steps,
    i: opts.startAt ?? 0,
    tokens: [],
    shown: 0,
    typing: null,
    wait: null,
    effect: null,
    auto: readAuto(),
    opts,
  };
  current = { root, st, el, onKey: null };

  // 再開：それまでの背景・タブに合わせる
  const at = stateAt(steps, st.i);
  if (at.tab) onTab(at.tab);
  fitTabs();
  setBg(el, at.bg, true);
  el.auto.classList.toggle("on", st.auto);

  const clearTimers = () => {
    clearTimeout(st.typing);
    clearTimeout(st.wait);
    st.typing = st.wait = null;
  };

  const finish = (skipped) => {
    clearTimers();
    if (st.effect) cancelAnimationFrame(st.effect.raf);
    // スキップしたときも、最後に開くはずのタブにする
    if (skipped) {
      const end = stateAt(steps, steps.length);
      if (end.tab) opts.onTab?.(end.tab);
    }
    stopStory();
    opts.onEnd?.({ skipped });
  };

  const scheduleAuto = () => {
    clearTimeout(st.wait);
    if (!st.auto) return;
    st.wait = setTimeout(advance, cfg.autoBaseMs + cfg.autoPerCharMs * textLength(st.tokens));
  };

  const typeNext = () => {
    st.shown++;
    el.text.innerHTML = tokensHtml(st.tokens, st.shown, st.chunks);
    if (st.shown < st.tokens.length) st.typing = setTimeout(typeNext, cfg.typeMs);
    else {
      st.typing = null;
      el.next.classList.add("on");
      scheduleAuto();
    }
  };

  const showLine = (s) => {
    const sp = SPEAKERS[s.who] ?? {};
    el.box.hidden = false;
    el.box.className = `story-box who-${s.who}`;
    el.name.textContent = sp.name ? fillText(sp.name, vars) : "";
    el.name.hidden = !sp.name;
    if (sp.portraits && s.face) {
      el.face.src = `${sp.portraits}${s.face}.webp`;
      el.face.hidden = false;
    } else el.face.hidden = true;
    st.tokens = tokenize(fillText(s.text, vars));
    st.chunks = chunkTokens(st.tokens);
    st.shown = 0;
    el.next.classList.remove("on");
    el.text.innerHTML = "";
    if (cfg.typeMs > 0) typeNext();
    else {
      st.shown = st.tokens.length - 1;
      typeNext();
    }
  };

  // 次の台詞まで手順を進める（背景・タブ・演出は、ここで順に実行する）
  const run = () => {
    while (st.i < steps.length) {
      const s = steps[st.i];
      st.i++;
      if (s.bg) setBg(el, s.bg);
      else if (s.tab) {
        setBg(el, "game");
        onTab(s.tab);
      } else if (s.rewind) {
        el.box.hidden = true;
        el.face.hidden = true;
        return playRewind(el, st, game, () => {
          st.effect = null;
          run();
        });
      } else if (isLine(s)) {
        opts.onProgress?.(st.i - 1);
        return showLine(s);
      }
    }
    finish(false);
  };

  const advance = () => {
    if (!current) return;
    if (st.effect) return st.effect.skip(); // 演出中：最後まで飛ばす
    if (st.typing) {
      // 出している途中：その文を全部出す
      clearTimeout(st.typing);
      st.shown = st.tokens.length - 1;
      return typeNext();
    }
    clearTimers();
    run();
  };

  root.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-story]");
    if (b?.dataset.story === "skip") return finish(true);
    if (b?.dataset.story === "auto") {
      st.auto = !st.auto;
      writeAuto(st.auto);
      el.auto.classList.toggle("on", st.auto);
      if (st.auto && !st.typing && !st.effect) scheduleAuto();
      else if (!st.auto) clearTimeout(st.wait);
      return;
    }
    advance();
  });
  current.onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      advance();
    }
  };
  document.addEventListener("keydown", current.onKey);
  current.onResize = fitTabs;
  window.addEventListener("resize", fitTabs);

  // 再開位置が台詞なら、その台詞から（手順を1つ戻して run で表示する）
  run();
}

export function stopStory() {
  if (!current) return;
  document.removeEventListener("keydown", current.onKey);
  window.removeEventListener("resize", current.onResize);
  clearTimeout(current.st.typing);
  clearTimeout(current.st.wait);
  current.root.remove();
  current = null;
}

// 背景：黒画面・スチル・ゲーム画面（透明にして後ろを見せる）
function setBg(el, bg, instant = false) {
  const root = el.black.parentElement;
  root.classList.toggle("instant", instant);
  root.classList.toggle("on-game", bg === "game");
  if (STILLS[bg]) {
    if (!el.still.src.endsWith(STILLS[bg])) el.still.src = STILLS[bg];
    el.still.classList.add("on");
    el.black.classList.add("on");
  } else {
    el.still.classList.remove("on");
    el.black.classList.toggle("on", bg === "black");
  }
  if (instant) requestAnimationFrame(() => root.classList.remove("instant"));
}

// 日付が遡る演出：未来のある日から開始日まで、日付が勢いよく巻き戻る
function playRewind(el, st, game, done) {
  const cfg = CONFIG.story;
  const from = rewindFrom(game);
  const to = game.startDate;
  const total = daysBetween(to, from);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  el.rewind.hidden = false;
  el.rewind.classList.remove("end");
  const t0 = performance.now();
  const fx = { raf: 0, ended: false };
  const show = (d) => (el.date.textContent = jaDate(d));
  const end = () => {
    if (fx.ended) return;
    fx.ended = true;
    cancelAnimationFrame(fx.raf);
    show(to);
    el.rewind.classList.add("end");
    st.wait = setTimeout(() => {
      el.rewind.hidden = true;
      done();
    }, 900);
  };
  fx.skip = () => {
    if (fx.ended) {
      clearTimeout(st.wait);
      el.rewind.hidden = true;
      return done();
    }
    end();
  };
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / cfg.rewindMs);
    show(addDays(to, Math.round(total * (1 - ease(t)))));
    if (t < 1) fx.raf = requestAnimationFrame(frame);
    else end();
  };
  show(from);
  st.effect = fx;
  fx.raf = requestAnimationFrame(frame);
}

function readAuto() {
  try {
    return localStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return false;
  }
}
function writeAuto(v) {
  try {
    localStorage.setItem(AUTO_KEY, v ? "1" : "0");
  } catch {}
}
