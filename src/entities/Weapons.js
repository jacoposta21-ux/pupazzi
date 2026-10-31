// Weapon system: foam blaster, foam minigun, net launcher, confetti cannon, plushie vacuum, rainbow ray.
import * as THREE from 'three';
import { WEAPONS, GRAVITY } from '../data/config.js';
import { Audio } from '../systems/Audio.js';

export const WEAPON_ORDER = ['blaster', 'minigun', 'net', 'confetti', 'vacuum', 'rainbow'];
const MAGAZINE_WEAPONS = ['blaster', 'minigun', 'net', 'confetti'];
const RAINBOW = [0xff4d6d, 0xff9f1c, 0xffd23f, 0x5fe0b7, 0x3f8efc, 0x9b5de5];
const CENTER = new THREE.Vector2(0, 0);
const KO_COLORS = [0xff6b8b, 0xffd23f, 0x5fe0b7, 0x9df2ff, 0xffffff];
const CONFETTI = [0xff6b8b, 0xffd23f, 0x5fe0b7, 0x9df2ff, 0x7a4fd1, 0xff8a3d];
const NET_GRAVITY = 10;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

const netGeo = new THREE.IcosahedronGeometry(0.22, 1);
const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });

export class WeaponSystem {
  constructor(player) {
    this.player = player;
    this.game = player.game;
    this.current = 'blaster';
    this.ammo = Object.fromEntries(MAGAZINE_WEAPONS.map((id) => [id, 0]));
    this.reload = Object.fromEntries(MAGAZINE_WEAPONS.map((id) => [id, 0]));
    this.cooldown = 0;
    this.nets = [];
    this.vacuumOn = false;
    this.vacuumSound = 0;
    this.raycaster = new THREE.Raycaster();
  }

  owned(id) {
    return id === 'blaster' || !!this.game.data.unlocks?.[id];
  }

  get list() {
    return WEAPON_ORDER.filter((id) => this.owned(id));
  }

  mag(id) {
    return id === 'blaster' ? this.game.stats.magSize : WEAPONS[id].mag ?? Infinity;
  }

  reloadTime(id) {
    return id === 'blaster' ? this.game.stats.reloadTime : WEAPONS[id].reload;
  }

  get reloading() {
    return (this.reload[this.current] ?? 0) > 0;
  }

  get ammoFrac() {
    const m = this.mag(this.current);
    return m === Infinity ? 1 : this.ammo[this.current] / m;
  }

  refill() {
    for (const id of MAGAZINE_WEAPONS) {
      this.ammo[id] = this.mag(id);
      this.reload[id] = 0;
    }
    for (const n of this.nets) n.mesh.removeFromParent();
    this.nets.length = 0;
    if (!this.owned(this.current)) this.select('blaster', true);
  }

  select(id, instant = false) {
    if (!this.owned(id) || (id === this.current && !instant)) return;
    this.current = id;
    this.cooldown = instant ? 0 : 0.3;
    this.player.vm.setWeapon(id, instant);
    if (!instant) Audio.play('swap');
  }

  cycle(dir) {
    const list = this.list;
    const i = list.indexOf(this.current);
    this.select(list[(i + dir + list.length) % list.length]);
  }

  startReload(id = this.current) {
    if (this.reload[id] > 0 || this.mag(id) === Infinity || this.ammo[id] >= this.mag(id)) return;
    this.reload[id] = this.reloadTime(id);
    Audio.play('reload');
  }

  update(dt, input) {
    // switching
    const slot = input.weaponSlot;
    if (slot) this.select(WEAPON_ORDER[slot - 1]);
    if (input.wheel) this.cycle(Math.sign(input.wheel));
    if (input.swapPressed) this.cycle(1);

    this.cooldown -= dt;
    for (const id in this.reload) {
      if (this.reload[id] > 0) {
        this.reload[id] -= dt;
        if (this.reload[id] <= 0) this.ammo[id] = this.mag(id);
      }
    }

    this.vacuumOn = false;
    if (this.current === 'vacuum') {
      if (input.fire && this.cooldown <= 0) this.updateVacuum(dt);
    } else {
      if (input.reloadPressed) this.startReload();
      const infinite = this.mag(this.current) === Infinity;
      if (input.fire && this.cooldown <= 0 && !(this.reload[this.current] > 0)) {
        if (infinite || this.ammo[this.current] > 0) this.fire();
        else this.startReload();
      }
    }
    this.updateNets(dt);
  }

