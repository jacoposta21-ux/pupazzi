// All tuning numbers live here so balancing never requires touching gameplay code.

// test builds keep their own save so they never touch a real one
export const SAVE_KEY = import.meta.env.VITE_CHEATS === '1' ? 'stuffed_save_cheats' : 'stuffed_save_v1';
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
  // The starter production line: Stuffer + belt running west to a shipping chute in the wall.
  // Shipping: the only exit for cans, a chute in the west wall fed by two fixed belt tiles.
  shipping: { z: -6, tiles: [-16, -17] },
  // Starting setup: one Stuffer (a normal, movable machine) and a belt run to the shipping stub.
  starter: {
    stuffer: { type: 'stuffer', x: -8, z: -6, rot: 2 },
    belts: [-10, -11, -12, -13, -14, -15].map((x) => ({ x, z: -6, d: 2 })),
  },
  terminal: { x: 5, z: 13 },
  truckLaneZ: 30,
  playerSpawn: { x: 0, z: 10 },
};

// Plushie archetypes. hp and value grow with the factory level. nugget = chance of hiding a gold nugget.
export const PLUSHIES = {
  teddy: { hp: 2, walk: 1.3, flee: 4.0, value: 10, scale: 1.0, color: 0xc48a55, accent: 0xf3d5b0, ears: 'round', nugget: 0.06 },
  bunny: { hp: 2, walk: 1.8, flee: 5.4, value: 16, scale: 0.92, color: 0xf6f1f6, accent: 0xf7b4c9, ears: 'long', nugget: 0.06 },
  kitty: { hp: 3, walk: 1.5, flee: 4.8, value: 24, scale: 0.95, color: 0x8f9cb3, accent: 0xf5f0e6, ears: 'pointy', nugget: 0.08 },
  golden: { hp: 5, walk: 2.2, flee: 6.6, value: 80, scale: 0.85, color: 0xffc933, accent: 0xfff0a8, ears: 'round', golden: true, nugget: 0.35 },
  // Armoured pup: the helmet soaks `armor` hits before the plushie takes damage.
  knight: { hp: 2, armor: 3, walk: 1.4, flee: 4.2, value: 30, scale: 1.0, color: 0xe0a96d, accent: 0xfff3e0, ears: 'floppy', helmet: true, nugget: 0.12 },
  // Matryoshka bear: big and slow, splits into minis when knocked out.
  mama: { hp: 4, walk: 1.0, flee: 3.2, value: 20, scale: 1.4, color: 0xe85d75, accent: 0xffe0e6, ears: 'round', splitsInto: 'mini', splitCount: 3, nugget: 0 },
  mini: { hp: 1, walk: 1.8, flee: 5.0, value: 9, scale: 0.6, color: 0xe85d75, accent: 0xffe0e6, ears: 'round', spawnOnly: true, nugget: 0.1 },
};

// ---------- Factory level: grows with lifetime earnings, drives variety, difficulty and value ----------
export const GOAL = 1_000_000; // final objective: lifetime earnings
const LEVEL_BASE = 150;
const LEVEL_GROWTH = 1.875;
export const MAX_LEVEL = 25;

export function levelThreshold(level) {
  return level <= 1 ? 0 : Math.round(LEVEL_BASE * Math.pow(LEVEL_GROWTH, level - 2));
}

export function levelFromEarned(total) {
  let L = 1;
  while (L < MAX_LEVEL && total >= levelThreshold(L + 1)) L++;
  return L;
}

// Every level makes cans worth more, so income keeps up with exponential prices.
export function levelValueMult(level) {
  return Math.pow(1.22, level - 1);
}

export function plushieHp(type, level) {
  return PLUSHIES[type].hp + Math.floor((level - 1) / 3);
}

