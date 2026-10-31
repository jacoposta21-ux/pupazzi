// Conveyor belt carrying cans from a Stuffer to a shipping chute in the wall, with back-pressure.
// Optional Gift Wrapper arch halfway along: wrapped cans are worth more.
import * as THREE from 'three';
import { LAYOUT, PLUSHIES, WRAP_BONUS } from '../data/config.js';
import { beltTexture, labelTexture, hazardTexture, signTexture } from '../world/Textures.js';
import { Audio } from '../systems/Audio.js';

const CAN_GAP = 0.55;
const canGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 18);
const lidMat = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.8, roughness: 0.3 });
const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5 });
const ribbonGeo = new THREE.BoxGeometry(0.43, 0.44, 0.06);
const bowGeo = new THREE.TorusGeometry(0.07, 0.025, 6, 12);
const canMats = new Map();

function canMaterial(type) {
  if (!canMats.has(type)) {
    const color = '#' + PLUSHIES[type].color.toString(16).padStart(6, '0');
    canMats.set(type, new THREE.MeshStandardMaterial({ map: labelTexture(color), roughness: 0.5, metalness: 0.2 }));
  }
  return canMats.get(type);
}

export class Conveyor {
  // cfg: { start: {x, z}, dir: {x, z} (axis-aligned unit), length, end: 'wall' | 'crate' }
  constructor(game, cfg) {
    this.game = game;
    this.enabled = true;
    const top = LAYOUT.belt.top;
    const { start, dir, length } = cfg;
    this.start = new THREE.Vector3(start.x, top, start.z);
    this.dir = new THREE.Vector3(dir.x, 0, dir.z);
    this.length = length;
    this.end = this.start.clone().addScaledVector(this.dir, length);
    this.wrapAt = length * 0.5;
    this.cans = [];
    this.colliders = [];
    // Everything is built along local +x from the start point, then the group is rotated.
    this.group = new THREE.Group();
    this.group.position.set(start.x, 0, start.z);
    this.group.rotation.y = Math.atan2(-dir.z, dir.x);
    game.scene.add(this.group);

    const len = length;
    const add = (geo, mat, x, y, zz, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, zz);
      m.castShadow = m.receiveShadow = game.shadows;
      parent.add(m);
      return m;
    };

