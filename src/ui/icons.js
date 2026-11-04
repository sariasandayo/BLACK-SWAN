// 役割のアイコン（SVG。色は CSS の .role-<役割> で付ける）
//
// 役割のキーは config の roles と同じ。知らない役割は丸だけ出す。

const PATHS = {
  // 観測者：レンズ（目）
  hero: '<path d="M2 12c2.6-4.4 6-6.6 10-6.6s7.4 2.2 10 6.6c-2.6 4.4-6 6.6-10 6.6S4.6 16.4 2 12z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  // 射手：照準
  shooter: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  // 盾役：盾
  tank: '<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/><path d="M12 6.5v11"/>',
  // 衛生兵：十字
  medic: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7.5v9M7.5 12h9"/>',
  // 斥候：方位磁針（北の針を塗る）
  scout: '<circle cx="12" cy="12" r="9"/><path d="M12 6.2l2.6 5.8-2.6 5.8-2.6-5.8z"/><path d="M12 6.2l2.6 5.8H9.4z" fill="currentColor"/>',
};

export function roleIcon(role, size = 28) {
  const body = PATHS[role] ?? '<circle cx="12" cy="12" r="8"/>';
  return `<span class="role-icon role-${role}" style="width:${size}px;height:${size}px" aria-hidden="true"><svg viewBox="0 0 24 24" width="${Math.round(size * 0.66)}" height="${Math.round(size * 0.66)}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg></span>`;
}