export function plushieWeights(level) {
  return {
    teddy: 10,
    bunny: level >= 2 ? 3 + level * 0.6 : 0,
    kitty: level >= 4 ? 2 + level * 0.5 : 0,
    golden: level >= 3 ? 0.5 + level * 0.06 : 0,
    knight: level >= 3 ? 2 + level * 0.4 : 0,
    mama: level >= 5 ? 1.5 + level * 0.3 : 0,
  };
}

export function pickPlushieType(level) {
  const w = plushieWeights(level);
  let total = 0;
  for (const k in w) total += w[k];
  let r = Math.random() * total;
  for (const k in w) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'teddy';
}

// Continuous deliveries: a truck every few seconds, bigger and more frequent as the factory grows.
export function truckPlan(level, supplyLevel) {
  return {
    interval: Math.max(9, 26 - 0.8 * level - 1.5 * supplyLevel),
    count: 4 + Math.floor(level / 2) + supplyLevel,
  };
}

export const WRAP_BONUS = 1.5; // Gift Wrapper value multiplier
export const MAX_PLUSHIES = 70;

// ---------- Timed missions ----------
// Each kind picks a target from the level; reward is a few seconds' worth of income.
export const MISSIONS = [
  { id: 'stuffAny', time: 75, count: (L) => 5 + L },
  { id: 'stuffType', time: 90, count: (L) => 2 + Math.floor(L / 3) },
  { id: 'ko', time: 60, count: (L) => 4 + L },
  { id: 'ship', time: 90, count: (L) => Math.round((60 * levelValueMult(L) * (4 + L)) / 10) * 10 },
  { id: 'koKnight', time: 90, count: () => 2, minLevel: 3 },
  { id: 'golden', time: 120, count: () => 1, minLevel: 3 },
];
export const MISSION_GAP = 12; // seconds between missions
export const MISSION_NUGGET_CHANCE = 0.25;

// Upgrades are pure data: cost = base * growth^level.
export const UPGRADES = [
  { id: 'speed', cat: 'player', icon: '👟', max: 10, base: 40, growth: 1.7 },
  { id: 'carry', cat: 'player', icon: '🎒', max: 9, base: 60, growth: 1.9 },
  { id: 'damage', cat: 'blaster', icon: '💥', max: 8, base: 80, growth: 2.0 },
  { id: 'firerate', cat: 'blaster', icon: '⚡', max: 8, base: 60, growth: 1.8 },
  { id: 'ammo', cat: 'blaster', icon: '🫧', max: 8, base: 50, growth: 1.7 },
  { id: 'slots', cat: 'factory', icon: '🏭', max: 5, base: 150, growth: 2.6 },
  { id: 'process', cat: 'factory', icon: '⚙️', max: 10, base: 70, growth: 1.8 },
  { id: 'belt', cat: 'factory', icon: '➡️', max: 10, base: 50, growth: 1.7 },
  { id: 'value', cat: 'factory', icon: '🏷️', max: 25, base: 120, growth: 1.6 },
  { id: 'supply', cat: 'business', icon: '🚚', max: 10, base: 100, growth: 1.9 },
  { id: 'robotSpeed', cat: 'automation', icon: '🔋', max: 8, base: 150, growth: 1.8, requiresPlaced: 'dock' },
  { id: 'turretPower', cat: 'automation', icon: '🎯', max: 8, base: 300, growth: 1.85, requiresPlaced: 'turret' },
];

// One-time purchases with cash: expansions, weapons and the X-ray scanner.
export const UNLOCKS = [
  { id: 'wrapper', cat: 'expansion', icon: '🎁', cost: 900 },
  { id: 'silo', cat: 'expansion', icon: '🛢️', cost: 600 },
  { id: 'minigun', cat: 'weapons', icon: '💨', cost: 1500 },
  { id: 'net', cat: 'weapons', icon: '🕸️', cost: 400 },
  { id: 'confetti', cat: 'weapons', icon: '🎉', cost: 750 },
  { id: 'vacuum', cat: 'weapons', icon: '🌀', cost: 1200 },
];

