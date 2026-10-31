// Fluffbot: a little vacuum robot living on a charging dock. It collects knocked-out plushies
// and delivers them to the nearest Stuffer with room, or drops them on a Catapult pad.
// The legendary Mega Fluffbot is faster and carries several plushies per trip.
import * as THREE from 'three';
import { Audio } from '../systems/Audio.js';

const RADIUS = 0.4;
const PICK_DIST = 1.0; // close enough to grab, even when the plushie lies against an obstacle
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
    const now = performance.now();
    let best = null;
    let bestD = range * range;
    for (const p of this.game.plushies.list) {
      if (p.state !== 'ko' || p.claimedBy) continue;
      if (p.pos.y > 0.3) continue; // riding a belt or lying on top of something: out of reach
      if (p.robotSkipUntil > now) continue; // recently found unreachable
      // plushies already within reach of a working robot arm are the arm's job
      if (this.game.machines.some((m) => m.type === 'arm' && Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 2.6 && m.stuffer)) continue;
      const d = p.pos.distanceToSquared(this.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // Nearest reachable place to unload: a free side of a Stuffer with room, or next to a robot arm.
  pickDropoff() {
    const nav = this.game.nav;
    const now = performance.now();
    this.badDrop ??= new Map();
    let best = null;
    let bestD = Infinity;
    const consider = (kind, target, spot) => {
      if (!nav.isFree(spot) || (this.badDrop.get(target) ?? 0) > now) return;
      const d = spot.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = { kind, target, spot };
      }
    };
    for (const s of this.game.stuffers) {
      if (!s.enabled || !s.hasRoom()) continue;
      // any side of the machine will do: robots drop plushies straight into the hopper
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        consider('stuffer', s, s.center.clone().add(new THREE.Vector3(dx * 2.3, 0, dz * 2.3)));
      }
    }
    // a robot arm next to a Stuffer: drop the plushies at its feet and let it do the rest
    for (const c of this.game.machines) {
      if (c.type !== 'arm' || !c.stuffer) continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        consider('arm', c, c.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5)));
      }
    }
    this.dropoff = best;
  }

  release() {
    if (this.target?.claimedBy === this) this.target.claimedBy = null;
    this.target = null;
  }

  // Walks to `goal` along an A* path on the nav grid, re-planning when the goal moves or progress stalls.
  // Returns the remaining (horizontal) distance to the goal, or -1 if it can't be reached.
  moveTo(goal, speed, dt) {
    const now = performance.now();
    const flat = (p) => Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const dist = flat(goal);
    if (dist < 0.05) return dist;
    if (!this.path || !this.pathGoal || Math.hypot(this.pathGoal.x - goal.x, this.pathGoal.z - goal.z) > 0.6 || now > this.replanAt) {
      this.path = this.game.nav.path(this.pos, goal);
      this.pathGoal = goal.clone();
      this.replanAt = now + 2500;
      if (!this.path) return -1;
    }
    // watchdog: no real progress for a while -> replan, then give up
    if (!this.watch || dist < this.watch.d - 0.25) this.watch = { d: dist, t: now, fails: this.watch?.fails ?? 0 };
    else if (now - this.watch.t > 2500) {
      this.watch.fails++;
      this.watch.t = now;
      this.path = null;
      if (this.watch.fails >= 3) {
        this.watch = null;
        return -1;
      }
    }
    // follow waypoints, then go straight for the goal itself
    while (this.path?.length && flat(this.path[0]) < 0.3) this.path.shift();
    const wp = this.path?.length ? this.path[0] : goal;
    _d.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
    const wd = _d.length();
    if (wd < 1e-4) return dist;
    _d.divideScalar(wd);
    const want = Math.atan2(_d.x, _d.z);
    let diff = want - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += diff * Math.min(1, dt * 10);
    // slow down while turning sharply so it doesn't scrape along walls
    const step = Math.min(wd, speed * dt * (Math.abs(diff) > 1 ? 0.4 : 1));
    this.pos.x += _d.x * step;
    this.pos.z += _d.z * step;
    this.game.colliders.resolve(this.pos, RADIUS, 0.35);
    return dist;
  }

  // Resets path following (new task).
  newTask() {
    this.path = null;
    this.watch = null;
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
        if (this.timer <= 0) {
          this.timer = 0.3;
          const p = this.findTarget();
          if (p) {
            this.target = p;
            p.claimedBy = this;
            this.state = 'fetch';
            this.newTask();
            Audio.play('robot');
            break;
          }
        }
        // nothing to do: roll back to the dock
        if (Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) > 0.3) this.moveTo(this.home, speed * 0.6, dt);
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
        const d = this.moveTo(p.pos, speed, dt);
        if (d < 0) {
          // can't get there (walled in, behind belts...): leave it for a while and do something else
          p.robotSkipUntil = performance.now() + 8000;
          this.release();
          this.newTask();
          this.state = this.cargo.length ? 'deliver' : 'seek';
          if (this.cargo.length) this.pickDropoff();
          break;
        }
        if (d < PICK_DIST) {
          this.target = null;
          this.pickUp(p);
          // multi-carry: grab another nearby one before leaving
          const next = this.cargo.length < this.capacity ? this.findTarget(CHAIN_RANGE) : null;
          this.newTask();
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
        const d = this.moveTo(spot, speed, dt);
        if (d < 0) {
          // that drop-off can't be reached: avoid it for a bit and pick another one
          this.badDrop.set(target, performance.now() + 6000);
          this.newTask();
          this.pickDropoff();
          break;
        }
        if (d < 0.6) {
          if (this.timer > 0) break;
          this.timer = 0.4;
          if (kind === 'arm') {
            if (!this.game.machines.includes(target)) {
              this.dropoff = null;
              break;
            }
            for (const p of this.cargo) this.dropInWorld(p, this.pos, 8);
            this.cargo = [];
          } else {
            while (this.cargo.length && target.enabled && target.tryAccept(this.cargo[this.cargo.length - 1], { silent: true })) {
              this.cargo.pop();
            }
          }
          this.newTask();
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
