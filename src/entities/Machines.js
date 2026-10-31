// Freely placeable machines: Stuffers, Fluffbot docks, Sparabot turrets, robot arms, lures and scanners.
// rot is a quarter-turn count (0-3); dir(rot) is the machine's facing on the XZ plane.
import * as THREE from 'three';
import { PLACEABLES, LAYOUT } from '../data/config.js';
import { Robot } from './Robot.js';
import { Stuffer } from './Stuffer.js';
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

// ---------- Robot arm: grabs any plushie within reach (awake or knocked out) and drops it into a nearby Stuffer ----------
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

  // Nearest plushie in reach that can be picked up: knocked out, dazed or just wandering by.
  findPlushie() {
    let best = null;
    let bestD = ARM_REACH;
    for (const p of this.game.plushies.list) {
      if (!p.grabbable || p.claimedBy) continue;
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
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
        const d = p ? Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) : Infinity;
        // gone, grabbed by someone else, or ran out of reach: give up and look again
        if (!p || p.claimedBy !== this || !p.grabbable || d > ARM_REACH + 0.4) {
          if (p?.claimedBy === this) p.claimedBy = null;
          this.target = null;
          this.state = 'idle';
          break;
        }
        // awake plushies wriggle away, so the arm moves faster for them
        const speed = p.state === 'ko' ? 6 : 10;
        if (this.pose(yawTo(p.pos), THREE.MathUtils.clamp(d / ARM_REACH, 0.4, 1) * (p.pos.y > 0.5 ? 0.75 : 1), dt, speed)) {
          // grab: the plushie hangs from the claw
          const awake = p.state !== 'ko';
          p.state = 'carried';
          p.claimedBy = this;
          p.mesh.removeFromParent();
          p.mesh.position.set(0, 0.45, 0);
          p.mesh.rotation.set(Math.PI, 0, 0);
          p.mesh.scale.setScalar(0.7 * Math.min(1, p.def.scale));
          p.stars.visible = false;
          if (awake) Audio.play('squeak');
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

// ---------- Stuffer: standalone machine; cans drop out of its spout onto a belt (or the floor) ----------
class StufferMachine extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    this.stuffer = new Stuffer(game, { x, z, out: dir(rot) });
    // the Stuffer's own model is what the player aims at to pick the machine up
    this.group.removeFromParent();
    this.group = this.stuffer.group;
    this.group.userData.machine = this;
    game.addStuffer(this.stuffer);
  }

  dispose() {
    this.game.removeStuffer(this.stuffer);
    this.stuffer.dispose();
    for (const c of this.colliders) this.game.colliders.remove(c);
  }
}

// ---------- X-ray Scanner gate ----------
// Stand it across a belt. Cans passing under it are scanned: the ones hiding a nugget get a golden lid
// and the gate's arm lifts them off to the side cell (local +z),
// where another belt can take them to a Nugget Extractor. Without a belt there, they drop to the floor.
const GATE_POST = 1.95;
const LIFT_TIME = 0.7;

