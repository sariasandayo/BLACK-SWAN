// 世界地図（Natural Earth の陸地データ、TopoJSON 形式）を読み込んで SVG にする
//
// データは world-atlas パッケージの land-110m.json（Natural Earth 1:110m、パブリックドメイン）。
// まず data/land-110m.json を探し、なければ CDN から読む。どちらも失敗したら null（格子だけの地図になる）。
// 公開時にCDNに頼らないよう、data/land-110m.json を置いておくのがおすすめ（README参照）。

const SOURCES = [
  "data/land-110m.json",
  "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json",
  "https://unpkg.com/world-atlas@2.0.2/land-110m.json",
];

// 地図に出す範囲（緯度）。南極は描かない
export const MAP_VIEW = { north: 80, south: -60 };

let cache = null;

export async function loadLandPath() {
  if (cache) return cache;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const topo = await res.json();
      cache = topologyToPath(topo, "land");
      if (cache) return cache;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

// TopoJSON の1つのオブジェクトを、正距円筒図法（x=経度、y=-緯度）の SVG パスにする
export function topologyToPath(topo, name) {
  const obj = topo?.objects?.[name];
  if (!obj) return null;
  const arcs = decodeArcs(topo);
  const ringPoints = (ring) => {
    const pts = [];
    for (const index of ring) {
      const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
      // 弧と弧のつなぎ目は同じ点なので、2本目以降は最初の点を飛ばす
      arc.forEach((p, i) => {
        if (i > 0 || pts.length === 0) pts.push(p);
      });
    }
    return pts;
  };
  const parts = [];
  const draw = (pts, shift) => "M" + pts.map(([x, y]) => `${round1(x + shift)},${round1(-y)}`).join("L") + "Z";
  const addPolygon = (polygon) => {
    for (const ring of polygon) {
      const pts = unwrap(ringPoints(ring));
      if (pts.length < 3) continue;
      parts.push(draw(pts, 0));
      // 日付変更線（経度180度）をまたぐ島（チュクチ半島、フィジーなど）は、
      // つなげた形が地図の外にはみ出すので、反対側にもずらして描く（はみ出た分は地図の枠で切れる）
      const xs = pts.map((p) => p[0]);
      if (Math.max(...xs) > 180) parts.push(draw(pts, -360));
      if (Math.min(...xs) < -180) parts.push(draw(pts, 360));
    }
  };
  const geoms = obj.type === "GeometryCollection" ? obj.geometries : [obj];
  for (const g of geoms) {
    if (g.type === "Polygon") addPolygon(g.arcs);
    else if (g.type === "MultiPolygon") g.arcs.forEach(addPolygon);
  }
  return parts.join("");
}

// 経度が180度から−180度へ飛ぶところ（日付変更線）で、地図の端から端まで横線が引かれないよう、
// 前の点に近くなるように経度を±360度ずらしてつなげる
function unwrap(pts) {
  const out = [];
  let prev = null;
  for (const [x, y] of pts) {
    let nx = x;
    if (prev != null) {
      while (nx - prev > 180) nx -= 360;
      while (nx - prev < -180) nx += 360;
    }
    out.push([nx, y]);
    prev = nx;
  }
  return out;
}

// 量子化・差分で詰められた座標を、経度・緯度に戻す
function decodeArcs(topo) {
  const t = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      if (!t) return [dx, dy];
      x += dx;
      y += dy;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// 経度・緯度 → 地図上の位置（%）
export function mapPosition(lon, lat) {
  const { north, south } = MAP_VIEW;
  return { left: ((lon + 180) / 360) * 100, top: ((north - lat) / (north - south)) * 100 };
}
