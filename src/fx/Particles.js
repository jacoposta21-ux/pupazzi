// Pooled particle bursts and blaster tracers.
import * as THREE from 'three';

const geo = new THREE.IcosahedronGeometry(1, 0);
const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2);

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.mats = new Map();
    this.pool = [];
    this.active = [];
    this.tracers = [];
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.85 });
  }

  mat(color) {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      this.mats.set(color, m);
    }
    return m;
  }

  burst(pos, { count = 8, color = 0xffffff, speed = 3, size = 0.06, life = 0.6, gravity = 8, up = 1.5 } = {}) {
    for (let i = 0; i < count; i++) {
      const m = this.pool.pop() ?? new THREE.Mesh(geo);
      m.material = this.mat(color);
      m.position.copy(pos);
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      m.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2 * speed,
        Math.random() * speed + up,
        (Math.random() - 0.5) * 2 * speed,
      );
      m.userData.life = m.userData.maxLife = life * (0.7 + Math.random() * 0.6);
      m.userData.gravity = gravity;
      m.userData.size = m.scale.x;
      this.scene.add(m);
      this.active.push(m);
    }
  }

  // Single particle with an explicit velocity (used for streams, e.g. the vacuum).
  spawn(pos, vel, { color = 0xffffff, size = 0.04, life = 0.3, gravity = 0 } = {}) {
    const m = this.pool.pop() ?? new THREE.Mesh(geo);
    m.material = this.mat(color);
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.userData.vel = vel.clone();
    m.userData.life = m.userData.maxLife = life;
    m.userData.gravity = gravity;
    m.userData.size = size;
    this.scene.add(m);
    this.active.push(m);
  }

  tracer(from, to) {
    const m = new THREE.Mesh(tracerGeo, this.tracerMat);
    const len = from.distanceTo(to);
    m.position.copy(from).lerp(to, 0.5);
    m.lookAt(to);
    m.scale.set(0.02, 0.02, len);
    m.userData.life = 0.06;
    this.scene.add(m);
    this.tracers.push(m);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      const d = m.userData;
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(m);
        this.active.splice(i, 1);
        this.pool.push(m);
        continue;
      }
      d.vel.y -= d.gravity * dt;
      m.position.addScaledVector(d.vel, dt);
      if (m.position.y < 0.03) {
        m.position.y = 0.03;
        d.vel.multiplyScalar(0.5);
      }
      m.scale.setScalar(d.size * Math.min(1, (d.life / d.maxLife) * 2));
      m.rotation.x += dt * 5;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const m = this.tracers[i];
      m.userData.life -= dt;
      if (m.userData.life <= 0) {
        this.scene.remove(m);
        this.tracers.splice(i, 1);
      }
    }
  }

  clear() {
    for (const m of this.active) this.scene.remove(m);
    this.pool.push(...this.active);
    this.active.length = 0;
  }
}