class Scanner extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    const g = this.group;
    const frame = new THREE.MeshStandardMaterial({ color: 0x3f73c4, roughness: 0.4 });
    for (const sz of [-GATE_POST, GATE_POST]) {
      add(g, new THREE.BoxGeometry(0.4, 2.6, 0.3), frame, 0, 1.3, sz);
      add(g, new THREE.BoxGeometry(0.42, 0.12, 0.32), MAT.yellow, 0, 0.06, sz);
    }
    add(g, new THREE.BoxGeometry(0.5, 0.4, GATE_POST * 2 + 0.3), frame, 0, 2.7, 0);
    const lamp = add(g, new THREE.BoxGeometry(0.3, 0.12, 1.4), MAT.glow, 0, 2.45, 0);
    lamp.castShadow = false;
    // the scanning curtain over the belt
    this.curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.curtain.rotation.y = Math.PI / 2;
    this.curtain.position.y = 1.2;
    g.add(this.curtain);
    // side marker: where nugget cans are put down
    const pad = add(g, new THREE.BoxGeometry(0.9, 0.02, 0.9), MAT.yellow, 0, 0.01, 1);
    pad.castShadow = false;
    // the lifting arm: a carriage sliding along the crossbeam with a telescopic claw
    this.carriage = new THREE.Group();
    this.carriage.position.y = 2.45;
    g.add(this.carriage);
    add(this.carriage, new THREE.BoxGeometry(0.35, 0.2, 0.35), MAT.dark);
    this.rod = add(this.carriage, new THREE.CylinderGeometry(0.05, 0.05, 1, 8), MAT.white);
    this.claw = new THREE.Group();
    this.carriage.add(this.claw);
    add(this.claw, new THREE.CylinderGeometry(0.16, 0.12, 0.1, 12), MAT.gold);
    this.flash = 0;
    this.held = null;
    this.waiting = [];
    this.liftT = 0;
    // only the two posts are solid: plushies walk through, belts run under
    const d = dir(rot);
    this.d = d;
    for (const sd of [-GATE_POST, GATE_POST]) {
      const cx = x - d.z * sd, cz = z + d.x * sd;
      this.colliders.push(game.colliders.add(cx - 0.2, cx + 0.2, cz - 0.2, cz + 0.2, 2.6));
    }
    this.area = footprint(type, x, z, rot);
    this.side = new THREE.Vector3(x - d.z, LAYOUT.belt.top, z + d.x); // centre of the side cell
  }

  // Local coordinates of a world point: a = along the belt, b = across (towards the side cell).
  local(p) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    return { a: dx * this.d.x + dz * this.d.z, b: -dx * this.d.z + dz * this.d.x };
  }

  setArm(b, drop) {
    this.carriage.position.z = b;
    const len = 0.2 + drop;
    this.rod.scale.y = len;
    this.rod.position.y = -len / 2;
    this.claw.position.y = -len;
  }

  scanFlash(pos) {
    this.flash = 1;
    this.game.ui.floater('💎 ?!', pos.clone().setY(pos.y + 1), 'nugget');
    this.game.ui.toast('nuggetSpotted');
    Audio.play('scanHit');
  }

  update(dt) {
    const game = this.game;
    this.flash = Math.max(0, this.flash - dt * 2);
    this.curtain.material.opacity = 0.14 + Math.sin(performance.now() / 90) * 0.04 + this.flash * 0.5;
    this.curtain.material.color.setHex(this.flash > 0 ? 0xffd23f : 0x66ccff);
    const a = this.area;

    // cans: scanned on the belt line under the gate; nugget cans are lifted aside
    for (const c of game.items.list) {
      if (c.scanned || c.state !== 'loose') continue;
      const l = this.local(c.pos);
      if (Math.abs(l.a) > 0.5 || Math.abs(l.b) > 0.6 || c.pos.y > 1.6) continue;
      c.scanned = true;
      if (!c.nugget) {
        Audio.play('scan');
        continue;
      }
      c.reveal();
      this.scanFlash(c.pos);
      c.state = 'held'; // stop it right here until the arm is free
      this.waiting.push(c);
    }

    // the arm: lift one can at a time from the belt to the side cell
    if (!this.held && this.waiting.length) {
      this.held = this.waiting.shift();
      this.liftFrom = this.held.pos.clone();
      this.liftT = 0;
    }
    if (this.held) {
      const c = this.held;
      this.liftT = Math.min(1, this.liftT + dt / LIFT_TIME);
      const k = this.liftT;
      const top = LAYOUT.belt.top;
      c.pos.lerpVectors(this.liftFrom, this.side, k);
      c.pos.y = top + Math.sin(k * Math.PI) * 0.6;
      c.sync();
      this.setArm(this.local(c.pos).b, 2.45 - (c.pos.y + 0.5));
      if (k >= 1) {
        c.state = 'loose';
        c.vel.set(0, 0, 0);
        this.held = null;
        Audio.play('armDrop');
      }
    } else {
      // idle: park above the belt
      const z = this.carriage.position.z;
      this.setArm(z + (0 - z) * Math.min(1, dt * 4), 0.4);
    }
  }

  dispose() {
    // put anything the arm was holding back down
    for (const c of [this.held, ...this.waiting]) if (c) c.state = 'loose';
    super.dispose();
  }
}

// ---------- Nugget Extractor: only cans go in; nuggets come out, the can carries on out of the front ----------
const EXTRACT_TIME = 1.2;

