// First-person worker: movement, foam blaster, grabbing and throwing plushies.
import * as THREE from 'three';
import { GRAVITY, LAYOUT } from '../data/config.js';
import { Audio } from '../systems/Audio.js';
import { Viewmodel } from './Viewmodel.js';

const EYE = 1.6;
const RADIUS = 0.4;
const JUMP_V = 6.5;
const GRAB_RANGE = 3.2;
const THROW_ASSIST_RANGE = 10;
const BASE_FOV = 74;
const SPRINT_FOV = 82;
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const CENTER = new THREE.Vector2(0, 0);
const KO_COLORS = [0xff6b8b, 0xffd23f, 0x5fe0b7, 0x9df2ff, 0xffffff];

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.carried = [];
    this.ammo = 0;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.bob = 0;
    this.lastStep = 0;
    this.kick = 0; // visual camera recoil
    this.dip = 0; // landing dip
    this.aimed = null; // plushie under the crosshair within grab range
    this.aimingAtStuffer = false;
    this.raycaster = new THREE.Raycaster();
    this.vm = new Viewmodel(this.camera);
    this.respawn();
  }

  get carryAnchor() {
    return this.vm.carryAnchor;
  }

  respawn() {
    const s = LAYOUT.playerSpawn;
    this.pos.set(s.x, 0, s.z);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.1;
  }

  refill() {
    this.ammo = this.game.stats.magSize;
    this.reloadTimer = 0;
  }

  setViewmodelVisible(v) {
    this.vm.root.visible = v;
  }

  get forward() {
    return this.camera.getWorldDirection(_fwd);
  }

  update(dt, input) {
    const stats = this.game.stats;
    const sens = this.game.settings.sens * (this.game.isTouch ? 0.0016 : 0.0022);

    // --- Look ---
    const { dx, dy } = input.consumeLook();
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.45, 1.45);

    // --- Move ---
    const mv = input.move;
    const len = Math.hypot(mv.x, mv.y);
    if (len > 1) {
      mv.x /= len;
      mv.y /= len;
    }
    const sprinting = input.sprint && mv.y > 0.3;
    const speed = stats.moveSpeed * (sprinting ? 1.45 : 1) * (1 - 0.03 * this.carried.length);
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wx = (_fwd.x * mv.y + _right.x * mv.x) * speed;
    const wz = (_fwd.z * mv.y + _right.z * mv.x) * speed;
    const k = Math.min(1, (this.onGround ? 14 : 4) * dt);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;

    if (input.jumpPressed && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      Audio.play('jump');
    }
    const fallSpeed = -this.vel.y;
    this.vel.y -= GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);

    const colliders = this.game.colliders;
    colliders.resolve(this.pos, RADIUS, this.pos.y + 0.3);
    const ground = colliders.groundHeight(this.pos, RADIUS, this.pos.y + 0.3);
    const wasGround = this.onGround;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
      if (!wasGround && fallSpeed > 3) {
        this.dip = Math.min(0.12, fallSpeed * 0.012);
        Audio.play('land');
      }
    } else this.onGround = this.pos.y - ground < 0.01;

    // --- Camera ---
    const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 5);
    if (this.onGround && moving > 0.1) {
      this.bob += dt * moving * (sprinting ? 12 : 9.5);
      const stepIdx = Math.floor(this.bob / Math.PI);
      if (stepIdx !== this.lastStep) {
        this.lastStep = stepIdx;
        Audio.play('step');
      }
    }
    this.kick = Math.max(0, this.kick - dt * 0.25);
    this.dip = Math.max(0, this.dip - dt * 0.4);
    const bobY = Math.abs(Math.sin(this.bob)) * 0.045 * moving;
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY - this.dip, this.pos.z);
    this.camera.rotation.set(this.pitch + this.kick, this.yaw, Math.sin(this.bob) * 0.006 * moving);
    const fov = sprinting && moving > 0.5 ? SPRINT_FOV : BASE_FOV;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    // --- Blaster ---
    this.cooldown -= dt;
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.ammo = stats.magSize;
    }
    if (input.reloadPressed) this.startReload();
    if (input.fire && this.cooldown <= 0 && this.reloadTimer <= 0) {
      if (this.ammo > 0) this.shoot();
      else this.startReload();
    }

    // --- Aim / grab / throw ---
    this.updateAim();
    if (input.grabPressed) this.tryGrab();
    if (input.throwPressed) this.throwOne();

    this.vm.update({
      dt,
      bob: this.bob,
      moving,
      lookDX: dx,
      lookDY: dy,
      sprinting: sprinting && moving > 0.5,
      reloading: this.reloadTimer > 0,
      ammoFrac: this.ammo / stats.magSize,
      carried: this.carried,
    });
  }

  startReload() {
    const stats = this.game.stats;
    if (this.reloadTimer > 0 || this.ammo >= stats.magSize) return;
    this.reloadTimer = stats.reloadTime;
    Audio.play('reload');
  }

  // Ray from the screen centre against the static world; returns the nearest distance.
  worldHitDistance() {
    const hits = this.raycaster.intersectObjects(this.game.solids, false);
    return hits.length ? hits[0].distance : Infinity;
  }

  plushieFromObject(obj) {
    while (obj && !obj.userData.plushie) obj = obj.parent;
    return obj?.userData.plushie ?? null;
  }

  shoot() {
    const game = this.game;
    const stats = game.stats;
    this.ammo--;
    this.cooldown = stats.fireCooldown;
    this.vm.kickRecoil();
    this.kick = Math.min(0.05, this.kick + 0.012);
    Audio.play('shoot');

    // aim from the true (un-kicked) view direction
    this.camera.rotation.x = this.pitch;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(CENTER, this.camera);
    this.raycaster.far = 60;
    const wall = this.worldHitDistance();
    const hits = this.raycaster.intersectObjects(game.plushies.hitTargets(), true);
    const from = this.vm.muzzle.getWorldPosition(_v);
    let end;
    // knocked-out plushies lying around don't soak up shots
    const hit = hits.find((h) => h.distance < wall && this.plushieFromObject(h.object)?.state !== 'ko');
    if (hit) {
      const p = this.plushieFromObject(hit.object);
      end = hit.point;
      if (p) {
        const result = p.takeHit(stats.damage, this.pos);
        const ko = result === 'ko';
        if (result !== 'none') game.ui.hitmarker(ko, result === 'armor');
        if (ko) {
          Audio.play('ko');
          for (const c of KO_COLORS) game.particles.burst(hit.point, { count: 4, color: c, speed: 2.5, size: 0.05, up: 2.5 });
          game.bus.emit('plushieKO', p);
        } else if (result === 'armor') {
          Audio.play('clang');
          game.particles.burst(hit.point, { count: 6, color: 0xfff6c8, speed: 2.5, size: 0.03 });
        } else if (result === 'armorBreak') {
          Audio.play('armorBreak');
          game.particles.burst(p.pos.clone().setY(1.2 * p.def.scale), { count: 14, color: 0xb8c0cc, speed: 3, size: 0.06, up: 3 });
        } else if (result === 'hit') {
          Audio.play('hit');
          game.particles.burst(hit.point, { count: 7, color: 0xffffff, speed: 2, size: 0.05 });
        }
      }
    } else {
      end = this.raycaster.ray.at(Math.min(wall, 60), _v2);
      if (wall < 60) game.particles.burst(end, { count: 4, color: 0xffffff, speed: 1.2, size: 0.04, life: 0.4 });
    }
    game.particles.tracer(from, end);
    if (this.ammo === 0) this.startReload();
  }

  updateAim() {
    this.aimed = null;
    this.raycaster.setFromCamera(CENTER, this.camera);
    this.raycaster.far = GRAB_RANGE + 1.6;
    const hits = this.raycaster.intersectObjects(this.game.plushies.hitTargets(), true);
    for (const h of hits) {
      const p = this.plushieFromObject(h.object);
      if (p?.grabbable && p.distToPlayer(this) < GRAB_RANGE) {
        this.aimed = p;
        break;
      }
    }
    // Forgiving fallback: nearest grabbable plushie right in front of us.
    if (!this.aimed) {
      const fwd = this.forward.setY(0).normalize();
      let best = 2.2;
      for (const p of this.game.plushies.list) {
        if (!p.grabbable) continue;
        const d = p.distToPlayer(this);
        if (d >= best) continue;
        _v.subVectors(p.pos, this.pos).setY(0).normalize();
        if (_v.dot(fwd) > 0.5) {
          best = d;
          this.aimed = p;
        }
      }
    }
    this.aimingAtStuffer = this.carried.length > 0 && this.stufferAssist() !== null;
  }

  tryGrab() {
    const p = this.aimed;
    if (!p) return;
    if (this.carried.length >= this.game.stats.carry) {
      this.game.ui.toast('handsFull');
      Audio.play('empty');
      return;
    }
    this.game.particles.burst(p.pos.clone().setY(0.5), { count: 5, color: p.def.color, speed: 1, size: 0.05 });
    p.state = 'carried';
    p.claimedBy = null;
    p.vel.set(0, 0, 0);
    p.mesh.removeFromParent();
    this.carryAnchor.add(p.mesh);
    p.body.rotation.set(0, 0, 0);
    p.body.position.y = 0;
    p.lying = 0;
    p.stars.visible = false;
    this.carried.push(p);
    this.vm.layoutCarried(this.carried);
    this.vm.playGrab();
    Audio.play('grab');
  }

  // Ballistic velocity that lands in the hopper, or null if the Stuffer isn't roughly ahead.
  stufferAssist(fromPos) {
    const target = this.game.stuffer.hopperCenter;
    const from = fromPos ?? this.camera.position;
    _v.subVectors(target, from);
    const flat = Math.hypot(_v.x, _v.z);
    if (flat > THROW_ASSIST_RANGE) return null;
    const fwd = this.forward;
    _v2.copy(_v).normalize();
    if (fwd.dot(_v2) < 0.82) return null;
    const T = THREE.MathUtils.clamp(flat / 8, 0.35, 1.0);
    return new THREE.Vector3(_v.x / T, _v.y / T + 0.5 * GRAVITY * T, _v.z / T);
  }

  throwOne() {
    const p = this.carried.pop();
    if (!p) return;
    const fwd = this.forward;
    const start = this.camera.position.clone().addScaledVector(fwd, 0.7);
    start.y -= 0.25;
    const vel = this.stufferAssist(start) ?? fwd.clone().multiplyScalar(11).add(new THREE.Vector3(0, 2.5, 0));
    vel.x += this.vel.x * 0.5;
    vel.z += this.vel.z * 0.5;
    p.mesh.removeFromParent();
    p.mesh.scale.setScalar(p.def.scale);
    p.mesh.rotation.set(0, this.yaw, 0);
    p.heading = this.yaw + Math.PI;
    this.game.scene.add(p.mesh);
    p.throwFrom(start, vel);
    this.vm.layoutCarried(this.carried);
    this.vm.playThrow();
    Audio.play('throw');
  }

  // Drop everything carried in front of the player (end of day, back to menu...).
  dropAll() {
    while (this.carried.length) {
      const p = this.carried.pop();
      p.mesh.removeFromParent();
      p.mesh.scale.setScalar(p.def.scale);
      p.mesh.rotation.set(0, 0, 0);
      this.game.scene.add(p.mesh);
      p.pos.set(this.pos.x + (Math.random() - 0.5), 0, this.pos.z + (Math.random() - 0.5));
      p.state = 'idle';
      p.timer = 1;
    }
  }
}