  aimRay() {
    const cam = this.player.camera;
    cam.rotation.x = this.player.pitch; // aim from the un-kicked view
    cam.updateMatrixWorld();
    this.raycaster.setFromCamera(CENTER, cam);
    return this.raycaster.ray;
  }

  fire() {
    const id = this.current;
    const finite = this.mag(id) !== Infinity;
    if (finite) this.ammo[id]--;
    const cfg = WEAPONS[id];
    this.cooldown = id === 'blaster' ? this.game.stats.fireCooldown : cfg.cooldown;
    const kick = { confetti: [2, 0.05], minigun: [0.35, 0.004] }[id] ?? [1, 0.012];
    this.player.vm.kickRecoil(kick[0]);
    this.player.kick = Math.min(0.08, this.player.kick + kick[1]);
    if (id === 'blaster') this.fireBlaster();
    else if (id === 'minigun') this.fireBlaster(WEAPONS.minigun);
    else if (id === 'net') this.fireNet();
    else if (id === 'confetti') this.fireConfetti();
    else if (id === 'rainbow') this.fireRainbow();
    if (finite && this.ammo[id] === 0) this.startReload(id);
  }

  // Reports a hit result with sound, particles and hitmarker. Returns true on KO.
  // quiet: from automation (turrets) — no hitmarker and softer sounds
  applyHit(p, result, point, { quiet = false } = {}) {
    const game = this.game;
    if (result === 'none') return false;
    const ko = result === 'ko';
    if (!quiet) game.ui.hitmarker(ko, result === 'armor');
    if (ko) {
      Audio.play(quiet ? 'hit' : 'ko');
      for (const c of KO_COLORS) game.particles.burst(point, { count: 4, color: c, speed: 2.5, size: 0.05, up: 2.5 });
      game.bus.emit('plushieKO', p);
    } else if (result === 'armor') {
      Audio.play('clang');
      game.particles.burst(point, { count: 6, color: 0xfff6c8, speed: 2.5, size: 0.03 });
    } else if (result === 'armorBreak') {
      Audio.play('armorBreak');
      game.particles.burst(p.pos.clone().setY(1.2 * p.def.scale), { count: 14, color: 0xb8c0cc, speed: 3, size: 0.06, up: 3 });
    } else {
      Audio.play('hit');
      game.particles.burst(point, { count: 7, color: 0xffffff, speed: 2, size: 0.05 });
    }
    return ko;
  }

  // Hitscan foam shot. cfg (minigun): fixed damage, random spread, its own sound.
  fireBlaster(cfg = null) {
    const game = this.game;
    const P = this.player;
    Audio.play(cfg ? 'minigun' : 'shoot');
    const ray = this.aimRay();
    if (cfg) {
      ray.direction.x += (Math.random() - 0.5) * 2 * cfg.spread;
      ray.direction.y += (Math.random() - 0.5) * 2 * cfg.spread;
      ray.direction.z += (Math.random() - 0.5) * 2 * cfg.spread;
      ray.direction.normalize();
    }
    this.raycaster.far = cfg ? cfg.range : 60;
    const wall = P.worldHitDistance(this.raycaster);
    const hits = this.raycaster.intersectObjects(game.plushies.hitTargets(), true);
    const from = P.vm.muzzle.getWorldPosition(_v);
    // knocked-out plushies lying around don't soak up shots
    const hit = hits.find((h) => h.distance < wall && P.plushieFromObject(h.object)?.state !== 'ko');
    let end;
    if (hit) {
      const p = P.plushieFromObject(hit.object);
      end = hit.point;
      if (p) this.applyHit(p, p.takeHit(cfg ? cfg.damage : game.stats.damage, P.pos), hit.point);
    } else {
      end = this.raycaster.ray.at(Math.min(wall, 60), _v2);
      if (wall < 60) game.particles.burst(end, { count: 4, color: 0xffffff, speed: 1.2, size: 0.04, life: 0.4 });
    }
    game.particles.tracer(from, end);
  }