    this.tex = beltTexture();
    this.tex.repeat.set(-len / 1.2, 1);
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47 });
    const topMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9 });
    this.belt = add(new THREE.BoxGeometry(len, 0.2, 1.1), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat], len / 2, top - 0.1, 0);
    game.solids.push(this.belt);

    const railMat = new THREE.MeshStandardMaterial({ map: hazardTexture(len) });
    for (const sz of [-0.6, 0.6]) add(new THREE.BoxGeometry(len, 0.18, 0.1), railMat, len / 2, top + 0.05, sz);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x59606b });
    for (let i = 0.6; i < len; i += 1.8) {
      for (const sz of [-0.45, 0.45]) add(new THREE.BoxGeometry(0.12, top - 0.2, 0.12), legMat, i, (top - 0.2) / 2, sz);
    }
    this.colliders.push(this.addRect(0, len, -0.65, 0.65, top));

    if (cfg.end === 'wall') {
      // Shipping chute in the wall right after the belt end
      add(new THREE.BoxGeometry(0.3, 1.5, 1.6), new THREE.MeshStandardMaterial({ color: 0x1b1d22 }), len + 0.5, top + 0.55, 0);
      const flapMat = new THREE.MeshStandardMaterial({ color: 0x2c6fd1, transparent: true, opacity: 0.8 });
      for (let i = -3; i <= 3; i++) add(new THREE.BoxGeometry(0.04, 1.2, 0.2), flapMat, len + 0.3, top + 0.6, i * 0.21);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.8),
        new THREE.MeshBasicMaterial({ map: signTexture('SHIPPING', '#3f73c4'), toneMapped: false }),
      );
      sign.position.set(len + 0.39, 3.1, 0);
      sign.rotation.y = -Math.PI / 2;
      this.group.add(sign);
    } else {
      // Shipping crate: cans drop in and get paid
      const crate = new THREE.Group();
      crate.position.set(len + 0.65, 0, 0);
      this.group.add(crate);
      const wood = new THREE.MeshStandardMaterial({ color: 0x3f73c4, roughness: 0.7 });
      add(new THREE.BoxGeometry(1.3, 0.85, 1.6), wood, 0, 0.425, 0, crate);
      add(new THREE.BoxGeometry(1.1, 0.05, 1.4), new THREE.MeshStandardMaterial({ color: 0x15121c }), 0, 0.86, 0, crate);
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.3),
        new THREE.MeshBasicMaterial({ map: signTexture('SHIPPING', '#3f73c4'), toneMapped: false }),
      );
      label.position.set(0.66, 0.5, 0);
      label.rotation.y = Math.PI / 2;
      crate.add(label);
      this.colliders.push(this.addRect(len, len + 1.3, -0.8, 0.8, 0.85));
    }

    // Gift Wrapper arch (shown when bought)
    this.wrapper = new THREE.Group();
    this.wrapper.position.set(this.wrapAt, top, 0);
    const archMat = new THREE.MeshStandardMaterial({ color: 0x7a4fd1, roughness: 0.5 });
    const bowMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 });
    for (const sz of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.25, 1.4, 0.15), archMat, 0, 0.7, sz, this.wrapper);
    add(new THREE.BoxGeometry(0.35, 0.3, 1.6), archMat, 0, 1.45, 0, this.wrapper);
    for (const sz of [-0.12, 0.12]) {
      const bow = add(new THREE.TorusGeometry(0.14, 0.05, 8, 16), bowMat, 0, 1.75, sz, this.wrapper);
      bow.rotation.y = Math.PI / 2;
    }
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.26),
      new THREE.MeshBasicMaterial({ map: signTexture('GIFT WRAP', '#7a4fd1'), toneMapped: false, side: THREE.DoubleSide }),
    );
    label.position.set(-0.18, 1.45, 0);
    label.rotation.y = Math.PI / 2;
    this.wrapper.add(label);
    this.wrapper.visible = false;
    this.group.add(this.wrapper);
  }

  // Adds a collider for a rectangle given in belt-local coordinates (x along the belt).
  addRect(x0, x1, z0, z1, height) {
    const pts = [
      [x0, z0], [x1, z0], [x0, z1], [x1, z1],
    ].map(([lx, lz]) => [this.start.x + this.dir.x * lx - this.dir.z * lz, this.start.z + this.dir.z * lx + this.dir.x * lz]);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    return this.game.colliders.add(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), height);
  }

  dispose() {
    this.flush();
    this.group.removeFromParent();
    for (const c of this.colliders) this.game.colliders.remove(c);
    const i = this.game.solids.indexOf(this.belt);
    if (i >= 0) this.game.solids.splice(i, 1);
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
    for (const c of this.colliders) c.disabled = !on;
    const i = this.game.solids.indexOf(this.belt);
    if (on && i < 0) this.game.solids.push(this.belt);
    if (!on && i >= 0) this.game.solids.splice(i, 1);
  }

  setWrapper(on) {
    this.wrapper.visible = on;
  }

  hasRoom() {
    const last = this.cans[this.cans.length - 1];
    return !last || last.s >= CAN_GAP;
  }

  addCan(value, type) {
    const mesh = new THREE.Mesh(canGeo, [canMaterial(type), lidMat, lidMat]);
    mesh.castShadow = this.game.shadows;
    mesh.rotation.y = Math.PI / 2;
    this.game.scene.add(mesh);
    const can = { mesh, s: 0, value, drop: 0.5, wrapped: false };
    this.cans.push(can);
    this.place(can);
    Audio.play('can');
  }

  wrap(can) {
    can.wrapped = true;
    can.value = Math.round(can.value * WRAP_BONUS);
    const r = new THREE.Mesh(ribbonGeo, ribbonMat);
    can.mesh.add(r);
    const r2 = new THREE.Mesh(ribbonGeo, ribbonMat);
    r2.rotation.y = Math.PI / 2;
    can.mesh.add(r2);
    for (const a of [-0.6, 0.6]) {
      const bow = new THREE.Mesh(bowGeo, ribbonMat);
      bow.position.y = 0.26;
      bow.rotation.set(0, a, 0.5 * Math.sign(a));
      can.mesh.add(bow);
    }
    this.game.particles.burst(can.mesh.position, { count: 6, color: 0xffd23f, speed: 1.2, size: 0.04, up: 1.5 });
    Audio.play('wrap');
  }

  place(can) {
    can.mesh.position.copy(this.start).addScaledVector(this.dir, can.s);
    can.mesh.position.y += 0.21 + can.drop;
  }

  update(dt, speed) {
    if (!this.enabled) return;
    this.tex.offset.x += (speed * dt) / 1.2;
    const wrapOn = this.wrapper.visible;
    let limit = Infinity;
    // cans are ordered from oldest (front) to newest (back)
    for (const c of this.cans) {
      c.s = Math.min(c.s + speed * dt, limit - CAN_GAP);
      c.drop = Math.max(0, c.drop - dt * 3);
      limit = c.s;
      this.place(c);
      if (wrapOn && !c.wrapped && c.s >= this.wrapAt) this.wrap(c);
    }
    while (this.cans.length && this.cans[0].s >= this.length) {
      const c = this.cans.shift();
      c.mesh.removeFromParent();
      this.game.bus.emit('canSold', { value: c.value, pos: c.mesh.position.clone() });
    }
  }

  // End of day: everything on the belt ships instantly. Returns total value.
  flush() {
    let total = 0;
    for (const c of this.cans) {
      total += c.value;
      c.mesh.removeFromParent();
    }
    this.cans.length = 0;
    return total;
  }
}
