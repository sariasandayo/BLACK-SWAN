// チャートの描画（canvas）

const COLORS = {
  grid: "#1d2921",
  label: "#6d8775",
  text: "#cfe8d5",
  up: "#3ddc84",
  down: "#ff5f5f",
};

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, w * dpr);
  canvas.height = Math.max(1, h * dpr);
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  g.font = "11px ui-monospace, Consolas, monospace";
  return { g, w, h };
}

// 直近の終値のチャート。営業日ごとに点と日付を付け、その間を日中の値動きで結ぶ
//   日中の値動きは market.intradayPath（出撃中・移動中の表示や、損切り・利確の判定と同じもの）。
//   同じ日の同じ時刻は、どの画面でも同じ値になる。終値（点）は実際の値
export function drawHistory(canvas, market, ccy, date, count = 7) {
  const { g, w, h } = setupCanvas(canvas);
  const hist = market.history(ccy, date, count);
  if (hist.length < 2) return;
  const closes = hist.map((x) => x.close);
  // 日中の点：日 k（1以上）の値動きは、横軸 k-1 → k の間に置く（始まりは前の営業日の終値）
  const pts = [{ t: 0, v: closes[0] }];
  for (let k = 1; k < hist.length; k++) {
    const path = market.intradayPath(ccy, hist[k].date);
    const n = path.length - 1;
    for (let s = 1; s <= n; s++) pts.push({ t: k - 1 + s / n, v: path[s] });
  }
  const all = pts.map((p) => p.v);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const plotW = w - 48;
  const bottom = 16; // 日付の欄
  const x = (t) => 20 + (t / (hist.length - 1)) * (plotW - 34);
  const y = (v) => h - bottom - 6 - ((v - lo) / (hi - lo)) * (h - bottom - 12);

  g.strokeStyle = COLORS.grid;
  g.fillStyle = COLORS.label;
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    g.beginPath();
    g.moveTo(0, y(v));
    g.lineTo(plotW, y(v));
    g.stroke();
    g.fillText(v.toFixed(hi - lo < 1 ? 3 : 2), plotW + 4, y(v) + 4);
  }
  // 日の区切り
  g.strokeStyle = "rgba(109,135,117,.18)";
  for (let k = 0; k < hist.length; k++) {
    g.beginPath();
    g.moveTo(x(k), 4);
    g.lineTo(x(k), h - bottom - 2);
    g.stroke();
  }
  const color = closes[closes.length - 1] >= closes[0] ? COLORS.up : COLORS.down;
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(x(p.t), y(p.v)) : g.moveTo(x(p.t), y(p.v))));
  g.stroke();
  // 終値の点と日付
  g.fillStyle = color;
  closes.forEach((v, i) => {
    g.beginPath();
    g.arc(x(i), y(v), 3, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = COLORS.label;
  g.textAlign = "center";
  hist.forEach((p, i) => {
    const [, m, d] = p.date.split("-").map(Number);
    g.fillText(`${m}/${d}`, x(i), h - 3);
  });
  g.textAlign = "start";
}

// 出撃中・時の流れのチャート：出発からいまのコマまで。
// 縦軸は「これまでの値」と注文の線だけで決める（先の値動きの幅を縦軸から読み取れないように）
//   span: 横軸の長さ（コマ数）。省略すると frames の長さ
export function drawSortie(canvas, frames, upto, ccy, span = frames.length) {
  const { g, w, h } = setupCanvas(canvas);
  if (!frames.length) return;
  const vals = frames.slice(0, upto + 1).map((f) => f.prices[ccy]);
  const lines = [];
  for (const p of frames[upto].positions.filter((p) => p.ccy === ccy)) {
    lines.push({ v: p.entryPrice, color: COLORS.label, label: p.side === "buy" ? "建値買" : "建値売" });
    if (p.stopLoss != null) lines.push({ v: p.stopLoss, color: COLORS.down, label: "損切り" });
    if (p.takeProfit != null) lines.push({ v: p.takeProfit, color: COLORS.up, label: "利確" });
  }
  const all = [...vals, ...lines.map((l) => l.v)];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const minRange = vals[0] * 0.004;
  if (hi - lo < minRange) {
    const m = (hi + lo) / 2;
    lo = m - minRange / 2;
    hi = m + minRange / 2;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const plotW = w - 48;
  const x = (k) => (k / Math.max(1, span - 1)) * plotW;
  const y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);

  // 日の区切り
  g.strokeStyle = COLORS.grid;
  frames.forEach((f, k) => {
    if (k > 0 && f.date !== frames[k - 1].date) {
      g.beginPath();
      g.moveTo(x(k), 0);
      g.lineTo(x(k), h);
      g.stroke();
    }
  });
  // 注文の線
  g.setLineDash([4, 4]);
  for (const l of lines) {
    g.strokeStyle = l.color;
    g.beginPath();
    g.moveTo(0, y(l.v));
    g.lineTo(plotW, y(l.v));
    g.stroke();
    g.fillStyle = l.color;
    g.fillText(l.label, plotW + 4, y(l.v) + 4);
  }
  g.setLineDash([]);
  // 値動き
  const now = vals[vals.length - 1];
  g.strokeStyle = now >= vals[0] ? COLORS.up : COLORS.down;
  g.lineWidth = 1.5;
  g.beginPath();
  vals.forEach((v, k) => (k ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v))));
  g.stroke();
  g.fillStyle = COLORS.text;
  g.beginPath();
  g.arc(x(upto), y(now), 3, 0, Math.PI * 2);
  g.fill();
  g.fillText(now.toFixed(3), Math.min(x(upto) + 6, plotW - 52), Math.max(12, y(now) - 6));
}

