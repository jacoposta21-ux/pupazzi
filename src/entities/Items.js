// Loose items in the world (cans). Items fall with gravity, rest on the floor or on top of things,
// ride conveyor belts and get paid when they enter the shipping chute. Belts also carry
// knocked-out plushies lying on them.
import * as THREE from 'three';
import { LAYOUT, PLUSHIES, GRAVITY, WRAP_BONUS } from '../data/config.js';
import { labelTexture } from '../world/Textures.js';
import { Audio } from '../systems/Audio.js';

const CAN_H = 0.42;
const CAN_R = 0.2;
const GAP = 0.5; // minimum spacing between cans riding the same belt
const canGeo = new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_H, 18);
const lidMat = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.8, roughness: 0.3 });
// once the X-ray Scanner has spotted a nugget inside, the can gets a golden lid
const goldLidMat = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.8, roughness: 0.25, emissive: 0x664400, emissiveIntensity: 0.5 });
const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5 });
const ribbonGeo = new THREE.BoxGeometry(0.43, 0.44, 0.06);
const bowGeo = new THREE.TorusGeometry(0.07, 0.025, 6, 12);
const canMats = new Map();
const _v = new THREE.Vector3();

function canMaterial(type) {
  if (!canMats.has(type)) {
    const color = '#' + PLUSHIES[type].color.toString(16).padStart(6, '0');
    canMats.set(type, new THREE.MeshStandardMaterial({ map: labelTexture(color), roughness: 0.5, metalness: 0.2 }));
  }
  return canMats.get(type);
}

export class Can {
  constructor(value, type, nugget = false) {
    this.kind = 'can';
    this.type = type;
    this.value = value;
    this.nugget = nugget; // hidden until an X-ray Scanner looks inside
    this.revealed = false;
    this.scanned = false;
    this.wrapped = false;
    this.state = 'loose';
    this.pos = new THREE.Vector3(); // bottom centre
    this.vel = new THREE.Vector3();
    this.mesh = new THREE.Mesh(canGeo, [canMaterial(type), lidMat, lidMat]);
    this.mesh.castShadow = true;
    this.mesh.userData.item = this;
    this.def = { scale: 1, color: PLUSHIES[type].color };
  }

  // X-ray Scanner found a nugget: mark the can with a golden lid.
  reveal() {
    this.revealed = true;
    this.mesh.material = [this.mesh.material[0], goldLidMat, goldLidMat];
  }

  // Nugget Extractor: returns true (once) if this can held a nugget; the lid goes back to plain metal.
  takeNugget() {
    if (!this.nugget) return false;
    this.nugget = false;
    this.mesh.material = [this.mesh.material[0], lidMat, lidMat];
    return true;
  }

  sync() {
    this.mesh.position.set(this.pos.x, this.pos.y + CAN_H / 2, this.pos.z);
  }
}