// Machines placed freely in the factory. cost grows with how many you already bought.
// size = footprint in metres (x, z) before rotation.
export const PLACEABLES = [
  { id: 'dock', icon: '🤖', cost: 250, growth: 1.9, size: [1.6, 1.6] },
  { id: 'turret', icon: '🔫', cost: 600, growth: 1.8, size: [1.2, 1.2] },
  { id: 'arm', icon: '🦿', cost: 450, growth: 1.7, size: [1.4, 1.4] },
  { id: 'lure', icon: '🍭', cost: 300, growth: 1.6, size: [1.0, 1.0] },
  { id: 'scanner', icon: '🩻', cost: 1200, growth: 1.8, size: [1.2, 4.2] },
  { id: 'extractor', icon: '⛏️', cost: 1500, growth: 1.8, size: [1, 1] },
  { id: 'stuffer', icon: '🏭', cost: 1200, growth: 2.2, size: [3, 3] },
  // legendary: paid with gold nuggets (10+ each)
  { id: 'megadock', icon: '🦾', nuggets: 10, size: [1.8, 1.8], legendary: true },
  { id: 'starTurret', icon: '🌟', nuggets: 12, size: [1.4, 1.4], legendary: true },
];

// Belts are bought by the metre (in packs) into the bag and laid as a path of 1 m tiles.
export const BELT_PRICE = 25;
export const BELT_PACK = 10;
// Selling something back (build mode, X) returns this share of what it cost.
export const SELL_RATIO = 0.5;

export function placeableCost(def, bought) {
  return def.nuggets ? def.nuggets : Math.round(def.cost * Math.pow(def.growth, bought));
}

// Legendary weapon bought with nuggets.
export const LEGENDARY_WEAPONS = [{ id: 'rainbow', icon: '🌈', nuggets: 15 }];

export const AD_NUGGETS = 1; // the nugget video pays one gold nugget
export const AD_COOLDOWN = 180; // seconds between two videos of the same kind

// The cash video pays about one upgrade's worth at the current factory level: 100 at level 1, ~2.7k at 10.
export function adCashReward(level) {
  return Math.max(100, Math.round((100 * levelValueMult(level) * (1 + (level - 1) * 0.4)) / 10) * 10);
}

// Weapon tuning. The blaster's numbers come from upgrades (see computeStats).
export const WEAPONS = {
  blaster: { slot: 1, icon: '🫧' },
  // Foam minigun: hold to spray; weak, slightly inaccurate shots at a very high rate.
  minigun: { slot: 2, icon: '💨', mag: 40, reload: 2.2, cooldown: 0.075, damage: 1, spread: 0.035, range: 45 },
  // Net: slow arcing projectile, instantly knocks out whatever it lands on (armour included).
  net: { slot: 3, icon: '🕸️', mag: 3, reload: 2.4, cooldown: 0.75, speed: 20, radius: 1.1, koTime: 14 },
  // Confetti cannon: short-range cone that damages every plushie in it.
  confetti: { slot: 4, icon: '🎉', mag: 2, reload: 2.2, cooldown: 0.9, range: 7.5, cone: 0.42, damage: 2 },
  // Vacuum: hold to pull knocked-out plushies into your arms.
  vacuum: { slot: 5, icon: '🌀', range: 9, cone: 0.5, pull: 7, grabDist: 1.3 },
  // Legendary rainbow ray: rapid beam that knocks out anything in one hit, armour included.
  rainbow: { slot: 6, icon: '🌈', cooldown: 0.12, range: 40 },
};