// 答え合わせのチャート：周回の期間の4通貨（初日を100とした）と、出来事の縦線（番号つき）
const LINE_COLORS = { USD: "#7fb8ff", EUR: "#ffd166", GBP: "#c99bff", AUD: "#3ddc84" };
export function drawAnswerChart(canvas, game) {
  if (!canvas) return;
  const { g, w, h } = setupCanvas(canvas);
  const m = game.market;
  const days = [];
  for (let d = game.startDate; d <= game.deadline; d = addDay(d)) days.push(d);
  const series = m.currencies.map((c) => {
    const base = m.close(c, game.startDate);
    return { c, vals: days.map((d) => (m.close(c, d) / base) * 100) };
  });
  const all = series.flatMap((s) => s.vals);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const plotW = w - 40;
  const top = 16;
  const x = (i) => (i / Math.max(1, days.length - 1)) * plotW;
  const y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 6 - top);
  g.strokeStyle = COLORS.grid;
  g.fillStyle = COLORS.label;
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    g.beginPath();
    g.moveTo(0, y(v));
    g.lineTo(plotW, y(v));
    g.stroke();
    g.fillText(v.toFixed(0), plotW + 4, y(v) + 4);
  }
  // 出来事
  game.answerKey().forEach((e, i) => {
    const k = days.indexOf(e.date);
    if (k < 0) return;
    g.strokeStyle = e.recalled ? COLORS.up : COLORS.label;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x(k), top);
    g.lineTo(x(k), h);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = e.recalled ? COLORS.up : COLORS.label;
    g.fillText(String(i + 1), x(k) - 3, 11);
  });
  for (const s of series) {
    g.strokeStyle = LINE_COLORS[s.c] ?? COLORS.text;
    g.lineWidth = 1.5;
    g.beginPath();
    s.vals.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.stroke();
    g.fillStyle = LINE_COLORS[s.c] ?? COLORS.text;
    g.fillText(s.c, plotW + 4, Math.min(h - 4, Math.max(top + 8, y(s.vals[s.vals.length - 1]) + 4)));
  }
}

function addDay(d) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