export class ItemManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    // Shipping chute: the wall opening at the end of the main line
    const sz = LAYOUT.shipping.z;
    const cx = LAYOUT.floor.minX;
    this.chute = { minX: cx - 1, maxX: cx + 0.6, minZ: sz - 0.9, maxZ: sz + 0.9, maxY: 2.2 };
    this.chuteCenter = new THREE.Vector3(cx + 0.2, LAYOUT.belt.top + 0.4, sz);
  }

  spawnCan(pos, value, type, nugget = false) {
    const c = new Can(value, type, nugget);
    c.pos.copy(pos);
    c.sync();
    this.game.scene.add(c.mesh);
    this.list.push(c);
    Audio.play('can');
    return c;
  }

  remove(c) {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    c.mesh.removeFromParent();
  }

  clear() {
    for (const c of this.list) c.mesh.removeFromParent();
    this.list.length = 0;
  }

  meshes() {
    return this.list.filter((c) => c.state === 'loose').map((c) => c.mesh);
  }

  // Is the spot free for a new can (Stuffer output back-pressure)?
  isFree(pos, r = GAP) {
    for (const c of this.list) {
      if (c.state !== 'loose') continue;
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
      if (dx * dx + dz * dz < r * r && Math.abs(c.pos.y - pos.y) < 0.4) return false;
    }
    return true;
  }

  beltUnder(p) {
    return this.game.beltNet.under(p);
  }

  inChute(p) {
    const z = this.chute;
    return p.x > z.minX && p.x < z.maxX && p.z > z.minZ && p.z < z.maxZ && p.y < z.maxY;
  }

  throwCan(c, from, vel) {
    c.state = 'loose';
    c.mesh.removeFromParent();
    c.mesh.scale.setScalar(1);
    c.mesh.rotation.set(0, 0, 0);
    this.game.scene.add(c.mesh);
    c.pos.copy(from);
    c.vel.copy(vel);
    c.sync();
    if (!this.list.includes(c)) this.list.push(c);
  }

  wrap(c) {
    c.wrapped = true;
    c.value = Math.round(c.value * WRAP_BONUS);
    for (const ry of [0, Math.PI / 2]) {
      const r = new THREE.Mesh(ribbonGeo, ribbonMat);
      r.rotation.y = ry;
      c.mesh.add(r);
    }
    for (const a of [-0.6, 0.6]) {
      const bow = new THREE.Mesh(bowGeo, ribbonMat);
      bow.position.y = 0.26;
      bow.rotation.set(0, a, 0.5 * Math.sign(a));
      c.mesh.add(bow);
    }
    this.game.particles.burst(c.mesh.position, { count: 6, color: 0xffd23f, speed: 1.2, size: 0.04, up: 1.5 });
    Audio.play('wrap');
  }

  // Can `c` move `step` metres along `belt` without bumping into the can ahead?
  // Checked in world space so it also works across tiles and around curves.
  blocked(c, belt, step) {
    const d = belt.dir;
    for (const o of this.list) {
      if (o === c || o.state !== 'loose' || Math.abs(o.pos.y - c.pos.y) > 0.3) continue;
      const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;
      const ahead = dx * d.x + dz * d.z;
      const lateral = Math.abs(-dx * d.z + dz * d.x);
      if (ahead > 0 && ahead < GAP + step && lateral < 0.35) return true;
    }
    return false;
  }

  update(dt) {
    const game = this.game;
    const speed = game.stats.beltSpeed;
    const colliders = game.colliders;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.state !== 'loose') continue;
      const belt = c.vel.y <= 0 ? this.beltUnder(c.pos) : null;
      if (belt) {
        // riding a belt; keep the belt's momentum so the can slides onto the next belt (or off the end)
        c.vel.copy(belt.dir).multiplyScalar(speed);
        c.pos.y = belt.top;
        if (!this.blocked(c, belt, speed * dt)) c.pos.addScaledVector(belt.dir, speed * dt);
        else c.vel.set(0, 0, 0);
        // drifting towards the belt centre line keeps cans tidy
        const side = belt.local(c.pos).side;
        c.pos.x -= -belt.dir.z * side * Math.min(1, dt * 4);
        c.pos.z -= belt.dir.x * side * Math.min(1, dt * 4);
      } else {
        // free fall / sliding to a stop
        c.vel.y -= GRAVITY * dt;
        c.pos.addScaledVector(c.vel, dt);
        if (colliders.resolve(c.pos, CAN_R, c.pos.y)) {
          c.vel.x *= -0.3;
          c.vel.z *= -0.3;
        }
        const ground = colliders.groundHeight(c.pos, CAN_R, c.pos.y + 0.05);
        if (c.pos.y <= ground) {
          if (c.vel.y < -4) Audio.play('can');
          c.pos.y = ground;
          c.vel.y = 0;
          c.vel.x *= Math.max(0, 1 - dt * 5);
          c.vel.z *= Math.max(0, 1 - dt * 5);
        }
        const F = LAYOUT.floor;
        c.pos.x = THREE.MathUtils.clamp(c.pos.x, F.minX - 1, F.maxX - 0.3);
        c.pos.z = THREE.MathUtils.clamp(c.pos.z, F.minZ + 0.3, F.maxZ - 0.3);
      }
      c.sync();
      if (this.inChute(c.pos)) {
        this.remove(c);
        game.bus.emit('canSold', { value: c.value, pos: c.mesh.position.clone() });
      }
    }

    // belts carry knocked-out / dazed plushies lying on them too
    for (const p of game.plushies.list) {
      if (p.state !== 'ko' && p.state !== 'dazed') continue;
      const belt = this.beltUnder(p.pos);
      if (belt) p.pos.addScaledVector(belt.dir, speed * dt);
    }
  }

  // End of session: value of everything still lying around (not used for selling, just stats).
  get looseValue() {
    return this.list.reduce((n, c) => n + c.value, 0);
  }
}

export { CAN_H };
