// The Stuffer: plushies thrown into the hopper are queued, processed in parallel slots and turned into cans.
import * as THREE from 'three';
import { LAYOUT, levelValueMult } from '../data/config.js';
import { hazardTexture, signTexture } from '../world/Textures.js';
import { Audio } from '../systems/Audio.js';

const MAX_LAMPS = 6;

export class Stuffer {
  // cfg: { x, z, out: {x, z} } — out = unit direction (axis-aligned) the cans come out towards.
  // Cans drop out of the spout into the 1 m cell in front of it: put a belt there, or they hit the floor.
  constructor(game, cfg) {
    this.game = game;
    this.enabled = true;
    this.queue = [];
    this.working = [];
    this.shake = 0;
    const { w, d, h } = LAYOUT.stuffer;
    const { x, z, out } = cfg;
    this.center = new THREE.Vector3(x, 0, z);
    this.out = new THREE.Vector3(out.x, 0, out.z);
    // where robots park to unload: the side opposite the belt
    this.dropSpot = this.center.clone().addScaledVector(this.out, -(w / 2 + 0.75));
    // centre of the output cell, at belt height (a can falls to the floor if no belt is there)
    this.outPos = this.center.clone().addScaledVector(this.out, w / 2 + 0.5).setY(LAYOUT.belt.top);
    this.top = h;
    this.hopperCenter = new THREE.Vector3(x, h + 0.4, z);
    this.bounds = { minX: x - w / 2 - 0.15, maxX: x + w / 2 + 0.15, minZ: z - d / 2 - 0.15, maxZ: z + d / 2 + 0.15 };

    const shadows = game.shadows;
    this.group = new THREE.Group();
    this.group.position.copy(this.center);
    // local +x points along `out`
    this.group.rotation.y = Math.atan2(-out.z, out.x);
    game.scene.add(this.group);
    this.inner = new THREE.Group();
    this.group.add(this.inner);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5, metalness: 0.1 });
    this.bodyMat = bodyMat;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = shadows;
    this.inner.add(body);
    game.solids.push(body);
    this.body = body;

    const band = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.04, 0.35, d + 0.04),
      new THREE.MeshStandardMaterial({ map: hazardTexture(6) }),
    );
    band.position.y = 0.2;
    this.inner.add(band);

    const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.9, 0.9, 20, 1, true), metal);
    hopper.position.y = h + 0.45;
    hopper.castShadow = shadows;
    this.inner.add(hopper);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 8, 28), metal);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = h + 0.9;
    this.inner.add(rim);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), new THREE.MeshStandardMaterial({ color: 0x15121c }));
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = h + 0.02;
    this.inner.add(mouth);

    // spinning fluff-blades inside the mouth
    this.blades = new THREE.Group();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffd23f });
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.16), bladeMat);
      b.rotation.y = (i * Math.PI) / 2;
      this.blades.add(b);
    }
    this.blades.position.y = h + 0.08;
    this.inner.add(this.blades);

    // Front sign + status lamps
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: signTexture('STUFFER', '#2a2140'), toneMapped: false }),
    );
    sign.position.set(0, h - 0.5, -d / 2 - 0.01);
    sign.rotation.y = Math.PI;
    this.inner.add(sign);

    this.lamps = [];
    this.lampOff = new THREE.MeshStandardMaterial({ color: 0x444851 });
    this.lampIdle = new THREE.MeshStandardMaterial({ color: 0x5fe0b7, emissive: 0x1f8063, emissiveIntensity: 0.8 });
    this.lampBusy = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa000, emissiveIntensity: 1.2 });
    this.lampBlocked = new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0xff0000, emissiveIntensity: 1.2 });
    const lampGeo = new THREE.SphereGeometry(0.12, 12, 8);
    for (let i = 0; i < MAX_LAMPS; i++) {
      const l = new THREE.Mesh(lampGeo, this.lampOff);
      l.position.set(0.9 - i * 0.36, h - 1.1, -d / 2 - 0.05);
      this.inner.add(l);
      this.lamps.push(l);
    }

    // short chute over the output cell: cans drop out under it
    const spout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 1.0), new THREE.MeshStandardMaterial({ color: 0x3a3f47 }));
    spout.position.set(w / 2 + 0.15, LAYOUT.belt.top + 0.55, 0);
    this.group.add(spout);
    this.spoutPos = new THREE.Vector3(x + out.x * (w / 2 + 0.3), LAYOUT.belt.top + 0.5, z + out.z * (w / 2 + 0.3));

    this.collider = game.colliders.add(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h);
  }

  dispose() {
    this.group.removeFromParent();
    this.game.colliders.remove(this.collider);
    const i = this.game.solids.indexOf(this.body);
    if (i >= 0) this.game.solids.splice(i, 1);
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
    this.collider.disabled = !on;
    const i = this.game.solids.indexOf(this.body);
    if (on && i < 0) this.game.solids.push(this.body);
    if (!on && i >= 0) this.game.solids.splice(i, 1);
  }

  get load() {
    return this.queue.length + this.working.length;
  }

  hasRoom(stats = this.game.stats) {
    return this.load < this.capacity(stats);
  }

  inHopper(p) {
    const b = this.bounds;
    return p.y > this.top - 0.6 && p.y < this.top + 2.5 && p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
  }

  get busy() {
    return this.working.length;
  }

  capacity(stats) {
    return stats.slots + stats.queueSize;
  }

  tryAccept(plushie, { silent = false } = {}) {
    const stats = this.game.stats;
    if (this.queue.length + this.working.length >= this.capacity(stats)) {
      if (!silent) {
        Audio.play('reject');
        this.game.ui.toast('machineFull');
      }
      return false;
    }
    this.queue.push({ type: plushie.type, value: plushie.def.value, nugget: plushie.extractNugget() });
    this.game.plushies.remove(plushie);
    this.shake = 0.4;
    this.gulp = 1;
    this.game.particles.burst(this.hopperCenter, { count: 14, color: plushie.def.color, speed: 2.5, size: 0.08, up: 3 });
    this.game.particles.burst(this.hopperCenter, { count: 8, color: 0xffffff, speed: 2, size: 0.1, up: 3.5 });
    Audio.play('stuff');
    this.game.bus.emit('plushieStuffed', { type: plushie.type });
    return true;
  }

  update(dt) {
    if (!this.enabled) return;
    const stats = this.game.stats;
    while (this.working.length < stats.slots && this.queue.length) {
      this.working.push({ ...this.queue.shift(), t: 0 });
    }
    this.blocked = false;
    for (let i = this.working.length - 1; i >= 0; i--) {
      const job = this.working[i];
      job.t += dt;
      if (job.t >= stats.processTime) {
        // drop the can out of the spout, if the spot in front is free
        const out = this.outPos;
        if (this.game.items.isFree(out)) {
          this.working.splice(i, 1);
          // a nugget inside the plushie ends up sealed (unseen) in the can
          const can = this.game.items.spawnCan(out, this.canValue(job.value), job.type, job.nugget);
          if (stats.wrap) this.game.items.wrap(can); // Gift Wrapper upgrade: every can comes out wrapped
          // with no belt below, the can tumbles out onto the floor in front of the machine
          if (!this.game.beltNet.under(out)) can.vel.set(this.out.x * 1.5 + (Math.random() - 0.5), 0, this.out.z * 1.5 + (Math.random() - 0.5));
          this.game.particles.burst(this.spoutPos, { count: 6, color: 0xffffff, speed: 1.2, size: 0.07, up: 1.5 });
        } else {
          this.blocked = true;
        }
      }
    }

    // animation
    const active = this.working.length > 0 && !this.blocked;
    this.blades.rotation.y += dt * (active ? 14 : 1.5);
    this.shake = Math.max(0, this.shake - dt);
    // "gulp": the whole machine squashes and bulges when it swallows a plushie
    this.gulp = Math.max(0, (this.gulp ?? 0) - dt * 3);
    const g = Math.sin(this.gulp * Math.PI) * 0.12;
    this.inner.scale.set(1 + g, 1 - g * 0.8, 1 + g);
    // gentle "breathing" while working
    if (active) this.inner.scale.y *= 1 + Math.sin(performance.now() / 110) * 0.015;
    const amp = (active ? 0.025 : 0) + this.shake * 0.12;
    this.inner.position.set((Math.random() - 0.5) * amp, 0, (Math.random() - 0.5) * amp);
    const blink = Math.sin(performance.now() / 120) > 0;
    for (let i = 0; i < MAX_LAMPS; i++) {
      const l = this.lamps[i];
      l.visible = i < stats.slots;
      if (i < this.working.length) {
        const done = this.working[i].t >= stats.processTime;
        l.material = done ? this.lampBlocked : blink ? this.lampBusy : this.lampIdle;
      } else l.material = this.lampIdle;
    }
  }

  canValue(base) {
    return Math.round(base * this.game.stats.valueMult * levelValueMult(this.game.level));
  }

  // All queued and in-progress plushies are finished instantly. Returns total value.
  flush() {
    let total = 0;
    for (const j of [...this.queue, ...this.working]) total += this.canValue(j.value);
    this.queue.length = 0;
    this.working.length = 0;
    return total;
  }

  reset() {
    this.queue.length = 0;
    this.working.length = 0;
  }
}