class Extractor extends Machine {
  constructor(game, type, x, z, rot) {
    super(game, type, x, z, rot);
    const g = this.group;
    const body = new THREE.MeshStandardMaterial({ color: 0x2a2140, roughness: 0.45 });
    add(g, new THREE.BoxGeometry(1, 1.4, 1), body, 0, 0.7, 0);
    add(g, new THREE.BoxGeometry(1.04, 0.2, 1.04), MAT.gold, 0, 1.4, 0);
    // funnel on top for thrown cans
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.3, 0.35, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }),
    );
    funnel.position.y = 1.67;
    g.add(funnel);
    // output hole on the front (local +x)
    add(g, new THREE.BoxGeometry(0.05, 0.5, 0.6), MAT.dark, 0.51, LAYOUT.belt.top + 0.25, 0);
    this.gem = add(g, new THREE.OctahedronGeometry(0.16, 0), MAT.gold, 0, 2.1, 0);
    this.lamp = add(g, new THREE.SphereGeometry(0.08, 10, 8), MAT.glow, -0.51, 1.1, 0);
    this.queue = [];
    this.job = null;
    this.t = 0;
    const d = dir(rot);
    this.out = new THREE.Vector3(x + d.x, LAYOUT.belt.top, z + d.z);
    this.outDir = new THREE.Vector3(d.x, 0, d.z);
    this.collide(1.5);
  }

  update(dt) {
    const game = this.game;
    this.gem.rotation.y += dt * (this.job ? 6 : 1.2);
    this.gem.position.y = 2.1 + Math.sin(performance.now() / 400) * 0.05;
    // swallow cans that reach it (rolling off a belt, dropped or thrown in)
    for (const c of [...game.items.list]) {
      if (c.state !== 'loose' || c.pos.y > 1.9) continue;
      if (Math.abs(c.pos.x - this.pos.x) > 0.8 || Math.abs(c.pos.z - this.pos.z) > 0.8) continue;
      if (c.pos.distanceTo(this.out) < 0.45) continue; // the one it just put out
      game.items.remove(c);
      this.queue.push(c);
      Audio.play('can');
    }
    if (!this.job && this.queue.length) {
      this.job = this.queue.shift();
      this.t = 0;
    }
    if (!this.job) return;
    this.t += dt;
    this.lamp.material = Math.sin(this.t * 20) > 0 ? MAT.glow : MAT.yellow;
    if (this.t < EXTRACT_TIME || !game.items.isFree(this.out)) return;
    const c = this.job;
    this.job = null;
    if (c.takeNugget()) {
      game.addNuggets(1);
      game.onNuggetFound(this.pos.clone().setY(2.3), 1);
    }
    c.revealed = false;
    // the empty can carries on out of the front, onto a belt or the floor
    c.pos.copy(this.out);
    c.vel.set(0, 0, 0);
    if (!game.beltNet.under(this.out)) c.vel.copy(this.outDir).multiplyScalar(1.2);
    c.sync();
    game.scene.add(c.mesh);
    game.items.list.push(c);
    this.lamp.material = MAT.glow;
  }

  dispose() {
    // cans still inside pop back out
    for (const c of [this.job, ...this.queue]) {
      if (!c) continue;
      c.pos.copy(this.out);
      c.state = 'loose';
      c.sync();
      this.game.scene.add(c.mesh);
      this.game.items.list.push(c);
    }
    super.dispose();
  }
}

const CLASSES = {
  dock: Dock,
  megadock: Dock,
  turret: Turret,
  starTurret: Turret,
  arm: RobotArm,
  lure: Lure,
  stuffer: StufferMachine,
  scanner: Scanner,
  extractor: Extractor,
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
  if (type === 'stuffer') {
    shape(new THREE.BoxGeometry(3, LAYOUT.stuffer.h, 3), 0, LAYOUT.stuffer.h / 2, 0);
    // the output cell where cans come out: put the first belt here
    shape(new THREE.BoxGeometry(0.9, 0.05, 0.9), 2, LAYOUT.belt.top, 0);
  } else if (type === 'scanner') {
    shape(new THREE.BoxGeometry(0.4, 2.6, 0.3), 0, 1.3, -GATE_POST);
    shape(new THREE.BoxGeometry(0.4, 2.6, 0.3), 0, 1.3, GATE_POST);
    shape(new THREE.BoxGeometry(0.5, 0.4, GATE_POST * 2 + 0.3), 0, 2.7, 0);
    // side cell where nugget cans are put down
    shape(new THREE.BoxGeometry(0.9, 0.05, 0.9), 0, LAYOUT.belt.top, 1);
  } else if (type === 'extractor') {
    shape(new THREE.BoxGeometry(1, 1.5, 1), 0, 0.75, 0);
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
