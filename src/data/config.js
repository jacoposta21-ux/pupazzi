// All tuning numbers live here so balancing never requires touching gameplay code.

export const SAVE_KEY = 'stuffed_save_v1';
export const SETTINGS_KEY = 'stuffed_settings_v1';

// Graphics presets. pixelRatio is capped by the device ratio.
export const QUALITY = {
  low: { shadows: false, pixelRatio: 0.75 },
  medium: { shadows: false, pixelRatio: 1 },
  high: { shadows: true, pixelRatio: 2 },
};

export const GRAVITY = 20;

// World layout (metres). The factory floor spans x/z inside FLOOR; the loading door is in the back wall.
export const LAYOUT = {
  floor: { minX: -18, maxX: 18, minZ: -14, maxZ: 24 },
  wallHeight: 8,
  door: { x: 0, z: 24, halfWidth: 3, height: 4.5 },
  stuffer: { x: -8, z: -6, w: 3, d: 3, h: 2.2 },
  belt: { startX: -9.5, endX: -17.6, z: -6, top: 0.9 },
  truckLaneZ: 30,
  playerSpawn: { x: 0, z: 10 },
};

// Plushie archetypes. hp grows with the day (see plushieHp).
export const PLUSHIES = {
  teddy: { hp: 2, walk: 1.3, flee: 4.0, value: 10, scale: 1.0, color: 0xc48a55, accent: 0xf3d5b0, ears: 'round' },
  bunny: { hp: 2, walk: 1.8, flee: 5.4, value: 16, scale: 0.92, color: 0xf6f1f6, accent: 0xf7b4c9, ears: 'long' },
  kitty: { hp: 3, walk: 1.5, flee: 4.8, value: 24, scale: 0.95, color: 0x8f9cb3, accent: 0xf5f0e6, ears: 'pointy' },
  golden: { hp: 5, walk: 2.2, flee: 6.6, value: 80, scale: 0.85, color: 0xffc933, accent: 0xfff0a8, ears: 'round', golden: true },
  // Armoured pup: the helmet soaks `armor` hits before the plushie takes damage.
  knight: { hp: 2, armor: 3, walk: 1.4, flee: 4.2, value: 30, scale: 1.0, color: 0xe0a96d, accent: 0xfff3e0, ears: 'floppy', helmet: true },
  // Matryoshka bear: big and slow, splits into minis when knocked out.
  mama: { hp: 4, walk: 1.0, flee: 3.2, value: 20, scale: 1.4, color: 0xe85d75, accent: 0xffe0e6, ears: 'round', splitsInto: 'mini', splitCount: 3 },
  mini: { hp: 1, walk: 1.8, flee: 5.0, value: 9, scale: 0.6, color: 0xe85d75, accent: 0xffe0e6, ears: 'round', spawnOnly: true },
};

export function plushieHp(type, day) {
  return PLUSHIES[type].hp + Math.floor((day - 1) / 3);
}

export function plushieWeights(day) {
  return {
    teddy: 10,
    bunny: day >= 2 ? 3 + day * 0.6 : 0,
    kitty: day >= 4 ? 2 + day * 0.5 : 0,
    golden: day >= 3 ? 0.5 + day * 0.06 : 0,
    knight: day >= 3 ? 2 + day * 0.4 : 0,
    mama: day >= 5 ? 1.5 + day * 0.3 : 0,
  };
}

export function pickPlushieType(day) {
  const w = plushieWeights(day);
  let total = 0;
  for (const k in w) total += w[k];
  let r = Math.random() * total;
  for (const k in w) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'teddy';
}

// Delivery plan for a day.
export function dayPlan(day, supplyLevel) {
  return {
    trucks: 2 + Math.floor((day - 1) / 2) + Math.floor(supplyLevel / 2),
    perTruck: 4 + Math.floor((day - 1) / 3) + supplyLevel,
  };
}

export function dayQuota(day) {
  return Math.round((40 * Math.pow(day, 1.45)) / 5) * 5;
}

export const QUOTA_BONUS = 0.3; // fraction of the quota paid as bonus when met
export const MAX_PLUSHIES = 70;

// Upgrades are pure data: cost = base * growth^level.
export const UPGRADES = [
  { id: 'speed', cat: 'player', icon: '👟', max: 8, base: 40, growth: 1.6 },
  { id: 'carry', cat: 'player', icon: '🎒', max: 7, base: 60, growth: 1.85 },
  { id: 'damage', cat: 'blaster', icon: '💥', max: 6, base: 80, growth: 1.9 },
  { id: 'firerate', cat: 'blaster', icon: '⚡', max: 6, base: 60, growth: 1.7 },
  { id: 'ammo', cat: 'blaster', icon: '🫧', max: 6, base: 50, growth: 1.6 },
  { id: 'slots', cat: 'factory', icon: '🏭', max: 5, base: 150, growth: 2.3 },
  { id: 'process', cat: 'factory', icon: '⚙️', max: 8, base: 70, growth: 1.65 },
  { id: 'belt', cat: 'factory', icon: '➡️', max: 8, base: 50, growth: 1.55 },
  { id: 'value', cat: 'factory', icon: '🏷️', max: 10, base: 120, growth: 1.75 },
  { id: 'supply', cat: 'business', icon: '🚚', max: 8, base: 100, growth: 1.85 },
  { id: 'overtime', cat: 'business', icon: '⏰', max: 8, base: 90, growth: 1.75 },
  { id: 'robot', cat: 'automation', icon: '🤖', max: 4, base: 250, growth: 2.2 },
  { id: 'robotSpeed', cat: 'automation', icon: '🔋', max: 6, base: 120, growth: 1.7, requires: 'robot' },
];

export function upgradeCost(u, level) {
  return Math.round(u.base * Math.pow(u.growth, level));
}

// Derived stats: base value modified by upgrade levels.
export function computeStats(levels) {
  const L = (id) => levels[id] || 0;
  return {
    moveSpeed: 5 * (1 + 0.08 * L('speed')),
    carry: 1 + L('carry'),
    damage: 1 + L('damage'),
    fireCooldown: 0.38 * Math.pow(0.88, L('firerate')),
    magSize: 6 + 3 * L('ammo'),
    reloadTime: 1.2,
    slots: 1 + L('slots'),
    queueSize: 3,
    processTime: 2.6 * Math.pow(0.86, L('process')),
    beltSpeed: 1.3 * (1 + 0.2 * L('belt')),
    valueMult: 1 + 0.15 * L('value'),
    supply: L('supply'),
    dayLength: 90 + 15 * L('overtime'),
    robots: L('robot'),
    robotSpeed: 2.6 * (1 + 0.18 * L('robotSpeed')),
  };
}

export function newSave() {
  return {
    version: 1,
    day: 1,
    cash: 0,
    levels: {},
    tutorialDone: false,
    totals: { stuffed: 0, earned: 0, knockouts: 0, bestDay: 0 },
  };
}
