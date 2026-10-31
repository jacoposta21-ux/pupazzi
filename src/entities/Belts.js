// Belt network: 1 m belt tiles on an integer grid. Each tile carries anything on top along its
// direction; a tile whose direction differs from the previous one in a path is a curve.
// Tiles share geometry and one scrolling material, so long belt roads stay cheap to draw.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { beltTexture } from '../world/Textures.js';

const DIRS = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];
const key = (x, z) => `${x},${z}`;
export const dirIndex = (dx, dz) => DIRS.findIndex((d) => d.x === Math.sign(dx) && d.z === Math.sign(dz));

const TOP = LAYOUT.belt.top;
const tex = beltTexture();
tex.repeat.set(-1 / 1.2, 1);
const sideMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47 });
const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
const fixedTopMat = topMat;
const slabGeo = new THREE.BoxGeometry(1, 0.2, 1);
const legGeo = new THREE.BoxGeometry(0.1, TOP - 0.2, 0.1);
const legMat = new THREE.MeshStandardMaterial({ color: 0x59606b });
const arrowGeo = new THREE.ConeGeometry(0.16, 0.36, 3);
const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
const cornerArrowMat = new THREE.MeshBasicMaterial({ color: 0x5fe0b7 });

// One tile: same interface the item system uses for long conveyors (top, dir, local, carries).
export class BeltTile {
  constructor(game, x, z, d, { fixed = false, curve = false } = {}) {
    this.game = game;
    this.x = x;
    this.z = z;
    this.fixed = fixed;
    this.top = TOP;
    this.enabled = true;
    this.wrapper = { visible: false };
    this.wrapAt = Infinity;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.group.userData.tile = this;
    const slab = new THREE.Mesh(slabGeo, [sideMat, sideMat, fixed ? fixedTopMat : topMat, sideMat, sideMat, sideMat]);
    slab.position.y = TOP - 0.1;
    slab.receiveShadow = slab.castShadow = true;
    this.group.add(slab);
    for (const [lx, lz] of [[-0.35, -0.35], [0.35, 0.35]]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, (TOP - 0.2) / 2, lz);
      this.group.add(leg);
    }
    this.arrow = new THREE.Mesh(arrowGeo, curve ? cornerArrowMat : arrowMat);
    this.arrow.rotation.z = -Math.PI / 2;
    this.arrow.scale.z = 0.25;
    this.arrow.position.y = TOP + 0.05;
    this.group.add(this.arrow);
    this.setDir(d, curve);
    this.collider = game.colliders.add(x - 0.5, x + 0.5, z - 0.5, z + 0.5, TOP);
    game.scene.add(this.group);
    game.solids.push(slab);
    this.slab = slab;
  }

  setDir(d, curve = false) {
    this.curve = curve;
    this.d = ((d % 4) + 4) % 4;
    const v = DIRS[this.d];
    this.dir = new THREE.Vector3(v.x, 0, v.z);
    this.start = new THREE.Vector3(this.x - v.x * 0.5, TOP, this.z - v.z * 0.5);
    this.length = 1;
    this.group.rotation.y = Math.atan2(-v.z, v.x);
    this.arrow.material = curve ? cornerArrowMat : arrowMat;
  }

  local(p) {
    const dx = p.x - this.start.x, dz = p.z - this.start.z;
    return { s: dx * this.dir.x + dz * this.dir.z, side: -dx * this.dir.z + dz * this.dir.x };
  }

  carries(p) {
    if (Math.abs(p.y - TOP) > 0.2) return false;
    return Math.abs(p.x - this.x) <= 0.5 && Math.abs(p.z - this.z) <= 0.5;
  }

  dispose() {
    this.group.removeFromParent();
    this.game.colliders.remove(this.collider);
    const i = this.game.solids.indexOf(this.slab);
    if (i >= 0) this.game.solids.splice(i, 1);
  }
}

export class BeltNetwork {
  constructor(game) {
    this.game = game;
    this.tiles = new Map();
  }

  get list() {
    return [...this.tiles.values()];
  }

  at(x, z) {
    return this.tiles.get(key(Math.round(x), Math.round(z))) ?? null;
  }

  // Tile under a resting point, if any.
  under(p) {
    if (Math.abs(p.y - TOP) > 0.2) return null;
    return this.at(p.x, p.z);
  }

  add(x, z, d, opts) {
    const k = key(x, z);
    const old = this.tiles.get(k);
    if (old) {
      old.setDir(d, opts?.curve);
      return old;
    }
    const t = new BeltTile(this.game, x, z, d, opts);
    this.tiles.set(k, t);
    return t;
  }

  remove(t) {
    this.tiles.delete(key(t.x, t.z));
    t.dispose();
  }

  // Removes every tile that isn't fixed (shipping stub). Used when loading another save.
  clear() {
    for (const t of this.list) if (!t.fixed) this.remove(t);
  }

  // Player-built tiles, for saving.
  serialize() {
    return this.list.filter((t) => !t.fixed).map((t) => ({ x: t.x, z: t.z, d: t.d, c: t.curve ? 1 : 0 }));
  }

  update(dt, speed) {
    tex.offset.x += (speed * dt) / 1.2;
  }
}

// An L-shaped path of cells from a to b (integer grid). xFirst: walk along x, then along z.
// Returns [{ x, z, d, curve }]; each cell points to the next one, the last keeps the previous direction.
export function beltPath(a, b, xFirst, defaultD = 0) {
  const cells = [];
  let { x, z } = a;
  cells.push({ x, z });
  const stepAxis = (axis, target) => {
    while ((axis === 'x' ? x : z) !== target) {
      if (axis === 'x') x += Math.sign(target - x);
      else z += Math.sign(target - z);
      cells.push({ x, z });
    }
  };
  if (xFirst) {
    stepAxis('x', b.x);
    stepAxis('z', b.z);
  } else {
    stepAxis('z', b.z);
    stepAxis('x', b.x);
  }
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const next = cells[i + 1];
    const prev = cells[i - 1];
    if (next) c.d = dirIndex(next.x - c.x, next.z - c.z);
    else if (prev) c.d = prev.d;
    else c.d = defaultD;
    // the cell where the path turns is a curve: it takes items in from one side and sends them on
    c.curve = !!prev && prev.d !== c.d;
  }
  return cells;
}
