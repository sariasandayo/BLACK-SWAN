// こよみの反応：操作のあとに、画面の下（タブの上）へ一言だけ出す
//
// 会話の画面と同じ見た目の小さな箱（名前・台詞・立ち絵）。押すか、文字数に応じた時間がたつと消える。
// 後ろの画面の操作は止めない（箱だけが押せる）。会話の画面を流している間は出さない。
// 台詞は src/data/reactions.js。

import { CONFIG } from "../config.js";
import { REACTIONS } from "../data/reactions.js";
import { storyPlaying } from "./story.js";

const PORTRAITS = "assets/portraits/koyomi/";
const last = {}; // キーごとの直前の台詞（続けて同じものを出さない）
let current = null;

// key の候補からランダムに1つ選んで出す（候補がなければ何もしない）
export function react(key) {
  const list = REACTIONS[key];
  if (!list?.length || storyPlaying()) {
    hideReaction(); // 言うことがないときは、前の台詞も消す（古い反応が残らないように）
    return null;
  }
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === last[key]) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
  last[key] = i;
  const [text, face] = list[i];
  show(text, face);
  return text;
}

function show(text, face) {
  hideReaction();
  const cfg = CONFIG.story;
  const root = document.createElement("div");
  root.className = "reaction";
  root.innerHTML = `<div class="reaction-inner">
      ${face ? `<img class="reaction-face" src="${PORTRAITS}${face}.webp" alt="">` : ""}
      <div class="reaction-box"><div class="reaction-name">${CONFIG.party.hero.name}</div><div class="reaction-text"></div></div></div>`;
  root.querySelector(".reaction-text").textContent = text;
  const tabs = document.querySelector("#app .tabs");
  root.style.setProperty("--tabs-h", `${tabs?.offsetHeight ?? 0}px`);
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add("on"));
  const ms = 1600 + cfg.autoPerCharMs * 1.5 * [...text].length;
  const timer = setTimeout(hideReaction, ms);
  root.addEventListener("click", (e) => {
    e.stopPropagation();
    hideReaction();
  });
  current = { root, timer };
}

export function hideReaction() {
  if (!current) return;
  clearTimeout(current.timer);
  current.root.remove();
  current = null;
}
