// Freely placeable machines: Fluffbot docks, Sparabot turrets, robot arms, lures, scanners and production lines.
// rot is a quarter-turn count (0-3); dir(rot) is the machine's facing on the XZ plane.
import * as THREE from 'three';
import { PLACEABLES, LAYOUT } from '../data/config.js';
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

// ---------- Robot arm: grabs knocked-out plushies within reach and drops them into a nearby Stuffer ----------
const ARM_REACH = 2.6; // pick-up radius around the base
const ARM_STUFFER_RANGE = 5; // the hopper must be this close

class RobotArm extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    this.state = 'idle';
    this.t = 0;
    this.held = null;
    this.target = null;
    this.yaw = 0;
    this.reach = 0; // 0 = folded up, 1 = reaching down to the floor
    const g = this.group;
    add(g, new THREE.CylinderGeometry(0.55, 0.65, 0.3, 20), MAT.base, 0, 0.15, 0);
    this.turret = new THREE.Group();
    this.turret.position.y = 0.3;
    g.add(this.turret);
    add(this.turret, new THREE.CylinderGeometry(0.35, 0.4, 0.4, 16), MAT.yellow, 0, 0.2, 0);
    // shoulder -> upper arm -> elbow -> forearm -> claw
    this.shoulder = new THREE.Group();
    this.shoulder.position.y = 0.45;
    this.turret.add(this.shoulder);
    add(this.shoulder, new THREE.SphereGeometry(0.2, 12, 10), MAT.dark);
    add(this.shoulder, new THREE.BoxGeometry(0.18, 1.3, 0.18), MAT.yellow, 0, 0.65, 0);
    this.elbow = new THREE.Group();
    this.elbow.position.y = 1.3;
    this.shoulder.add(this.elbow);
    add(this.elbow, new THREE.SphereGeometry(0.16, 12, 10), MAT.dark);
    add(this.elbow, new THREE.BoxGeometry(0.14, 1.2, 0.14), MAT.yellow, 0, 0.6, 0);
    this.claw = new THREE.Group();
    this.claw.position.y = 1.2;
    this.elbow.add(this.claw);
    add(this.claw, new THREE.CylinderGeometry(0.16, 0.12, 0.14, 12), MAT.dark);
    for (const sx of [-1, 1]) {
      const f = add(this.claw, new THREE.BoxGeometry(0.05, 0.25, 0.08), MAT.white, sx * 0.1, 0.15, 0);
      f.rotation.z = sx * 0.3;
    }
    this.lamp = add(this.turret, new THREE.SphereGeometry(0.07, 10, 8), MAT.glow, 0, 0.45, 0.32);
    this.collide(1.0);
  }

  // Closest Stuffer within range: the one we feed.
  get stuffer() {
    let best = null;
    let bestD = ARM_STUFFER_RANGE;
    for (const s of this.game.stuffers) {
      if (!s.enabled) continue;
      const d = Math.hypot(s.center.x - this.pos.x, s.center.z - this.pos.z) - 1.5;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  findPlushie() {
    for (const p of this.game.plushies.list) {
      if ((p.state !== 'ko' && p.state !== 'dazed') || p.claimedBy) continue;
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < ARM_REACH) return p;
    }
    return null;
  }

  // Turn the arm (in world yaw) and set how far it reaches: 0 = up, 1 = down to the floor.
  pose(worldYaw, reach, dt, speed = 6) {
    const want = worldYaw - this.group.rotation.y;
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * speed);
    this.reach += (reach - this.reach) * Math.min(1, dt * speed);
    this.turret.rotation.y = this.yaw;
    this.shoulder.rotation.x = 0.2 + this.reach * 1.05;
    this.elbow.rotation.x = 0.9 + this.reach * 0.9;
    return Math.abs(diff) < 0.08 && Math.abs(reach - this.reach) < 0.05;
  }

  update(dt) {
    const s = this.stuffer;
    this.lamp.material = s ? MAT.glow : MAT.pink;
    if (!s) {
      this.pose(this.yaw + this.group.rotation.y, 0, dt, 2);
      return;
    }
    const yawTo = (p) => Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    switch (this.state) {
      case 'idle': {
        this.pose(yawTo(s.center), 0, dt, 3);
        this.t -= dt;
        if (this.t > 0) break;
        this.t = 0.25;
        const p = this.findPlushie();
        if (p) {
          this.target = p;
          p.claimedBy = this;
          this.state = 'reach';
        }
        break;
      }
      case 'reach': {
        const p = this.target;
        if (!p || p.claimedBy !== this || (p.state !== 'ko' && p.state !== 'dazed')) {
          this.state = 'idle';
          break;
        }
        const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        if (this.pose(yawTo(p.pos), THREE.MathUtils.clamp(d / ARM_REACH, 0.4, 1) * (p.pos.y > 0.5 ? 0.75 : 1), dt)) {
          // grab: the plushie hangs from the claw
          p.state = 'carried';
          p.claimedBy = this;
          p.mesh.removeFromParent();
          p.mesh.position.set(0, 0.45, 0);
          p.mesh.rotation.set(Math.PI, 0, 0);
          p.mesh.scale.setScalar(0.7 * Math.min(1, p.def.scale));
          p.stars.visible = false;
          this.claw.add(p.mesh);
          this.held = p;
          this.state = 'swing';
          Audio.play('grab');
        }
        break;
      }
      case 'swing': {
        if (this.pose(yawTo(s.center), 0, dt, 4)) {
          if (s.tryAccept(this.held, { silent: true })) {
            this.held = null;
            this.state = 'idle';
            this.t = 0.3;
            Audio.play('armDrop');
          }
        }
        break;
      }
    }
  }

  dispose() {
    if (this.target?.claimedBy === this) this.target.claimedBy = null;
    if (this.held) {
      // put it back on the floor next to the arm
      const p = this.held;
      p.mesh.removeFromParent();
      p.mesh.scale.setScalar(p.def.scale);
      p.mesh.rotation.set(0, 0, 0);
      p.pos.set(this.pos.x + 1, 0, this.pos.z);
      this.game.scene.add(p.mesh);
      p.claimedBy = null;
      p.knockOut(3);
    }
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
  arm: RobotArm,
  lure: Lure,
  line: ProductionLine,
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
    shape(new THREE.BoxGeometry(6, 0.2, 1), 1.5, LAYOUT.belt.top - 0.1, 0);
  } else if (type === 'scanner') {
    shape(new THREE.BoxGeometry(0.4, 2.6, 0.3), 0, 1.3, -1.45);
    shape(new THREE.BoxGeometry(0.4, 2.6, 0.3), 0, 1.3, 1.45);
    shape(new THREE.BoxGeometry(0.5, 0.4, 3.2), 0, 2.7, 0);
  } else if (type === 'turret' || type === 'starTurret') shape(new THREE.CylinderGeometry(0.45, 0.55, 1.2, 12), 0, 0.6, 0);
  else if (type === 'lure') shape(new THREE.CylinderGeometry(0.35, 0.35, 2, 12), 0, 1, 0);
  else if (type === 'arm') {
    shape(new THREE.CylinderGeometry(0.55, 0.65, 0.6, 16), 0, 0.3, 0);
    // reach circle
    const ring = new THREE.Mesh(new THREE.RingGeometry(ARM_REACH - 0.06, ARM_REACH, 40), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
  }
  else shape(new THREE.CylinderGeometry(w * 0.45, w * 0.45, 0.4, 16), 0, 0.2, 0);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 3), mat);
  arrow.rotation.z = -Math.PI / 2;
  arrow.position.set(w / 2 + 0.3, 0.1, 0);
  g.add(arrow);
  g.userData.mat = mat;
  return g;
}