  // Legendary rainbow ray: hitscan, every hit is a knockout, armour included.
  fireRainbow() {
    const game = this.game;
    const P = this.player;
    Audio.play('rainbow');
    this.aimRay();
    this.raycaster.far = WEAPONS.rainbow.range;
    const wall = P.worldHitDistance(this.raycaster);
    const hits = this.raycaster.intersectObjects(game.plushies.hitTargets(), true);
    const from = P.vm.muzzle.getWorldPosition(_v).clone();
    const hit = hits.find((h) => h.distance < wall && P.plushieFromObject(h.object)?.state !== 'ko');
    const end = hit ? hit.point.clone() : this.raycaster.ray.at(Math.min(wall, WEAPONS.rainbow.range), new THREE.Vector3());
    // rainbow streak: a few coloured particles along the beam
    for (let i = 0; i < 8; i++) {
      const pt = from.clone().lerp(end, i / 8);
      game.particles.spawn(pt, new THREE.Vector3(0, 0.5, 0), { color: RAINBOW[i % RAINBOW.length], size: 0.05, life: 0.25 });
    }
    game.particles.tracer(from, end);
    if (!hit) return;
    const p = P.plushieFromObject(hit.object);
    if (!p) return;
    p.armor = 0;
    if (p.helmet) p.helmet.visible = false;
    p.hp = 0;
    p.squash = 1;
    p.knockOut();
    this.applyHit(p, 'ko', hit.point);
  }

  fireNet() {
    const ray = this.aimRay();
    const mesh = new THREE.Mesh(netGeo, netMat);
    this.player.vm.muzzle.getWorldPosition(mesh.position);
    const vel = ray.direction.clone().multiplyScalar(WEAPONS.net.speed);
    vel.y += 2;
    this.game.scene.add(mesh);
    this.nets.push({ mesh, vel, life: 3 });
    Audio.play('net');
  }

  updateNets(dt) {
    const game = this.game;
    const cfg = WEAPONS.net;
    for (let i = this.nets.length - 1; i >= 0; i--) {
      const n = this.nets[i];
      n.life -= dt;
      n.vel.y -= NET_GRAVITY * dt;
      n.mesh.position.addScaledVector(n.vel, dt);
      n.mesh.rotation.x += dt * 8;
      n.mesh.rotation.y += dt * 5;
      n.mesh.scale.setScalar(Math.min(2.2, n.mesh.scale.x + dt * 3));
      const pos = n.mesh.position;
      let impact = n.life <= 0 || pos.y <= 0.15 || game.colliders.pointInside(pos.x, pos.z, pos.y);
      if (!impact) {
        for (const p of game.plushies.list) {
          if (!p.grabbable) continue;
          _v.copy(p.pos).setY(p.pos.y + 0.5 * p.def.scale);
          if (_v.distanceTo(pos) < 0.7 * p.def.scale + 0.2) {
            impact = true;
            break;
          }
        }
      }
      if (!impact) continue;
      // Wrap everything nearby: instant knock-out, armour or not.
      let caught = 0;
      for (const p of [...game.plushies.list]) {
        if (!p.grabbable || p.state === 'ko') continue;
        const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z;
        if (dx * dx + dz * dz > cfg.radius * cfg.radius || pos.y - p.pos.y > 2.5) continue;
        p.hp = 0;
        p.squash = 1;
        p.knockOut(cfg.koTime);
        caught++;
        this.applyHit(p, 'ko', p.pos.clone().setY(0.6));
      }
      game.particles.burst(pos, { count: 16, color: 0xffffff, speed: 2.5, size: 0.04, up: 1 });
      Audio.play(caught ? 'netHit' : 'netMiss');
      n.mesh.removeFromParent();
      this.nets.splice(i, 1);
    }
  }

