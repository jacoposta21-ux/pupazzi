// Conveyor belt carrying cans from the Stuffer to the shipping chute, with back-pressure.
import * as THREE from 'three';
import { LAYOUT, PLUSHIES } from '../data/config.js';
import { beltTexture, labelTexture, hazardTexture } from '../world/Textures.js';
import { Audio } from '../systems/Audio.js';

const CAN_GAP = 0.55;
const canGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 18);
const lidMat = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.8, roughness: 0.3 });

export class Conveyor {
  constructor(game) {
    this.game = game;
    const { startX, endX, z, top } = LAYOUT.belt;
    this.start = new THREE.Vector3(startX, top, z);
    this.end = new THREE.Vector3(endX, top, z);
    this.length = this.start.distanceTo(this.end);
    this.dir = new THREE.Vector3().subVectors(this.end, this.start).normalize();
    this.cans = [];
    this.canMats = new Map();

    const scene = game.scene;
    const len = this.length;
    const midX = (startX + endX) / 2;

    this.tex = beltTexture();
    this.tex.repeat.set(len / 1.2, 1);
    const side = new THREE.MeshStandardMaterial({ color: 0x3a3f47 });
    const beltMats = [side, side, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9 }), side, side, side];
    const belt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 1.1), beltMats);
    belt.position.set(midX, top - 0.1, z);
    belt.receiveShadow = game.shadows;
    scene.add(belt);
    game.solids.push(belt);

    const railMat = new THREE.MeshStandardMaterial({ map: hazardTexture(len) });
    for (const sz of [-0.6, 0.6]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.1), railMat);
      rail.position.set(midX, top + 0.05, z + sz);
      scene.add(rail);
    }
    const legMat = new THREE.MeshStandardMaterial({ color: 0x59606b });
    for (let x = startX - 0.6; x > endX; x -= 1.8) {
      for (const sz of [-0.45, 0.45]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, top - 0.2, 0.12), legMat);
        leg.position.set(x, (top - 0.2) / 2, z + sz);
        scene.add(leg);
      }
    }
    game.colliders.add(endX, startX, z - 0.65, z + 0.65, top);

    // Shipping chute in the wall
    const chute = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 1.6), new THREE.MeshStandardMaterial({ color: 0x1b1d22 }));
    chute.position.set(LAYOUT.floor.minX + 0.1, top + 0.55, z);
    scene.add(chute);
    const flapMat = new THREE.MeshStandardMaterial({ color: 0x2c6fd1, transparent: true, opacity: 0.8 });
    for (let i = -3; i <= 3; i++) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.2), flapMat);
      flap.position.set(LAYOUT.floor.minX + 0.3, top + 0.6, z + i * 0.21);
      scene.add(flap);
    }
  }

  canMaterial(type) {
    if (!this.canMats.has(type)) {
      const color = '#' + PLUSHIES[type].color.toString(16).padStart(6, '0');
      this.canMats.set(type, new THREE.MeshStandardMaterial({ map: labelTexture(color), roughness: 0.5, metalness: 0.2 }));
    }
    return this.canMats.get(type);
  }

  hasRoom() {
    const last = this.cans[this.cans.length - 1];
    return !last || last.s >= CAN_GAP;
  }

  addCan(value, type) {
    const mesh = new THREE.Mesh(canGeo, [this.canMaterial(type), lidMat, lidMat]);
    mesh.castShadow = this.game.shadows;
    mesh.rotation.y = Math.PI / 2;
    this.game.scene.add(mesh);
    const can = { mesh, s: 0, value, drop: 0.5 };
    this.cans.push(can);
    this.place(can);
    Audio.play('can');
  }

  place(can) {
    can.mesh.position.copy(this.start).addScaledVector(this.dir, can.s);
    can.mesh.position.y += 0.21 + can.drop;
  }

  update(dt, speed) {
    this.tex.offset.x += (speed * dt) / 1.2;
    let limit = Infinity;
    // cans are ordered from oldest (front) to newest (back)
    for (let i = 0; i < this.cans.length; i++) {
      const c = this.cans[i];
      c.s = Math.min(c.s + speed * dt, limit - CAN_GAP);
      c.drop = Math.max(0, c.drop - dt * 3);
      limit = c.s;
      this.place(c);
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
