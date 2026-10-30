// Fluffbot: a little vacuum robot that collects knocked-out plushies and drops them into the Stuffer.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { Audio } from '../systems/Audio.js';

const RADIUS = 0.4;
const PICK_DIST = 0.75;
const DROP = new THREE.Vector3(LAYOUT.stuffer.x, 0, LAYOUT.stuffer.z + LAYOUT.stuffer.d / 2 + 0.75);
const _d = new THREE.Vector3();

let M = null;
function mats() {
  M ??= {
    shell: new THREE.MeshStandardMaterial({ color: 0xf6f1f6, roughness: 0.35 }),
    pink: new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x1d1726, roughness: 0.2 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x5fe0b7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
    light: new THREE.MeshBasicMaterial({ color: 0xffd23f }),
  };
  return M;
}

export class Robot {
  constructor(game, index) {
    this.game = game;
    this.state = 'seek';
    this.target = null;
    this.cargo = null;
    this.timer = 0;
    this.heading = 0;
    this.stuck = 0;
    this.sidestep = 0;
    this.home = new THREE.Vector3(-4 + index * 1.4, 0, -2.5);
    this.mesh = this.build();
    this.pos = this.mesh.position;
    this.pos.copy(this.home);
    game.scene.add(this.mesh);
  }

  build() {
    const m = mats();
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, parent = g) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(0.42, 0.45, 0.2, 24), m.shell, 0, 0.14, 0);
    add(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 24), m.pink, 0, 0.06, 0);
    add(new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.shell, 0, 0.24, -0.05);
    // face screen
    const face = add(new THREE.BoxGeometry(0.34, 0.16, 0.04), m.screen, 0, 0.34, 0.2);
    face.rotation.x = -0.35;
    for (const x of [-0.07, 0.07]) add(new THREE.SphereGeometry(0.025, 8, 6), m.eye, x, 0.01, 0.025, face);
    // antenna
    add(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6), m.dark, 0, 0.62, -0.1);
    this.bulb = add(new THREE.SphereGeometry(0.035, 8, 6), m.light, 0, 0.73, -0.1);
    // tray on the back that holds the plushie
    this.tray = new THREE.Group();
    this.tray.position.set(0, 0.32, -0.22);
    g.add(this.tray);
    return g;
  }

  findTarget() {
    let best = null;
    let bestD = Infinity;
    for (const p of this.game.plushies.list) {
      if (p.state !== 'ko' || p.claimedBy) continue;
      const d = p.pos.distanceToSquared(this.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  release() {
    if (this.target?.claimedBy === this) this.target.claimedBy = null;
    this.target = null;
  }

  moveTo(goal, speed, dt) {
    _d.subVectors(goal, this.pos).setY(0);
    const dist = _d.length();
    if (dist < 0.05) return dist;
    _d.divideScalar(dist);
    if (this.sidestep > 0) {
      // slide sideways around whatever we bumped into
      this.sidestep -= dt;
      _d.set(-_d.z, 0, _d.x);
    }
    const want = Math.atan2(_d.x, _d.z);
    let diff = want - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += diff * Math.min(1, dt * 8);
    const step = Math.min(dist, speed * dt);
    const before = this.pos.clone();
    this.pos.x += Math.sin(this.heading) * step;
    this.pos.z += Math.cos(this.heading) * step;
    this.game.colliders.resolve(this.pos, RADIUS, 0);
    const moved = before.distanceTo(this.pos);
    this.stuck = moved < step * 0.3 ? this.stuck + dt : 0;
    if (this.stuck > 0.4) {
      this.sidestep = 0.7;
      this.stuck = 0;
    }
    return dist;
  }

  update(dt) {
    const speed = this.game.stats.robotSpeed;
    this.timer -= dt;
    this.bulb.visible = this.state === 'seek' ? Math.sin(performance.now() / 300) > 0 : true;

    switch (this.state) {
      case 'seek': {
        if (this.timer > 0) break;
        this.timer = 0.3;
        const p = this.findTarget();
        if (p) {
          this.target = p;
          p.claimedBy = this;
          this.state = 'fetch';
          Audio.play('robot');
        } else if (this.pos.distanceTo(this.home) > 0.3) {
          this.moveTo(this.home, speed * 0.6, 0.3);
        }
        break;
      }
      case 'fetch': {
        const p = this.target;
        if (!p || p.state !== 'ko' || p.claimedBy !== this) {
          this.release();
          this.state = 'seek';
          break;
        }
        if (this.moveTo(p.pos, speed, dt) < PICK_DIST) {
          p.state = 'carried';
          p.claimedBy = null;
          p.mesh.removeFromParent();
          p.mesh.position.set(0, 0, 0);
          p.mesh.rotation.set(0, 0, 0);
          p.mesh.scale.setScalar(0.55 * p.def.scale);
          p.body.rotation.set(0, 0, 0);
          p.body.position.y = 0;
          p.stars.visible = false;
          this.tray.add(p.mesh);
          this.cargo = p;
          this.target = null;
          this.state = 'deliver';
          Audio.play('grab');
        }
        break;
      }
      case 'deliver': {
        if (this.moveTo(DROP, speed, dt) < 0.35) {
          this.heading = Math.PI; // face the machine
          if (this.timer <= 0) {
            this.timer = 0.6;
            if (this.game.stuffer.tryAccept(this.cargo, { silent: true })) {
              this.cargo = null;
              this.state = 'seek';
              this.timer = 0.2;
            }
          }
        }
        break;
      }
    }
    this.mesh.rotation.y = this.heading;
    this.mesh.position.y = Math.abs(Math.sin(performance.now() / 90)) * 0.015;
  }

  // Leave the factory clean: anything still on the tray drops back to the floor knocked out.
  dispose() {
    this.release();
    if (this.cargo) {
      const p = this.cargo;
      p.mesh.removeFromParent();
      p.mesh.scale.setScalar(p.def.scale);
      p.pos.set(this.pos.x, 0, this.pos.z + 0.6);
      this.game.scene.add(p.mesh);
      p.knockOut(3);
      this.cargo = null;
    }
    this.mesh.removeFromParent();
  }
}
