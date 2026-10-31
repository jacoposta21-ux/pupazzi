// Freely placeable machines: Fluffbot docks, Sparabot turrets, catapults, lures and whole production lines.
// rot is a quarter-turn count (0-3); dir(rot) is the machine's facing on the XZ plane.
import * as THREE from 'three';
import { PLACEABLES, LAYOUT, GRAVITY } from '../data/config.js';
import { Robot } from './Robot.js';
import { Stuffer } from './Stuffer.js';
import { Conveyor } from './Conveyor.js';
import { Audio } from '../systems/Audio.js';

const DIRS = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];
export const dir = (rot) => DIRS[((rot % 4) + 4) % 4];

export function placeableDef(type) {
  return PLACEABLES.find((p) => p.id === type);
}

// Axis-aligned footprint of a machine centred at (x, z).
export function footprint(type, x, z, rot) {
  const [w, d] = placeableDef(type).size;
  const [hx, hz] = rot % 2 ? [d / 2, w / 2] : [w / 2, d / 2];
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

const MAT = {
  base: new THREE.MeshStandardMaterial({ color: 0x59606b, roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf6f1f6, roughness: 0.4 }),
  pink: new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5 }),
  mint: new THREE.MeshStandardMaterial({ color: 0x5fe0b7, roughness: 0.5 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.7, roughness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2140, roughness: 0.4 }),
  glow: new THREE.MeshBasicMaterial({ color: 0x5fe0b7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xc8955a, roughness: 0.8 }),
};

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

class Machine {
  constructor(game, type, x, z, rot) {
    this.game = game;
    this.type = type;
    this.def = placeableDef(type);
    this.rot = rot;
    this.pos = new THREE.Vector3(x, 0, z);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    const d = dir(rot);
    this.group.rotation.y = Math.atan2(-d.z, d.x);
    this.group.userData.machine = this;
    this.colliders = [];
    game.scene.add(this.group);
  }

  collide(height) {
    const f = footprint(this.type, this.pos.x, this.pos.z, this.rot);
    this.colliders.push(this.game.colliders.add(f.minX, f.maxX, f.minZ, f.maxZ, height));
  }

  update() {}

  dispose() {
    this.group.removeFromParent();
    for (const c of this.colliders) this.game.colliders.remove(c);
  }
}

// ---------- Fluffbot dock (and the legendary Mega dock) ----------
class Dock extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    const mega = type === 'megadock';
    const g = this.group;
    add(g, new THREE.CylinderGeometry(0.8, 0.85, 0.12, 24), MAT.base, 0, 0.06, 0);
    add(g, new THREE.CylinderGeometry(0.6, 0.6, 0.02, 24), mega ? MAT.gold : MAT.mint, 0, 0.13, 0);
    const post = add(g, new THREE.BoxGeometry(0.2, 0.9, 0.3), MAT.white, -0.62, 0.45, 0);
    this.lamp = add(g, new THREE.SphereGeometry(0.08, 10, 8), MAT.glow, -0.62, 0.95, 0);
    post.castShadow = true;
    this.robot = new Robot(game, this.pos, { mega });
  }

  update(dt) {
    this.robot.update(dt);
    this.lamp.visible = this.robot.state === 'seek' || Math.sin(performance.now() / 150) > 0;
  }

  dispose() {
    this.robot.dispose();
    super.dispose();
  }
}

