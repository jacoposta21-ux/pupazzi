// First-person worker: movement, foam blaster, grabbing and throwing plushies.
import * as THREE from 'three';
import { GRAVITY, LAYOUT } from '../data/config.js';
import { Audio } from '../systems/Audio.js';

const EYE = 1.6;
const RADIUS = 0.4;
const JUMP_V = 6.5;
const GRAB_RANGE = 3.2;
const THROW_ASSIST_RANGE = 10;
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
    this.ammo = 0;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.recoil = 0;
    this.bob = 0;
    this.aimed = null; // plushie under the crosshair within grab range
    this.aimingAtStuffer = false;
    this.raycaster = new THREE.Raycaster();
    this.buildViewmodel();
    this.respawn();
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

  buildViewmodel() {
    this.vm = new THREE.Group();
    this.camera.add(this.vm);

    this.gun = new THREE.Group();
    this.gun.position.set(0.24, -0.22, -0.52);
    this.gun.scale.setScalar(0.42);
    const orange = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x3f73c4, roughness: 0.5 });
    const tank = new THREE.MeshStandardMaterial({ color: 0x9df2ff, roughness: 0.2, transparent: true, opacity: 0.85 });
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      this.gun.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.14, 0.16, 0.42), orange, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.045, 0.06, 0.26, 12), blue, 0, 0.01, -0.32, Math.PI / 2);
    add(new THREE.BoxGeometry(0.08, 0.2, 0.1), blue, 0, -0.15, 0.1, 0.3);
    this.tankMesh = add(new THREE.SphereGeometry(0.09, 12, 8), tank, 0, 0.14, 0.05);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.01, -0.47);
    this.gun.add(this.muzzle);
    this.vm.add(this.gun);

    this.carryAnchor = new THREE.Group();
    this.carryAnchor.position.set(-0.42, -0.62, -1.0);
    this.vm.add(this.carryAnchor);
  }

  setViewmodelVisible(v) {
    this.vm.visible = v;
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
    const speed = stats.moveSpeed * (input.sprint ? 1.45 : 1) * (1 - 0.03 * this.carried.length);
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wx = (_fwd.x * mv.y + _right.x * mv.x) * speed;
    const wz = (_fwd.z * mv.y + _right.z * mv.x) * speed;
    const accel = this.onGround ? 14 : 4;
    const k = Math.min(1, accel * dt);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;

    if (input.jumpPressed && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      Audio.play('jump');
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);

    const colliders = this.game.colliders;
    colliders.resolve(this.pos, RADIUS, this.pos.y + 0.3);
    const ground = colliders.groundHeight(this.pos, RADIUS, this.pos.y + 0.3);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else this.onGround = this.pos.y - ground < 0.01;

    // --- Camera ---
    const moving = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && moving > 0.5) this.bob += dt * moving * 1.9;
    const bobY = Math.sin(this.bob * 2) * 0.04 * Math.min(1, moving / 5);
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
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

    this.animateViewmodel(dt, Math.sin(this.bob) * Math.min(1, moving / 5));
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
    const stats = this.game.stats;
    this.ammo--;
    this.cooldown = stats.fireCooldown;
    this.recoil = 1;
    Audio.play('shoot');

    this.raycaster.setFromCamera(CENTER, this.camera);
    this.raycaster.far = 60;
    const wall = this.worldHitDistance();
    const hits = this.raycaster.intersectObjects(this.game.plushies.hitTargets(), true);
    const from = this.muzzle.getWorldPosition(_v);
    let end;
    const hit = hits.find((h) => h.distance < wall);
    if (hit) {
      const p = this.plushieFromObject(hit.object);
      end = hit.point;
      if (p) {
        const ko = p.takeHit(stats.damage, this.pos);
        Audio.play(ko ? 'ko' : 'hit');
        this.game.ui.hitmarker(ko);
        this.game.particles.burst(hit.point, { count: ko ? 14 : 7, color: ko ? 0xffd23f : 0xffffff, speed: 2, size: 0.05 });
        if (ko) this.game.bus.emit('plushieKO', p);
      }
    } else {
      end = this.raycaster.ray.at(Math.min(wall, 60), _v2);
      if (wall < 60) this.game.particles.burst(end, { count: 4, color: 0xffffff, speed: 1.2, size: 0.04, life: 0.4 });
    }
    this.game.particles.tracer(from, end);
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
    p.state = 'carried';
    p.vel.set(0, 0, 0);
    p.mesh.removeFromParent();
    this.carryAnchor.add(p.mesh);
    p.body.rotation.set(0, 0, 0);
    p.body.position.y = 0;
    p.lying = 0;
    p.stars.visible = false;
    this.carried.push(p);
    this.layoutCarried();
    Audio.play('grab');
    this.game.particles.burst(p.pos, { count: 5, color: p.def.color, speed: 1, size: 0.05 });
  }

  layoutCarried() {
    this.carried.forEach((p, i) => {
      p.mesh.position.set(0, i * 0.3, 0);
      p.mesh.rotation.set(0, 0.35, 0);
      p.mesh.scale.setScalar(0.42 * p.def.scale);
    });
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
    this.layoutCarried();
    Audio.play('throw');
  }

  // Drop everything carried in front of the player (used when leaving to the menu, etc.).
  dropAll() {
    while (this.carried.length) {
      const p = this.carried.pop();
      p.mesh.removeFromParent();
      p.mesh.scale.setScalar(p.def.scale);
      this.game.scene.add(p.mesh);
      p.pos.set(this.pos.x + (Math.random() - 0.5), 0, this.pos.z + (Math.random() - 0.5));
      p.state = 'idle';
      p.timer = 1;
    }
  }

  animateViewmodel(dt, sway) {
    this.recoil = Math.max(0, this.recoil - dt * 8);
    const reloading = this.reloadTimer > 0 ? 1 : 0;
    this.gun.position.set(0.24 + sway * 0.012, -0.22 + Math.abs(sway) * 0.01 - reloading * 0.1, -0.52 + this.recoil * 0.05);
    this.gun.rotation.x = this.recoil * 0.25 - reloading * 0.6;
    const stats = this.game.stats;
    this.tankMesh.scale.setScalar(0.4 + 0.6 * (this.ammo / stats.magSize));
    this.carryAnchor.position.y = -0.62 - Math.abs(sway) * 0.03;
    this.carried.forEach((p, i) => {
      p.mesh.rotation.z = Math.sin(this.bob + i) * 0.08;
    });
  }
}
