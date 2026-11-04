// オフライン対応：Service Worker（sw.js）を登録し、ゲームに使うファイルの一覧を渡して保存させる
//
// app.js が、起動の読み込み（相場データ・画像）が終わったあとに setupOffline() を呼ぶ。
// その時点でブラウザが読み込んだ同じサイトのファイル（JS・CSS・画像・データ）と、
// あとから読むもの（地図・ニュース・アイコン）をまとめて sw.js に送る。
//
// 手元の確認（localhost・127.0.0.1）では登録しない（直したファイルがすぐ反映されるように）。
// 手元でオフラインの動きを確かめたいときは、URL に ?sw を付けて開く。
// http（https でない）で開いたときは、ブラウザが Service Worker を使わせないので何もしない。

import { CONFIG } from "../config.js";
import { imageList } from "./assets.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function setupOffline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  if (LOCAL_HOSTS.includes(location.hostname) && !new URLSearchParams(location.search).has("sw")) {
    // 以前 ?sw で登録したものが残っていたら外す
    navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  navigator.serviceWorker
    .register("./sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(async (reg) => {
      const urls = await fileList();
      reg.active?.postMessage({ type: "precache", urls });
    })
    .catch(() => {
      // 登録できなくても、ゲームはそのまま動く（オフラインで開けないだけ）
    });
}

// 保存するファイルの一覧（絶対URL。同じサイトのものだけ）
async function fileList() {
  const set = new Set(["./", "index.html", "manifest.webmanifest", CONFIG.data.ratesUrl, CONFIG.data.newsUrl, "data/land-110m.json", ...imageList()]);
  // いままでに読み込んだもの（JS のモジュール・CSS・画像など）
  for (const e of performance.getEntriesByType("resource")) set.add(e.name);
  // タブのアイコン（index.html）と、ホーム画面のアイコン（manifest）
  for (const el of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) set.add(el.href);
  try {
    const manifest = await (await fetch("manifest.webmanifest")).json();
    for (const icon of manifest.icons ?? []) set.add(new URL(icon.src, new URL("manifest.webmanifest", location.href)).href);
  } catch {}
  return [...set]
    .map((u) => new URL(u, location.href))
    .filter((u) => u.origin === location.origin)
    .map((u) => u.href.split("#")[0]);
}