// ---------- Sparabot turret (and the legendary Star turret) ----------
class Turret extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    this.star = type === 'starTurret';
    this.range = this.star ? 11 : 7;
    this.cooldown = 1;
    const g = this.group;
    add(g, new THREE.CylinderGeometry(0.5, 0.6, 0.5, 16), MAT.base, 0, 0.25, 0);
    this.head = new THREE.Group();
    this.head.position.y = 0.85;
    g.add(this.head);
    add(this.head, new THREE.SphereGeometry(0.38, 18, 12), this.star ? MAT.gold : MAT.white);
    const barrel = add(this.head, new THREE.CylinderGeometry(0.07, 0.09, 0.5, 12), this.star ? MAT.yellow : MAT.pink, 0, 0, 0.4);
    barrel.rotation.x = Math.PI / 2;
    const eye = add(this.head, new THREE.SphereGeometry(0.1, 10, 8), MAT.glow, 0, 0.12, 0.3);
    eye.scale.z = 0.4;
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, 0.66);
    this.head.add(this.muzzle);
    this.collide(1.3);
  }

  update(dt) {
    const stats = this.game.stats;
    this.cooldown -= dt;
    let best = null;
    let bestD = this.range;
    for (const p of this.game.plushies.list) {
      if (!p.grabbable || p.state === 'ko') continue;
      const d = p.pos.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) {
      this.head.rotation.y += dt * 0.6;
      return;
    }
    const want = Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z) - this.group.rotation.y;
    let diff = want - this.head.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.head.rotation.y += diff * Math.min(1, dt * 10);
    if (this.cooldown > 0 || Math.abs(diff) > 0.25) return;
    this.cooldown = this.star ? 0.45 : stats.turretCooldown;
    const from = this.muzzle.getWorldPosition(new THREE.Vector3());
    const to = best.pos.clone().setY(0.5 * best.def.scale);
    this.game.particles.tracer(from, to);
    Audio.play('turret');
    if (this.star) {
      // legendary: always a clean knockout, armour or not
      best.armor = 0;
      if (best.helmet) best.helmet.visible = false;
      best.hp = 0;
      best.knockOut();
      this.game.player.weapons.applyHit(best, 'ko', to, { quiet: true });
    } else {
      const result = best.takeHit(stats.turretDamage, this.pos);
      this.game.player.weapons.applyHit(best, result, to, { quiet: true });
    }
  }
}

// ---------- Catapult: flings knocked-out plushies on its pad into the nearest Stuffer ----------
class Catapult extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    this.loaded = null;
    this.timer = 0;
    this.swing = 0;
    const g = this.group;
    add(g, new THREE.CylinderGeometry(0.9, 0.9, 0.08, 24), MAT.wood, 0, 0.04, 0);
    add(g, new THREE.CylinderGeometry(0.75, 0.75, 0.02, 24), MAT.pink, 0, 0.09, 0);
    for (const sz of [-0.35, 0.35]) add(g, new THREE.BoxGeometry(0.12, 0.7, 0.12), MAT.wood, -0.55, 0.4, sz);
    this.arm = new THREE.Group();
    this.arm.position.set(-0.55, 0.7, 0);
    g.add(this.arm);
    add(this.arm, new THREE.BoxGeometry(1.2, 0.08, 0.12), MAT.wood, 0.6, 0, 0);
    add(this.arm, new THREE.CylinderGeometry(0.22, 0.16, 0.12, 14), MAT.yellow, 1.15, 0.06, 0);
  }

  nearestStuffer() {
    let best = null;
    let bestD = Infinity;
    for (const s of this.game.stuffers) {
      if (!s.enabled || !s.hasRoom()) continue;
      const d = s.center.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  update(dt) {
    this.timer -= dt;
    this.swing = Math.max(0, this.swing - dt * 3);
    this.arm.rotation.z = Math.sin(this.swing * Math.PI) * 1.4;
    if (!this.loaded) {
      if (this.timer > 0) return;
      for (const p of this.game.plushies.list) {
        if ((p.state !== 'ko' && p.state !== 'dazed') || p.claimedBy) continue;
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
        if (dx * dx + dz * dz < 1.2 * 1.2) {
          this.loaded = p;
          p.claimedBy = this;
          this.timer = 0.5;
          break;
        }
      }
      return;
    }
    const p = this.loaded;
    if (p.state === 'carried' || p.state === 'gone' || p.claimedBy !== this) {
      this.loaded = null;
      return;
    }
    p.pos.lerp(this.pos, Math.min(1, dt * 8)); // slide onto the pad
    if (this.timer > 0) return;
    const s = this.nearestStuffer();
    if (!s) {
      this.timer = 0.5;
      return;
    }
    // ballistic launch into the hopper
    const from = this.pos.clone().setY(1.2);
    const v = new THREE.Vector3().subVectors(s.hopperCenter, from);
    const flat = Math.hypot(v.x, v.z);
    const T = THREE.MathUtils.clamp(flat / 9, 0.5, 1.6);
    const vel = new THREE.Vector3(v.x / T, v.y / T + 0.5 * GRAVITY * T, v.z / T);
    p.claimedBy = null;
    p.throwFrom(from, vel);
    this.loaded = null;
    this.swing = 1;
    this.timer = 0.6;
    Audio.play('catapult');
  }

  dispose() {
    if (this.loaded) this.loaded.claimedBy = null;
    super.dispose();
  }
}

// ---------- Lure: a giant lollipop that wandering plushies can't resist ----------
class Lure extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    this.radius = 11;
    const g = this.group;
    add(g, new THREE.CylinderGeometry(0.4, 0.45, 0.25, 16), MAT.base, 0, 0.12, 0);
    add(g, new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), MAT.white, 0, 0.85, 0);
    this.candy = new THREE.Group();
    this.candy.position.y = 1.6;
    g.add(this.candy);
    add(this.candy, new THREE.CylinderGeometry(0.42, 0.42, 0.12, 24), MAT.pink).rotation.x = Math.PI / 2;
    add(this.candy, new THREE.TorusGeometry(0.28, 0.05, 8, 24), MAT.white, 0, 0, 0.07);
    add(this.candy, new THREE.TorusGeometry(0.14, 0.05, 8, 24), MAT.yellow, 0, 0, 0.07);
    this.collide(1.0);
  }

  update(dt) {
    this.candy.rotation.y += dt * 1.5;
  }
}

