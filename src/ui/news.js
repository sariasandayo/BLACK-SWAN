// 画面の端に流すニュース（世界観の演出）
//
// ゲーム内の日付の、実際の出来事（data/news.json。tools/fetch-news.html で作る）を、画面の下の端（タブの上）に流し続ける。
//   ・その日（ゲーム内の日付）の出来事を、日付（M/D）を付けてくり返し流す
//   ・その日の出来事が CONFIG.news.minItems 件に届かないときだけ、前日、2日前、3日前（lookbackDays 日前まで）の出来事を足す。
//     それでも足りなくても、それ以上は遡らず、ほかのもので補わない
//   ・ゲーム内の日付より後の出来事は出さない。日付が変わったら、まだ帯に入っていない項目は外す
//   ・ゲームの進行には関わらない。news.json がなければ何も出さない
//
// 画面（src/ui/app.js）には手を入れず、画面に出ている日付を読んで動く：
//   町などの上部の情報バーの日付（.topbar .date）、出撃中の時計（#sClock）、時の流れの再生の時計（#pClock）。
//   日付が出ていない画面（タイトル・エンディングなど）では隠す。
// 出典：タイトル画面の「出典」（設定資料集・免責事項の横に足す）で開く。文は CONFIG.ui.credits

import { CONFIG } from "../config.js";
import { addDays } from "../core/calendar.js";

const cfg = CONFIG.news;
const app = document.getElementById("app");
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let news = null; // data/news.json
let bar = null;
let lane = null;
let track = null;
const st = {
  date: null, // いま流している日付
  list: [], // 流す項目 [{ d, t, k }]
  i: 0, // 次に足す項目
  x: 0, // 帯の位置（画素）
  last: null,
  shown: false,
  staticTimer: null,
};

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ───────── 流す項目 ─────────

// 1日分の並べ方：日本の出来事を先に、あとは分類が続かないように交互に
function orderDay(list) {
  const groups = new Map();
  for (const [t, k] of list) {
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === "jp" ? -1 : b === "jp" ? 1 : 0));
  const out = [];
  for (let round = 0; out.length < list.length; round++) {
    for (const k of keys) {
      const t = groups.get(k)[round];
      if (t != null) out.push({ t, k });
    }
  }
  return out;
}

// その日に流す項目。その日の出来事を先に、minItems に届かなければ前日、2日前…（lookbackDays 日前まで）の出来事を足す
//   一覧から作った項目（3つめの要素が 1）は、1日に listPerDay 件まで。それでも足りないときだけ、その残りも後ろに足す
export function playlist(items, date) {
  const out = [];
  const spare = [];
  const cap = cfg.listPerDay ?? 3;
  for (let i = 0; i <= (cfg.lookbackDays ?? 3); i++) {
    const d = addDays(date, -i);
    const day = items[d] ?? [];
    const lists = day.filter((x) => x[2]);
    out.push(...orderDay([...day.filter((x) => !x[2]), ...lists.slice(0, cap)]).map((x) => ({ ...x, d })));
    spare.push(...lists.slice(cap).map(([t, k]) => ({ t, k, d })));
    if (out.length >= cfg.minItems) break;
  }
  if (out.length < cfg.minItems) out.push(...spare.slice(0, cfg.minItems - out.length));
  return out;
}

