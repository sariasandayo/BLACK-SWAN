// オフラインで動かすための Service Worker（src/ui/offline.js が登録する）
//
// 一度ネットにつないで開くと、ゲームに使うファイル（HTML・JS・CSS・data/ の JSON・assets/ の画像）を
// すべてこの端末に保存する。2回目からは、保存したものを使うので、電波がなくても起動できる。
//
// ・保存したものを先に使い、ないときだけ取りに行く（取れたら保存する）。
//   そのため、サーバーのファイルを直しても、保存済みの端末では古いままになる
// ・直したファイルを届けたいときは、VERSION を上げる（src/config.js の ui.version と同じ値にしておく）。
//   この sw.js が変わったことをブラウザが見つけると、古い保存を消して、新しく保存し直す
// ・開発用ページ（tools/）と、ほかのサイトのファイルは保存しない

const VERSION = "1.0.0";
const PREFIX = "blackswan-v";
const CACHE = PREFIX + VERSION;

// 入れたときに必ず保存するもの（残りは、ゲームが起動したあとに offline.js が一覧を送ってくる）
const CORE = ["./", "index.html", "manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

// 古い版の保存を消し、開いているページもすぐこの Service Worker の管理にする
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ゲームが送ってくる一覧（読み込んだ JS・CSS・画像・データ）を保存する。失敗したものは飛ばす
self.addEventListener("message", (event) => {
  if (event.data?.type === "precache" && Array.isArray(event.data.urls)) event.waitUntil(precache(event.data.urls));
});

async function precache(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(
    urls.map(async (u) => {
      try {
        const url = new URL(u, self.location.href);
        if (!keep(url) || (await cache.match(url.href))) return;
        const res = await fetch(url.href, { cache: "no-cache" });
        if (res.ok) await cache.put(url.href, res);
      } catch {
        // 取れなかったものは、次に使ったときに保存される
      }
    }),
  );
}

// 保存してよいURLか（同じサイトのもので、開発用ページでないもの）
function keep(url) {
  return url.origin === self.location.origin && !url.pathname.includes("/tools/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!keep(url)) return;
  event.respondWith(respond(req));
});

async function respond(req) {
  const cache = await caches.open(CACHE);
  const navigate = req.mode === "navigate";
  // ページを開くとき（?seed=… が付いていても）は、保存したトップページを使う
  const hit = await cache.match(req, { ignoreSearch: navigate });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (navigate) {
      const top = (await cache.match("./")) || (await cache.match("index.html"));
      if (top) return top;
    }
    throw err;
  }
}
