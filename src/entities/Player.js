// First-person worker: movement, foam blaster, grabbing and throwing plushies.
import * as THREE from 'three';
import { GRAVITY, LAYOUT } from '../data/config.js';
import { Audio } from '../systems/Audio.js';
import { Viewmodel } from './Viewmodel.js';
import { WeaponSystem } from './Weapons.js';

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
    this.bob = 0;
    this.lastStep = 0;
    this.kick = 0; // visual camera recoil
    this.dip = 0; // landing dip
    this.aimed = null; // plushie under the crosshair within grab range
    this.aimingAtStuffer = false;
    this.raycaster = new THREE.Raycaster();
    this.vm = new Viewmodel(this.camera);
    this.weapons = new WeaponSystem(this);
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
    this.weapons.refill();
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

    const build = this.game.build;
    if (build.active) {
      // Build mode: hands are busy with the placement tablet
      this.aimed = null;
      this.aimingAtStuffer = false;
      this.atTerminal = false;
      build.update(dt, input);
    } else {
      // --- Weapons ---
      this.weapons.update(dt, input);

      // --- Aim / grab / throw / terminal ---
      this.updateAim();
      if (input.grabPressed) {
        if (this.atTerminal && !this.aimed) this.game.openShop();
        else this.tryGrab();
      }
      if (input.throwPressed) this.throwOne();
      if (input.buildPressed) build.toggle();
    }

    this.vm.update({
      dt,
      bob: this.bob,
      moving,
      lookDX: dx,
      lookDY: dy,
      sprinting: sprinting && moving > 0.5,
      reloading: this.weapons.reloading,
      ammoFrac: this.weapons.ammoFrac,
      vacuumOn: this.weapons.vacuumOn,
      netLoaded: this.weapons.ammo.net > 0 && this.weapons.reload.net <= 0,
      carried: this.carried,
    });
  }

  // Ray from the screen centre against the static world; returns the nearest distance.
  worldHitDistance(raycaster = this.raycaster) {
    const hits = raycaster.intersectObjects(this.game.solids, false);
    return hits.length ? hits[0].distance : Infinity;
  }

  plushieFromObject(obj) {
    while (obj && !obj.userData.plushie) obj = obj.parent;
    return obj?.userData.plushie ?? null;
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
    // loose cans can be picked up too
    if (!this.aimed) {
      const hit = this.raycaster.intersectObjects(this.game.items.meshes(), false)[0];
      if (hit && hit.distance < GRAB_RANGE + 1.2) this.aimed = hit.object.userData.item;
    }
    if (!this.aimed) {
      const fwd = this.forward.setY(0).normalize();
      let best = 2;
      for (const c of this.game.items.list) {
        if (c.state !== 'loose') continue;
        _v.subVectors(c.pos, this.pos).setY(0);
        const d = _v.length();
        if (d < best && _v.normalize().dot(fwd) > 0.5) {
          best = d;
          this.aimed = c;
        }
      }
    }
    this.aimingAtStuffer = this.carried.length > 0 && this.throwAssist() !== null;
    // the shop terminal: close and roughly in front
    const T = this.game.terminalPos;
    _v.subVectors(T, this.pos).setY(0);
    const dist = _v.length();
    this.atTerminal = dist < 2.8 && this.forward.setY(0).normalize().dot(_v.normalize()) > 0.6;
  }

  tryGrab() {
    const p = this.aimed;
    if (!p) return;
    const ok = p.kind === 'can' ? this.grabCan(p) : this.grabPlushie(p);
    if (!ok) {
      this.game.ui.toast('handsFull');
      Audio.play('empty');
    }
  }

  grabCan(c) {
    if (this.carried.length >= this.game.stats.carry) return false;
    c.state = 'carried';
    c.mesh.removeFromParent();
    this.carryAnchor.add(c.mesh);
    this.carried.push(c);
    this.vm.layoutCarried(this.carried);
    this.vm.playGrab();
    Audio.play('can');
    return true;
  }

  // Puts a plushie in the left hand. Returns false when hands are full.
  grabPlushie(p) {
    if (this.carried.length >= this.game.stats.carry) return false;
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
    return true;
  }

  // Ballistic velocity towards the right target for what's in hand — a Stuffer hopper for plushies,
  // the shipping chute for cans — or null if no target is roughly ahead.
  throwAssist(fromPos) {
    const from = fromPos ?? this.camera.position;
    const fwd = this.forward;
    const top = this.carried[this.carried.length - 1];
    let targets;
    if (top?.kind !== 'can') targets = this.game.stuffers.filter((s) => s.enabled).map((s) => s.hopperCenter);
    else {
      // cans go to shipping; a can known to hide a nugget goes to an extractor instead, if there is one
      const ex = top.revealed && top.nugget ? this.game.machines.filter((m) => m.type === 'extractor').map((m) => m.pos.clone().setY(1.8)) : [];
      targets = ex.length ? ex : [this.game.items.chuteCenter];
    }
    let best = null;
    let bestDot = 0.82;
    for (const t of targets) {
      _v.subVectors(t, from);
      if (Math.hypot(_v.x, _v.z) > THROW_ASSIST_RANGE) continue;
      const dot = fwd.dot(_v2.copy(_v).normalize());
      if (dot > bestDot) {
        bestDot = dot;
        best = t;
      }
    }
    if (!best) return null;
    _v.subVectors(best, from);
    const flat = Math.hypot(_v.x, _v.z);
    const T = THREE.MathUtils.clamp(flat / 8, 0.35, 1.0);
    return new THREE.Vector3(_v.x / T, _v.y / T + 0.5 * GRAVITY * T, _v.z / T);
  }

  throwOne() {
    const p = this.carried.pop();
    if (!p) return;
    const fwd = this.forward;
    const start = this.camera.position.clone().addScaledVector(fwd, 0.7);
    start.y -= 0.25;
    this.carried.push(p); // throwAssist looks at what's on top
    const vel = this.throwAssist(start) ?? fwd.clone().multiplyScalar(11).add(new THREE.Vector3(0, 2.5, 0));
    this.carried.pop();
    vel.x += this.vel.x * 0.5;
    vel.z += this.vel.z * 0.5;
    p.mesh.visible = true;
    if (p.kind === 'can') {
      this.game.items.throwCan(p, start, vel);
      this.vm.layoutCarried(this.carried);
      this.vm.playThrow();
      Audio.play('throw');
      return;
    }
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
      p.mesh.visible = true;
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