// 「2008年9月15日(月)」→「2008-09-15」
function parseJa(text) {
  const m = text?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

// 画面に出ているゲーム内の日付（出撃中・時の流れの再生中は、その時計の日付）
function screenDate() {
  const clock = document.getElementById("sClock") ?? document.getElementById("pClock");
  if (clock) return parseJa(clock.textContent);
  return parseJa(app.querySelector(".topbar .date")?.textContent);
}

// ───────── 帯 ─────────

function buildBar() {
  bar = document.createElement("div");
  bar.className = "news-bar";
  bar.hidden = true;
  bar.setAttribute("aria-hidden", "true");
  bar.innerHTML = `<div class="news-lane"><div class="news-track"></div></div>`;
  bar.style.setProperty("--news-gap", `${cfg.gap}px`);
  document.body.appendChild(bar);
  lane = bar.querySelector(".news-lane");
  track = bar.querySelector(".news-track");
}

function itemEl(it) {
  const [, m, d] = it.d.split("-").map(Number);
  const el = document.createElement("span");
  el.className = `news-item k-${it.k}`;
  el.dataset.date = it.d;
  el.innerHTML = `<span class="news-date">${m}/${d}</span>${esc(it.t)}`;
  return el;
}

function nextItem() {
  if (!st.list.length) return null;
  const it = st.list[st.i % st.list.length];
  st.i++;
  return it;
}

// 帯の右端まで項目を足す
function fill() {
  const width = lane.clientWidth;
  let end = st.x + track.scrollWidth;
  let guard = 0;
  while (end < width + 40 && guard++ < 20) {
    const it = nextItem();
    if (!it) return;
    // 最初の1件は、帯の右端から入ってくる
    if (!track.firstChild) st.x = width;
    track.appendChild(itemEl(it));
    end = st.x + track.scrollWidth;
  }
}

// 左端から出きった項目を外す
function trim() {
  let first = track.firstElementChild;
  while (first) {
    const w = first.offsetWidth + cfg.gap;
    if (st.x + w > 0) break;
    st.x += w;
    first.remove();
    first = track.firstElementChild;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!st.shown || reduceMotion) {
    st.last = null;
    return;
  }
  const dt = st.last == null ? 0 : Math.min(0.1, (now - st.last) / 1000);
  st.last = now;
  st.x -= cfg.speed * dt;
  trim();
  fill();
  track.style.transform = `translateX(${st.x}px)`;
}

// 動きを減らす設定のとき：1件ずつ切り替える
function staticShow() {
  clearTimeout(st.staticTimer);
  if (!st.shown) return;
  const it = nextItem();
  track.replaceChildren(...(it ? [itemEl(it)] : []));
  track.style.transform = "translateX(8px)";
  st.staticTimer = setTimeout(staticShow, 8000);
}

function setDate(date) {
  if (date === st.date) return;
  st.date = date;
  st.list = playlist(news.items, date);
  st.i = 0;
  // まだ帯に入っていない（右端より先にある）項目と、新しい日付より後の日付の項目（新しい周回など）は外す。
  // 見えている項目は、そのまま流し終える
  const width = lane.clientWidth;
  for (const el of [...track.children]) if (st.x + el.offsetLeft >= width || el.dataset.date > date) el.remove();
  if (!track.children.length) st.x = width;
  if (reduceMotion) staticShow();
}

function show(on) {
  const visible = on && st.list.length > 0;
  if (visible === st.shown) return;
  st.shown = visible;
  bar.hidden = !visible;
  document.documentElement.style.setProperty("--news-h", visible ? `${bar.offsetHeight}px` : "0px");
  if (visible && reduceMotion) staticShow();
}

// 画面が変わったら：日付を読み、帯の位置（タブの上）を合わせる
function sync() {
  injectTitleCredits();
  if (!news) return;
  const date = screenDate();
  if (date) setDate(date);
  const tabs = app.querySelector(".tabs");
  bar.style.bottom = `${tabs ? tabs.offsetHeight : 0}px`;
  show(!!date);
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    sync();
  });
}

// ───────── 出典 ─────────

// タイトル画面の「設定資料集・免責事項」の横に「出典」を足す
function injectTitleCredits() {
  const row = app.querySelector(".title-screen .title-sub");
  if (row && !row.querySelector("[data-news-credits]")) {
    const b = document.createElement("button");
    b.className = "link";
    b.type = "button";
    b.dataset.newsCredits = "";
    b.textContent = "出典";
    row.appendChild(b);
  }
}

const wikiUrl = (title, revid) => `https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}${revid ? `&oldid=${revid}` : ""}`;

export function openCredits() {
  const blocks = (CONFIG.ui.credits ?? []).map((c) => `<h2>${esc(c.title)}</h2>
    ${c.text.map((p) => `<p>${esc(p)}</p>`).join("")}
    ${c.links?.length ? `<p class="credit-links">${c.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`).join("　")}</p>` : ""}`);
  const pages = news?.pages?.length
    ? `<details><summary>ニュースに使った記事（${news.pages.length}件。取得：${esc(news.generatedAt?.slice(0, 10) ?? "")}）</summary>
        <p class="credit-pages">${news.pages.map(([t, rev]) => `<a href="${wikiUrl(t, rev)}" target="_blank" rel="noopener">${esc(t)}</a>`).join("、")}</p></details>`
    : "";
  const root = document.createElement("div");
  root.className = "lore";
  root.innerHTML = `<div class="lore-head"><span>出典</span><button data-lore="close">閉じる</button></div><div class="lore-body credits">${blocks.join("")}${pages}</div>`;
  root.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-lore="close"]')) root.remove();
  });
  document.body.appendChild(root);
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-news-credits]")) return;
  e.stopPropagation();
  openCredits();
});

// ───────── 起動 ─────────

async function init() {
  new MutationObserver(schedule).observe(app, { childList: true, subtree: true, characterData: true });
  schedule();
  try {
    const res = await fetch(CONFIG.data.newsUrl);
    if (!res.ok) return;
    news = await res.json();
  } catch {
    return; // ニュースがなくても、ゲームはそのまま動く
  }
  if (!news?.items) return (news = null);
  buildBar();
  window.addEventListener("resize", schedule);
  requestAnimationFrame(frame);
  schedule();
}

init();
