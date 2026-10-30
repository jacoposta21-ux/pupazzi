// Plushie behaviour (wander / flee / knocked out / carried / thrown) and the manager that owns them all.
import * as THREE from 'three';
import { PLUSHIES, plushieHp, GRAVITY, LAYOUT } from '../data/config.js';
import { buildPlushie } from './PlushieModel.js';
import { Audio } from '../systems/Audio.js';

const B = { minX: LAYOUT.floor.minX + 0.6, maxX: LAYOUT.floor.maxX - 0.6, minZ: LAYOUT.floor.minZ + 0.6, maxZ: LAYOUT.floor.maxZ - 0.6 };
const FLEE_RADIUS = 5.5;
const CALM_RADIUS = 9;
const KO_TIME = 10;
const _dir = new THREE.Vector3();
const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const rand = (a, b) => a + Math.random() * (b - a);

let lastSqueak = 0;

export class Plushie {
  constructor(type, day, shadows) {
    this.type = type;
    this.def = PLUSHIES[type];
    this.maxHp = plushieHp(type, day);
    this.hp = this.maxHp;
    const model = buildPlushie(this.def, shadows);
    this.mesh = model.root;
    this.body = model.body;
    this.eyes = model.eyes;
    this.stars = model.stars;
    this.helmet = model.helmet;
    this.armor = this.def.armor ?? 0;
    this.mesh.userData.plushie = this;
    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    this.radius = 0.36 * this.def.scale;
    this.state = 'idle';
    this.timer = rand(0.2, 1.5);
    this.target = new THREE.Vector3();
    this.heading = Math.random() * Math.PI * 2;
    this.anim = Math.random() * 10;
    this.squash = 0;
    this.moving = 0;
    this.koTimer = 0;
    this.rejectCooldown = 0;
    this.lying = 0;
  }

  get grabbable() {
    return this.state === 'idle' || this.state === 'wander' || this.state === 'flee' || this.state === 'ko' || this.state === 'dazed';
  }

  get isKO() {
    return this.state === 'ko';
  }

  startHop(from, to, duration = 1.1) {
    this.state = 'hop';
    this.hopFrom = from.clone();
    this.hopTo = to.clone();
    this.hopT = 0;
    this.hopDur = duration;
    this.pos.copy(from);
    this.heading = Math.atan2(to.x - from.x, to.z - from.z);
  }