// ---------- Production line: Stuffer + belt (cans drop off the end: route them with belts) ----------
class ProductionLine extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    const d = dir(rot);
    const at = (k) => ({ x: x + d.x * k, z: z + d.z * k });
    const s = at(-3);
    this.conveyor = new Conveyor(game, { start: at(-1.5), dir: d, length: 6, end: 'none' });
    this.stuffer = new Stuffer(game, { x: s.x, z: s.z, out: d }, this.conveyor);
    this.conveyor.setWrapper(game.stats.wrap);
    this.line = { stuffer: this.stuffer, conveyor: this.conveyor };
    game.addLine(this.line);
  }

  dispose() {
    this.game.removeLine(this.line);
    this.stuffer.dispose();
    this.conveyor.dispose();
    super.dispose();
  }
}

// ---------- Belt segment: carries anything put on it (cans, knocked-out plushies) ----------
class BeltSegment extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    const d = dir(rot);
    this.conveyor = new Conveyor(game, { start: { x: x - d.x, z: z - d.z }, dir: d, length: 2, end: 'none', wrapper: false });
    game.belts.push(this.conveyor);
  }

  update(dt) {
    this.conveyor.update(dt, this.game.stats.beltSpeed);
  }

  dispose() {
    this.game.belts = this.game.belts.filter((b) => b !== this.conveyor);
    this.conveyor.dispose();
    super.dispose();
  }
}

