// Conveyor belt: a moving surface. Anything loose resting on top (cans, knocked-out plushies) is carried
// along `dir` by the ItemManager; at the end it drops off (onto the next belt, or the floor).
// Optional Gift Wrapper arch halfway along: wrapped cans are worth more.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { beltTexture, signTexture } from '../world/Textures.js';

const LIP = 0.1; // tiny overlap so items hop cleanly onto the next belt

export class Conveyor {
  // cfg: { start: {x, z}, dir: {x, z} (axis-aligned unit), length, wrapper: bool }
  constructor(game, cfg) {
    this.game = game;
    this.enabled = true;
    const top = LAYOUT.belt.top;
    const { start, dir, length } = cfg;
    this.start = new THREE.Vector3(start.x, top, start.z);
    this.dir = new THREE.Vector3(dir.x, 0, dir.z);
    this.length = length;
    this.end = this.start.clone().addScaledVector(this.dir, length);
    this.top = top;
    this.wrapAt = length * 0.5;
    this.hasWrapper = cfg.wrapper !== false;
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
    this.belt = add(new THREE.BoxGeometry(len, 0.2, 1), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat], len / 2, top - 0.1, 0);
    game.solids.push(this.belt);

    const legMat = new THREE.MeshStandardMaterial({ color: 0x59606b });
    for (let i = 0.6; i < len; i += 1.8) {
      for (const sz of [-0.45, 0.45]) add(new THREE.BoxGeometry(0.12, top - 0.2, 0.12), legMat, i, (top - 0.2) / 2, sz);
    }
    this.colliders.push(this.addRect(0, len, -0.5, 0.5, top));

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
    // one label per side so the text reads correctly from both directions
    const labelMat = new THREE.MeshBasicMaterial({ map: signTexture('GIFT WRAP', '#7a4fd1'), toneMapped: false });
    for (const sx of [-1, 1]) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.26), labelMat);
      label.position.set(sx * 0.18, 1.45, 0);
      label.rotation.y = (sx * Math.PI) / 2;
      this.wrapper.add(label);
    }
    this.wrapper.visible = false;
    this.group.add(this.wrapper);
    // direction chevrons are in the belt texture; short belts get a painted arrow too
    if (length <= 3) {
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 3), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      arrow.rotation.z = -Math.PI / 2; // point along local +x
      arrow.scale.z = 0.25; // flat, painted on the belt
      arrow.position.set(length / 2, top + 0.06, 0);
      this.group.add(arrow);
    }
  }

  // Local belt coordinate (distance along the belt, sideways offset) of a world point.
  local(p) {
    const dx = p.x - this.start.x, dz = p.z - this.start.z;
    return { s: dx * this.dir.x + dz * this.dir.z, side: -dx * this.dir.z + dz * this.dir.x };
  }

  // Is a point resting on the belt surface? The far end has a short lip so items bridge
  // small gaps to the next belt (grid snapping can leave up to ~0.4 m between belts).
  carries(p, margin = 0.05) {
    if (!this.enabled || Math.abs(p.y - this.top) > 0.2) return false;
    const { s, side } = this.local(p);
    return s >= -margin && s <= this.length + LIP && Math.abs(side) <= 0.52;
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
    this.wrapper.visible = on && this.hasWrapper;
  }

  update(dt, speed) {
    if (this.enabled) this.tex.offset.x += (speed * dt) / 1.2;
  }
}