  // Returns 'ko', 'hit', 'armor' (helmet absorbed it), 'armorBreak' or 'none'.
  takeHit(dmg, fromPos) {
    this.squash = 1;
    if (this.state === 'ko') return 'none';
    _dir.subVectors(this.pos, fromPos).setY(0).normalize();
    this.vel.addScaledVector(_dir, 2.5);
    this.state = 'flee';
    this.timer = 3;
    if (this.armor > 0) {
      this.armor -= dmg;
      if (this.armor > 0) return 'armor';
      this.armor = 0;
      if (this.helmet) this.helmet.visible = false;
      return 'armorBreak';
    }
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.knockOut();
      return 'ko';
    }
    return 'hit';
  }

  knockOut(time = KO_TIME) {
    this.state = 'ko';
    this.koTimer = time;
    this.moving = 0;
  }

  wakeUp() {
    this.hp = this.maxHp;
    this.state = 'flee';
    this.timer = 2;
  }

  pickNewTarget() {
    this.target.set(rand(-15, 15), 0, rand(-12, 21));
  }

  update(dt, ctx) {
    this.anim += dt;
    this.squash = Math.max(0, this.squash - dt * 5);
    this.rejectCooldown = Math.max(0, this.rejectCooldown - dt);
    let speed = 0;

    switch (this.state) {
      case 'hop': {
        this.hopT += dt / this.hopDur;
        const t = Math.min(1, this.hopT);
        this.pos.lerpVectors(this.hopFrom, this.hopTo, t);
        this.pos.y = THREE.MathUtils.lerp(this.hopFrom.y, this.hopTo.y, t) + Math.sin(t * Math.PI) * 2.4 * Math.min(1, this.hopDur);
        this.body.rotation.x = t * Math.PI * 2;
        if (t >= 1) {
          this.body.rotation.x = 0;
          this.pos.y = 0;
          this.state = 'idle';
          this.timer = rand(0.3, 1);
          this.squash = 1;
        }
        break;
      }
      case 'idle':
      case 'wander': {
        if (ctx.player && this.distToPlayer(ctx.player) < FLEE_RADIUS) {
          this.state = 'flee';
          this.timer = 2;
          if (ctx.time - lastSqueak > 0.4) {
            lastSqueak = ctx.time;
            Audio.play('squeak');
          }
          break;
        }
        this.timer -= dt;
        if (this.state === 'idle') {
          if (this.timer <= 0) {
            this.state = 'wander';
            this.pickNewTarget();
            this.timer = rand(4, 8);
          }
        } else {
          _dir.subVectors(this.target, this.pos).setY(0);
          if (_dir.lengthSq() < 0.5 || this.timer <= 0) {
            this.state = 'idle';
            this.timer = rand(0.5, 2.5);
          } else {
            speed = this.def.walk;
            this.steer(_dir.normalize(), speed, dt);
          }
        }
        break;
      }
      case 'flee': {
        if (!ctx.player) {
          this.state = 'idle';
          break;
        }
        const d = this.distToPlayer(ctx.player);
        this.timer -= dt;
        if (d > CALM_RADIUS && this.timer <= 0) {
          this.state = 'idle';
          this.timer = rand(0.5, 1.5);
          break;
        }
        _dir.subVectors(this.pos, ctx.player.pos).setY(0).normalize();
        // wobble + steer away from walls so they don't just hug a corner
        const wob = Math.sin(this.anim * 3 + this.heading) * 0.35;
        _dir.x += -_dir.z * wob;
        _dir.z += _dir.x * wob;
        const margin = 3;
        const push = (v, lo, hi) => (v - lo < margin ? (margin - (v - lo)) / margin : v > hi - margin ? -(margin - (hi - v)) / margin : 0);
        _dir.x += push(this.pos.x, B.minX, B.maxX) * 1.6;
        _dir.z += push(this.pos.z, B.minZ, B.maxZ) * 1.6;
        speed = this.def.flee;
        this.steer(_dir.normalize(), speed, dt);
        break;
      }
      case 'ko':
        this.koTimer -= dt;
        if (this.koTimer <= 0) this.wakeUp();
        break;
      case 'dazed':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'flee';
          this.timer = 1;
        }
        break;
      case 'thrown':
        this.updateThrown(dt, ctx);
        break;
    }

    if (this.state !== 'thrown' && this.state !== 'hop' && this.state !== 'carried') {
      // knockback / slide
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
      this.pos.y = 0;
      ctx.colliders.resolve(this.pos, this.radius, 0);
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, B.minX, B.maxX);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, B.minZ, B.maxZ);
    }

    this.moving = THREE.MathUtils.lerp(this.moving, speed > 0 ? 1 : 0, Math.min(1, dt * 8));
    this.animate(dt, speed);
    if (this.def.golden && ctx.particles && Math.random() < dt * 4) {
      _dir.set(this.pos.x + rand(-0.3, 0.3), this.pos.y + rand(0.3, 1.1), this.pos.z + rand(-0.3, 0.3));
      ctx.particles.burst(_dir, { count: 1, color: 0xfff2a0, speed: 0.4, size: 0.04, up: 0.6, gravity: 0, life: 0.6 });
    }
  }

  steer(dir, speed, dt) {
    this.heading = lerpAngle(this.heading, Math.atan2(dir.x, dir.z), Math.min(1, dt * 8));
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
  }

  distToPlayer(player) {
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  throwFrom(pos, vel) {
    this.state = 'thrown';
    this.pos.copy(pos);
    this.vel.copy(vel);
  }

  updateThrown(dt, ctx) {
    this.vel.y -= GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.body.rotation.x += dt * 9;

    const stuffer = this.rejectCooldown <= 0 && ctx.stuffers.find((s) => s.enabled && s.inHopper(this.pos));
    if (stuffer) {
      if (stuffer.tryAccept(this)) return;
      // machine full: spit it back out
      this.rejectCooldown = 1;
      this.pos.y = stuffer.top + 0.6;
      this.vel.set(rand(-1, 1), 7, 4);
      return;
    }

    const before = this.pos.clone();
    if (ctx.colliders.resolve(this.pos, this.radius, this.pos.y)) {
      // bounce off walls / machines
      if (Math.abs(before.x - this.pos.x) > 1e-4) this.vel.x *= -0.4;
      if (Math.abs(before.z - this.pos.z) > 1e-4) this.vel.z *= -0.4;
    }
    const ground = ctx.colliders.groundHeight(this.pos, this.radius, this.pos.y + 0.05);
    if (this.pos.y <= ground) {
      this.pos.y = 0;
      this.vel.set(this.vel.x * 0.3, 0, this.vel.z * 0.3);
      this.body.rotation.x = 0;
      this.squash = 1;
      if (this.hp <= 0) this.knockOut(4);
      else {
        this.state = 'dazed';
        this.timer = 1.2;
      }
    }
  }

  animate(dt, speed) {
    const lyingTarget = this.state === 'ko' ? 1 : 0;
    this.lying = THREE.MathUtils.lerp(this.lying, lyingTarget, Math.min(1, dt * 10));
    this.mesh.rotation.y = this.heading;

    if (this.state !== 'thrown' && this.state !== 'hop') {
      const w = this.anim * (6 + speed * 3);
      this.body.rotation.x = -this.lying * Math.PI * 0.5;
      this.body.rotation.z = Math.sin(w) * 0.16 * this.moving;
      this.body.position.y = Math.abs(Math.sin(w)) * 0.08 * this.moving + this.lying * 0.3;
    }
    const s = this.squash;
    this.body.scale.set(1 + s * 0.2, 1 - s * 0.25, 1 + s * 0.2);

    const eyeY = this.state === 'ko' || this.state === 'dazed' ? 0.15 : 1;
    for (const e of this.eyes) e.scale.y = THREE.MathUtils.lerp(e.scale.y, 0.05 * eyeY, Math.min(1, dt * 15));

    this.stars.visible = this.state === 'ko' || this.state === 'dazed';
    if (this.stars.visible) {
      this.stars.rotation.y += dt * 4;
      this.stars.position.set(0, this.state === 'ko' ? 0.55 : 1.3, this.state === 'ko' ? -0.75 : 0);
    }
  }
}