// ---------- X-ray Scanner gate: plushies walking (or riding) through get scanned for nuggets ----------
class Scanner extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    const g = this.group;
    const frame = new THREE.MeshStandardMaterial({ color: 0x3f73c4, roughness: 0.4 });
    for (const sz of [-1.45, 1.45]) {
      add(g, new THREE.BoxGeometry(0.4, 2.6, 0.3), frame, 0, 1.3, sz);
      add(g, new THREE.BoxGeometry(0.42, 0.12, 0.32), MAT.yellow, 0, 0.06, sz);
    }
    add(g, new THREE.BoxGeometry(0.5, 0.4, 3.2), frame, 0, 2.7, 0);
    const lamp = add(g, new THREE.BoxGeometry(0.3, 0.12, 2.6), MAT.glow, 0, 2.45, 0);
    lamp.castShadow = false;
    // the scanning curtain: a translucent blue sheet that flickers
    this.curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.curtain.rotation.y = Math.PI / 2;
    this.curtain.position.y = 1.2;
    g.add(this.curtain);
    this.flash = 0;
    // only the two posts are solid: plushies walk through the middle
    const d = dir(rot);
    for (const s of [-1.45, 1.45]) {
      const cx = x - d.z * s, cz = z + d.x * s;
      this.colliders.push(game.colliders.add(cx - 0.2, cx + 0.2, cz - 0.2, cz + 0.2, 2.6));
    }
    this.area = footprint(type, x, z, rot);
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 2);
    this.curtain.material.opacity = 0.14 + Math.sin(performance.now() / 90) * 0.04 + this.flash * 0.5;
    this.curtain.material.color.setHex(this.flash > 0 ? 0xffd23f : 0x66ccff);
    const a = this.area;
    for (const p of this.game.plushies.list) {
      if (p.scanned || p.state === 'carried' || p.state === 'gone') continue;
      if (p.pos.x < a.minX || p.pos.x > a.maxX || p.pos.z < a.minZ || p.pos.z > a.maxZ) continue;
      p.scanned = true;
      if (p.nugget) {
        p.revealed = true;
        this.flash = 1;
        this.game.ui.floater('💎 ?!', p.pos.clone().setY(1.6), 'nugget');
        this.game.ui.toast('nuggetSpotted');
        Audio.play('scanHit');
      } else Audio.play('scan');
    }
  }
}

const CLASSES = {
  dock: Dock,
  megadock: Dock,
  turret: Turret,
  starTurret: Turret,
  catapult: Catapult,
  lure: Lure,
  line: ProductionLine,
  belt: BeltSegment,
  scanner: Scanner,
};

export function createMachine(game, type, x, z, rot) {
  return new CLASSES[type](game, type, x, z, rot);
}

// Translucent preview used while placing: footprint slab + facing arrow + a rough silhouette.
export function buildGhost(type) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x5fe0b7, transparent: true, opacity: 0.45, depthWrite: false });
  const [w, d] = placeableDef(type).size;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mat);
  slab.position.y = 0.03;
  g.add(slab);
  const shape = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  if (type === 'line') {
    shape(new THREE.BoxGeometry(3, LAYOUT.stuffer.h, 3), -3, LAYOUT.stuffer.h / 2, 0);
    shape(new THREE.BoxGeometry(6, 0.2, 1.1), 1.5, LAYOUT.belt.top - 0.1, 0);
  } else if (type === 'belt') shape(new THREE.BoxGeometry(2, 0.2, 1.1), 0, LAYOUT.belt.top - 0.1, 0);
  else if (type === 'scanner') {
    shape(new THREE.BoxGeometry(0.4, 2.6, 0.3), 0, 1.3, -1.45);
    shape(new THREE.BoxGeometry(0.4, 2.6, 0.3), 0, 1.3, 1.45);
    shape(new THREE.BoxGeometry(0.5, 0.4, 3.2), 0, 2.7, 0);
  } else if (type === 'turret' || type === 'starTurret') shape(new THREE.CylinderGeometry(0.45, 0.55, 1.2, 12), 0, 0.6, 0);
  else if (type === 'lure') shape(new THREE.CylinderGeometry(0.35, 0.35, 2, 12), 0, 1, 0);
  else shape(new THREE.CylinderGeometry(w * 0.45, w * 0.45, 0.4, 16), 0, 0.2, 0);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 3), mat);
  arrow.rotation.z = -Math.PI / 2;
  arrow.position.set(w / 2 + 0.3, 0.1, 0);
  g.add(arrow);
  g.userData.mat = mat;
  return g;
}
