// Delivery truck: drives up to the loading door, unloads plushies one by one, then leaves.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { signTexture } from '../world/Textures.js';
import { Audio } from '../systems/Audio.js';

const STOP_X = LAYOUT.door.x;
const START_X = -60;
const END_X = 70;
const UNLOAD_INTERVAL = 0.45;

let sharedMats = null;
function mats() {
  if (!sharedMats) {
    sharedMats = {
      box: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }),
      side: new THREE.MeshStandardMaterial({ map: signTexture('STUFFED CO. · PLUSH LOGISTICS', '#ffffff', '#ff6b8b', 1024, 160) }),
      cab: new THREE.MeshStandardMaterial({ color: 0x3f73c4, roughness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1d2a3a, metalness: 0.6, roughness: 0.2 }),
      wheel: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
      door: new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.6 }),
    };
  }
  return sharedMats;
}

export class Truck {
  constructor(game, count, onSpawn) {
    this.game = game;
    this.remaining = count;
    this.onSpawn = onSpawn;
    this.state = 'arriving';
    this.timer = 0;
    this.speed = 16;
    this.mesh = this.build();
    this.mesh.position.set(START_X, 0, LAYOUT.truckLaneZ);
    game.scene.add(this.mesh);
  }

  build() {
    const m = mats();
    const g = new THREE.Group();
    const shadows = this.game.shadows;
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadows;
      g.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(7, 3, 2.6), m.box, 0, 2.1, 0);
    const side = add(new THREE.PlaneGeometry(6.6, 1), m.side, 0, 2.9, -1.31);
    side.rotation.y = Math.PI;
    add(new THREE.BoxGeometry(2.2, 2.4, 2.5), m.cab, 4.7, 1.8, 0);
    add(new THREE.BoxGeometry(0.1, 1, 2.2), m.glass, 5.81, 2.3, 0);
    this.door = add(new THREE.BoxGeometry(2.4, 2.4, 0.08), m.door, 0, 1.9, -1.34);
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14).rotateX(Math.PI / 2);
    this.wheels = [];
    for (const x of [-2.4, 0.6, 4.6]) for (const z of [-1.2, 1.2]) this.wheels.push(add(wheelGeo, m.wheel, x, 0.5, z));
    return g;
  }

  update(dt) {
    const p = this.mesh.position;
    let v = 0;
    if (this.state === 'arriving') {
      const d = STOP_X - p.x;
      v = Math.min(this.speed, d * 1.6 + 0.5);
      p.x = Math.min(STOP_X, p.x + v * dt);
      if (p.x >= STOP_X - 0.01) {
        this.state = 'unloading';
        this.timer = 0.6;
        Audio.play('horn');
        this.game.bus.emit('truckArrived');
      }
    } else if (this.state === 'unloading') {
      this.door.position.x = THREE.MathUtils.lerp(this.door.position.x, -2.3, Math.min(1, dt * 4));
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.remaining > 0) {
          this.remaining--;
          this.timer = UNLOAD_INTERVAL;
          const from = new THREE.Vector3(p.x + (Math.random() - 0.5) * 2, 1.2, LAYOUT.truckLaneZ - 1.6);
          this.onSpawn(from);
        } else {
          this.state = 'leaving';
          this.speed = 0;
        }
      }
    } else if (this.state === 'leaving') {
      this.door.position.x = THREE.MathUtils.lerp(this.door.position.x, 0, Math.min(1, dt * 4));
      this.speed = Math.min(18, this.speed + dt * 8);
      v = this.speed;
      p.x += v * dt;
      if (p.x > END_X) this.state = 'done';
    }
    for (const w of this.wheels) w.rotation.z -= (v * dt) / 0.5;
  }

  dispose() {
    this.mesh.removeFromParent();
  }
}