  fireConfetti() {
    const game = this.game;
    const P = this.player;
    const cfg = WEAPONS.confetti;
    const aim = this.aimRay();
    // copy: the raycaster is reused below for wall checks
    const ray = { origin: aim.origin.clone(), direction: aim.direction.clone() };
    const origin = ray.origin;
    const cosCone = Math.cos(cfg.cone);
    Audio.play('confetti');

    // confetti spray along the cone
    const from = P.vm.muzzle.getWorldPosition(_v2).clone();
    for (let i = 0; i < 60; i++) {
      _dir.copy(ray.direction);
      _dir.x += (Math.random() - 0.5) * cfg.cone * 1.6;
      _dir.y += (Math.random() - 0.3) * cfg.cone * 1.2;
      _dir.z += (Math.random() - 0.5) * cfg.cone * 1.6;
      _dir.normalize().multiplyScalar(6 + Math.random() * 9);
      game.particles.spawn(from, _dir, {
        color: CONFETTI[i % CONFETTI.length],
        size: 0.035 + Math.random() * 0.03,
        life: 0.5 + Math.random() * 0.5,
        gravity: 9,
      });
    }

    for (const p of [...game.plushies.list]) {
      if (!p.grabbable || p.state === 'ko') continue;
      _v.copy(p.pos).setY(p.pos.y + 0.5 * p.def.scale).sub(origin);
      const d = _v.length();
      if (d > cfg.range || _v.normalize().dot(ray.direction) < cosCone) continue;
      // walls block the blast
      this.raycaster.set(origin, _v);
      this.raycaster.far = d;
      if (this.raycaster.intersectObjects(game.solids, false).length) continue;
      const point = p.pos.clone().setY(0.6 * p.def.scale);
      this.applyHit(p, p.takeHit(cfg.damage, P.pos), point);
    }
  }

  updateVacuum(dt) {
    const game = this.game;
    const P = this.player;
    const cfg = WEAPONS.vacuum;
    this.vacuumOn = true;
    const ray = this.aimRay();
    const cosCone = Math.cos(cfg.cone);
    const nozzle = P.vm.muzzle.getWorldPosition(_v2).clone();

    this.vacuumSound -= dt;
    if (this.vacuumSound <= 0) {
      this.vacuumSound = 0.14;
      Audio.play('vacuum');
    }
    // dust stream flowing into the nozzle
    if (Math.random() < dt * 30) {
      _dir.copy(ray.direction);
      _dir.x += (Math.random() - 0.5) * cfg.cone * 2;
      _dir.y += (Math.random() - 0.5) * cfg.cone;
      _dir.z += (Math.random() - 0.5) * cfg.cone * 2;
      const start = ray.origin.clone().addScaledVector(_dir.normalize(), 2 + Math.random() * 4);
      const vel = nozzle.clone().sub(start).divideScalar(0.35);
      game.particles.spawn(start, vel, { color: 0xdfe8ff, size: 0.03, life: 0.33 });
    }

    for (const p of [...game.plushies.list]) {
      if (p.state !== 'ko' && p.state !== 'dazed') continue;
      _v.copy(p.pos).sub(ray.origin);
      const d = _v.length();
      if (d > cfg.range) continue;
      if (_v.clone().normalize().dot(ray.direction) < cosCone && d > 2) continue;
      _dir.subVectors(P.pos, p.pos).setY(0);
      const flat = _dir.length();
      if (flat < cfg.grabDist) {
        if (!P.grabPlushie(p)) {
          this.game.ui.toast('handsFull');
          return;
        }
        continue;
      }
      p.claimedBy = null;
      p.pos.addScaledVector(_dir.normalize(), Math.min(flat, cfg.pull * dt));
      p.squash = Math.max(p.squash, 0.4);
    }
  }
}
