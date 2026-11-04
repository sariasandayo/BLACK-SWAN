// 画像の先読み
//
// スチル・立ち絵・ちびキャラ・ブラックスワンの絵を、起動時にまとめて読み込んで画像として準備しておく（decode まで済ませる）。
// こうしておくと、会話や決戦の場面で画像がぱっと切り替わる。読み込んだ Image は手元に持ち続ける（ブラウザに捨てられないように）。
// どの画像を読むかは、台本（src/data/story.js）・config から集めるので、画像を足してもここは直さなくてよい。

import { CONFIG } from "../config.js";
import { STORY, SPEAKERS, STILLS } from "../data/story.js";
import { REACTIONS } from "../data/reactions.js";

const cache = new Map(); // URL → Image

// 先読みする画像の一覧
export function imageList() {
  const set = new Set(Object.values(STILLS));
  for (const steps of Object.values(STORY)) {
    for (const s of steps) {
      const sp = SPEAKERS[s.who];
      if (sp?.portraits && s.face) set.add(`${sp.portraits}${s.face}.webp`);
    }
  }
  // こよみの反応の立ち絵
  for (const list of Object.values(REACTIONS)) for (const [, face] of list) if (face) set.add(`assets/portraits/koyomi/${face}.webp`);
  // 部隊タブのこよみの立ち絵・移動のちびキャラ
  const ui = CONFIG.ui ?? {};
  for (const u of [ui.heroPortrait, ...Object.values(ui.travelChibi ?? {})]) if (u) set.add(u);
  // 決戦のブラックスワン
  for (const t of Object.values(CONFIG.enemyTypes)) if (t.portrait) set.add(t.portrait);
  return [...set];
}

function loadOne(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    const done = () => {
      cache.set(url, img);
      resolve(img);
    };
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(done) : done());
    img.onerror = done; // 読めなくても止めない（その画像が出ないだけ）
    img.src = url;
  });
}

// すべて読み込む。onProgress(読み込んだ数, 全体の数)
export async function preloadImages(onProgress) {
  const list = imageList();
  let n = 0;
  onProgress?.(0, list.length);
  await Promise.all(
    list.map((u) =>
      loadOne(u).then(() => {
        n++;
        onProgress?.(n, list.length);
      }),
    ),
  );
  return list.length;
}

// 読み込み済みか（会話の画面が、切り替えの前に確かめる）
export function isLoaded(url) {
  const img = cache.get(url);
  return !!img && img.complete && img.naturalWidth > 0;
}

// まだなら読み込んでから（先読みが終わる前に場面が来たとき用）
export function ensureLoaded(url) {
  return loadOne(url);
}
