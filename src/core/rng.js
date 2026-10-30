// シード付き乱数。同じシードなら毎回同じ結果になる
// （周回の再現、日中補間の一貫性、自動プレイの検証に使う）

// 文字列 → 32bit整数（FNV-1a）
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 0以上1未満の一様乱数を返す関数を作る（mulberry32）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const next = mulberry32(typeof seed === "number" ? seed : hashString(String(seed)));
  return {
    next,
    // min以上max以下の整数
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    // 標準正規分布（平均0、標準偏差1）
    normal() {
      const u1 = next() || 1e-12;
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    pick(array) {
      return array[Math.floor(next() * array.length)];
    },
  };
}
