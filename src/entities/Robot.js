// Fluffbot: a little vacuum robot living on a charging dock. It collects knocked-out plushies
// and delivers them to the nearest Stuffer with room, or drops them on a Catapult pad.
// The legendary Mega Fluffbot is faster and carries several plushies per trip.
import * as THREE from 'three';
import { Audio } from '../systems/Audio.js';

const RADIUS = 0.4;
const PICK_DIST = 0.75;
const CHAIN_RANGE = 7; // a multi-carry bot grabs more plushies only if they are this close
const _d = new THREE.Vector3();

let M = null;
function mats() {
  M ??= {
    shell: new THREE.MeshStandardMaterial({ color: 0xf6f1f6, roughness: 0.35 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.7, roughness: 0.3 }),
    pink: new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x1d1726, roughness: 0.2 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x5fe0b7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
    light: new THREE.MeshBasicMaterial({ color: 0xffd23f }),
  };
  return M;
}

export class Robot {
  constructor(game, home, { mega = false } = {}) {
    this.game = game;
    this.mega = mega;
    this.capacity = mega ? 3 : 1;
    this.state = 'seek';
    this.target = null;
    this.cargo = [];
    this.timer = 0;
    this.heading = 0;
    this.stuck = 0;
    this.sidestep = 0;
    this.home = home.clone();
    this.mesh = this.build();
    this.pos = this.mesh.position;
    this.pos.copy(this.home);
    game.scene.add(this.mesh);
  }

  build() {
    const m = mats();
    const shell = this.mega ? m.gold : m.shell;
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, parent = g) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(0.42, 0.45, 0.2, 24), shell, 0, 0.14, 0);
    add(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 24), m.pink, 0, 0.06, 0);
    add(new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, 0.24, -0.05);
    const face = add(new THREE.BoxGeometry(0.34, 0.16, 0.04), m.screen, 0, 0.34, 0.2);
    face.rotation.x = -0.35;
    for (const x of [-0.07, 0.07]) add(new THREE.SphereGeometry(0.025, 8, 6), m.eye, x, 0.01, 0.025, face);
    add(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6), m.dark, 0, 0.62, -0.1);
    this.bulb = add(new THREE.SphereGeometry(0.035, 8, 6), m.light, 0, 0.73, -0.1);
    if (this.mega) {
      // little crown for the legendary bot
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.04, 0.12, 6), m.gold, Math.cos(a) * 0.14, 0.58, -0.05 + Math.sin(a) * 0.14);
      }
      g.scale.setScalar(1.2);
    }
    this.tray = new THREE.Group();
    this.tray.position.set(0, 0.32, -0.22);
    g.add(this.tray);
    return g;
  }

  findTarget(range = Infinity) {
    let best = null;
    let bestD = range * range;
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

  // Nearest place to unload: a Stuffer with room, or a Catapult pad.
  pickDropoff() {
    let best = null;
    let bestD = Infinity;
    for (const s of this.game.stuffers) {
      if (!s.enabled || !s.hasRoom()) continue;
      const spot = s.dropSpot;
      const d = spot.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'stuffer', target: s, spot };
      }
    }
    for (const c of this.game.machines) {
      if (c.type !== 'catapult') continue;
      const d = c.pos.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'catapult', target: c, spot: c.pos.clone() };
      }
    }
    this.dropoff = best;
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
    this.game.colliders.resolve(this.pos, RADIUS, 0.35);
    const moved = before.distanceTo(this.pos);
    this.stuck = moved < step * 0.3 ? this.stuck + dt : 0;
    if (this.stuck > 0.4) {
      this.sidestep = 0.7;
      this.stuck = 0;
    }
    return dist;
  }

  pickUp(p) {
    p.state = 'carried';
    p.claimedBy = null;
    p.mesh.removeFromParent();
    p.mesh.position.set(0, this.cargo.length * 0.35, 0);
    p.mesh.rotation.set(0, 0, 0);
    p.mesh.scale.setScalar(0.55 * p.def.scale);
    p.body.rotation.set(0, 0, 0);
    p.body.position.y = 0;
    p.stars.visible = false;
    this.tray.add(p.mesh);
    this.cargo.push(p);
    Audio.play('grab');
  }

  // Puts a carried plushie back in the world at `at`, knocked out.
  dropInWorld(p, at, koTime = 3) {
    p.mesh.removeFromParent();
    p.mesh.scale.setScalar(p.def.scale);
    p.mesh.rotation.set(0, 0, 0);
    p.pos.set(at.x, 0, at.z);
    this.game.scene.add(p.mesh);
    p.hp = 0;
    p.knockOut(koTime);
  }

  update(dt) {
    const speed = this.game.stats.robotSpeed * (this.mega ? 1.6 : 1);
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
          this.state = this.cargo.length ? 'deliver' : 'seek';
          if (this.cargo.length) this.pickDropoff();
          break;
        }
        if (this.moveTo(p.pos, speed, dt) < PICK_DIST) {
          this.target = null;
          this.pickUp(p);
          // multi-carry: grab another nearby one before leaving
          const next = this.cargo.length < this.capacity ? this.findTarget(CHAIN_RANGE) : null;
          if (next) {
            this.target = next;
            next.claimedBy = this;
          } else {
            this.state = 'deliver';
            this.pickDropoff();
          }
        }
        break;
      }
      case 'deliver': {
        if (!this.dropoff) {
          if (this.timer <= 0) {
            this.timer = 0.6;
            this.pickDropoff();
          }
          break;
        }
        const { kind, target, spot } = this.dropoff;
        if (this.moveTo(spot, speed, dt) < (kind === 'catapult' ? 0.9 : 0.35)) {
          if (this.timer > 0) break;
          this.timer = 0.4;
          if (kind === 'catapult') {
            if (!this.game.machines.includes(target)) {
              this.dropoff = null;
              break;
            }
            for (const p of this.cargo) this.dropInWorld(p, target.pos, 6);
            this.cargo = [];
          } else {
            while (this.cargo.length && target.enabled && target.tryAccept(this.cargo[this.cargo.length - 1], { silent: true })) {
              this.cargo.pop();
            }
          }
          if (this.cargo.length) this.pickDropoff(); // full or gone: try elsewhere
          else {
            this.state = 'seek';
            this.timer = 0.2;
          }
        }
        break;
      }
    }
    this.mesh.rotation.y = this.heading;
    this.mesh.position.y = Math.abs(Math.sin(performance.now() / 90)) * 0.015;
  }

  // Anything still on the tray drops back to the floor knocked out.
  dispose() {
    this.release();
    for (const p of this.cargo) this.dropInWorld(p, this.pos);
    this.cargo = [];
    this.mesh.removeFromParent();
  }
}
