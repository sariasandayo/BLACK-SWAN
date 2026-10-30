// 日付は "YYYY-MM-DD" の文字列で扱う（時差の影響を受けないよう、内部はUTCで計算）

const MS_PER_DAY = 86_400_000;
export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDate(time) {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return formatDate(parseDate(s) + n * MS_PER_DAY);
}

// a から b まで何日あるか（b が後なら正）
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / MS_PER_DAY);
}

export function dayOfWeek(s) {
  return new Date(parseDate(s)).getUTCDay();
}

export function isWeekend(s) {
  const w = dayOfWeek(s);
  return w === 0 || w === 6;
}

// 例: "2008年9月15日(月)"
export function formatJa(s) {
  const [y, m, d] = s.split("-");
  return `${y}年${Number(m)}月${Number(d)}日(${WEEKDAY_JA[dayOfWeek(s)]})`;
}