// Cosmetics. slot 'decor' items toggle independently; the others are equipped one at a time.
export const COSMETICS = [
  { id: 'glove_yellow', slot: 'gloves', color: 0xffd23f, cost: 0 },
  { id: 'glove_pink', slot: 'gloves', color: 0xff6b8b, cost: 150 },
  { id: 'glove_mint', slot: 'gloves', color: 0x5fe0b7, cost: 150 },
  { id: 'glove_black', slot: 'gloves', color: 0x2a2a33, cost: 250 },
  { id: 'glove_gold', slot: 'gloves', color: 0xffc933, metal: true, cost: 1500 },
  { id: 'skin_orange', slot: 'blaster', colors: [0xff8a3d, 0x3f73c4, 0xff6b8b], cost: 0 },
  { id: 'skin_bubblegum', slot: 'blaster', colors: [0xff9ecf, 0xf6f1f6, 0x5fe0b7], cost: 200 },
  { id: 'skin_ocean', slot: 'blaster', colors: [0x2fb5d6, 0x1d3b6e, 0xffd23f], cost: 200 },
  { id: 'skin_midnight', slot: 'blaster', colors: [0x2a2140, 0xff6b8b, 0x5fe0b7], cost: 350 },
  { id: 'skin_gold', slot: 'blaster', colors: [0xffc933, 0x6b4a12, 0xffffff], metal: true, cost: 2000 },
  { id: 'paint_pink', slot: 'stuffer', color: 0xff6b8b, cost: 0 },
  { id: 'paint_blue', slot: 'stuffer', color: 0x3f73c4, cost: 250 },
  { id: 'paint_mint', slot: 'stuffer', color: 0x2fb58a, cost: 250 },
  { id: 'paint_purple', slot: 'stuffer', color: 0x7a4fd1, cost: 250 },
  { id: 'decor_bunting', slot: 'decor', cost: 300 },
  { id: 'decor_plants', slot: 'decor', cost: 400 },
  { id: 'decor_statue', slot: 'decor', cost: 2500 },
];
export const DEFAULT_EQUIP = { gloves: 'glove_yellow', blaster: 'skin_orange', stuffer: 'paint_pink' };

export function upgradeCost(u, level) {
  return Math.round(u.base * Math.pow(u.growth, level));
}

// Derived stats: base value modified by upgrade levels.
export function computeStats(levels, unlocks = {}) {
  const L = (id) => levels[id] || 0;
  return {
    moveSpeed: 5 * (1 + 0.08 * L('speed')),
    carry: 1 + L('carry'),
    damage: 1 + L('damage'),
    fireCooldown: 0.38 * Math.pow(0.88, L('firerate')),
    magSize: 6 + 3 * L('ammo'),
    reloadTime: 1.2,
    slots: 1 + L('slots'),
    queueSize: unlocks.silo ? 6 : 3,
    wrap: !!unlocks.wrapper,
    processTime: 2.6 * Math.pow(0.86, L('process')),
    beltSpeed: 1.3 * (1 + 0.2 * L('belt')),
    valueMult: 1 + 0.15 * L('value'),
    supply: L('supply'),
    robotSpeed: 2.6 * (1 + 0.18 * L('robotSpeed')),
    turretCooldown: 1.6 * Math.pow(0.85, L('turretPower')),
    turretDamage: 1 + Math.floor(L('turretPower') / 2),
  };
}

export function newSave() {
  return {
    version: 4,
    cash: 0,
    earned: 0, // lifetime earnings: drives the factory level and the $1M goal
    nuggets: 0,
    won: false,
    levels: {},
    unlocks: {},
    placed: [{ ...LAYOUT.starter.stuffer }], // [{ type, x, z, rot }]
    belts: LAYOUT.starter.belts.map((b) => ({ ...b })), // 1 m belt tiles, d = quarter-turn direction
    inventory: {}, // bought but not placed: { type: count }
    bought: {}, // how many of each placeable were bought (price scaling)
    cosmetics: { owned: [], equipped: { ...DEFAULT_EQUIP }, decor: [] },
    tutorialDone: false,
    totals: { stuffed: 0, knockouts: 0, nuggets: 0, missions: 0 },
  };
}