export class PlushieManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  get count() {
    return this.list.length;
  }

  spawn(type, day) {
    const p = new Plushie(type, day, this.game.shadows);
    this.list.push(p);
    this.game.scene.add(p.mesh);
    return p;
  }

  spawnWandering(type, day) {
    const p = this.spawn(type, day);
    p.pos.set(rand(-14, 14), 0, rand(-2, 20));
    if (this.game.colliders.pointInside(p.pos.x, p.pos.z)) p.pos.set(rand(-4, 4), 0, rand(8, 16));
    return p;
  }

  // Matryoshka: replace a knocked-out mama with a handful of minis that pop out and run.
  split(p, day) {
    const { splitsInto, splitCount } = p.def;
    const from = p.pos.clone().setY(0.6);
    this.remove(p);
    for (let i = 0; i < splitCount; i++) {
      const mini = this.spawn(splitsInto, day);
      const a = (i / splitCount) * Math.PI * 2 + Math.random();
      const to = new THREE.Vector3(from.x + Math.cos(a) * 1.8, 0, from.z + Math.sin(a) * 1.8);
      if (this.game.colliders.pointInside(to.x, to.z)) to.set(from.x, 0, from.z);
      to.x = THREE.MathUtils.clamp(to.x, B.minX, B.maxX);
      to.z = THREE.MathUtils.clamp(to.z, B.minZ, B.maxZ);
      mini.startHop(from, to, 0.6);
    }
  }

  remove(p) {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    p.mesh.removeFromParent();
    p.state = 'gone';
  }

  clear() {
    for (const p of [...this.list]) this.remove(p);
  }

  hitTargets() {
    const out = [];
    for (const p of this.list) if (p.state !== 'carried' && p.state !== 'gone') out.push(p.mesh);
    return out;
  }

  update(dt, ctx) {
    for (const p of this.list) if (p.state !== 'carried') p.update(dt, ctx);

    // soft separation between grounded plushies
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.state === 'carried' || a.state === 'thrown' || a.state === 'hop') continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.state === 'carried' || b.state === 'thrown' || b.state === 'hop') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const r = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (r - d) * 0.5;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
    }
  }
}
