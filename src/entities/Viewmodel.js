// First-person viewmodel: gloved hands, the foam blaster and the plushie stack held in the left hand.
// Everything is in camera space (metres): x right, y up, -z forward.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const GUN_POS = v(0.19, -0.2, -0.42);
const CARRY_SCALE = 0.2;

// Left-hand poses: under the blaster's foregrip, or palm-up holding plushies.
const POSE = {
  support: { pos: v(0.19, -0.29, -0.51), rot: new THREE.Euler(0.05, -0.75, 0.1) },
  carry: { pos: v(-0.19, -0.31, -0.56), rot: new THREE.Euler(-0.05, -0.2, 0.15) },
};

const M = {
  orange: new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.45 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x3f73c4, roughness: 0.5 }),
  pink: new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5 }),
  tank: new THREE.MeshStandardMaterial({ color: 0x9df2ff, roughness: 0.15, transparent: true, opacity: 0.8 }),
  foam: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
  glove: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.75 }),
  cuff: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.8 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x2f5aa8, roughness: 0.85 }),
};

const sphere = new THREE.SphereGeometry(1, 14, 10);
const finger = new THREE.CapsuleGeometry(1, 2.2, 4, 8);

function mesh(geo, mat, parent, pos, scale, rot) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.copy(pos);
  if (scale) typeof scale === 'number' ? m.scale.setScalar(scale) : m.scale.copy(scale);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

// Cylinder spanning from a to b (radius r1 at a, r2 at b).
function limb(parent, a, b, r1, r2, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, dir.length(), 12), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  parent.add(m);
  return m;
}

// A finger: capsule of radius r and length l pointing along +x from `pos`, then rotated.
function addFinger(parent, pos, r, l, rot) {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.set(rot[0], rot[1], rot[2]);
  mesh(finger, M.glove, g, v(l / 2, 0, 0), v(r, l / 4.2, r), [0, 0, Math.PI / 2]);
  parent.add(g);
  return g;
}

export class Viewmodel {
  constructor(camera) {
    this.root = new THREE.Group();
    camera.add(this.root);
    this.recoil = 0;
    this.throwT = 0;
    this.grabT = 0;
    this.carryBlend = 0;
    this.reloadT = 0;
    this.sprint = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.time = 0;
    this.switchT = 0;
    this.pendingWeapon = null;
    this.buildGun();
    this.buildLeftArm();
  }

  buildGun() {
    // gun = shared mount (grip + right hand); each weapon model is a child shown one at a time
    const gun = new THREE.Group();
    gun.position.copy(GUN_POS);
    this.root.add(gun);
    this.gun = gun;
    mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05), M.blue, gun, v(0, -0.075, 0.065), null, [0.25, 0, 0]);

    this.models = {};
    this.muzzles = {};
    const model = (id, muzzleZ, muzzleY = 0.005) => {
      const g = new THREE.Group();
      g.visible = id === 'blaster';
      gun.add(g);
      const mz = new THREE.Object3D();
      mz.position.set(0, muzzleY, muzzleZ);
      g.add(mz);
      this.models[id] = g;
      this.muzzles[id] = mz;
      return g;
    };

    // Foam blaster
    let g = model('blaster', -0.24);
    mesh(new THREE.BoxGeometry(0.06, 0.075, 0.22), M.orange, g);
    mesh(new THREE.BoxGeometry(0.03, 0.016, 0.16), M.blue, g, v(0, 0.045, -0.01));
    mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 14), M.blue, g, v(0, 0.005, -0.16), null, [Math.PI / 2, 0, 0]);
    mesh(new THREE.TorusGeometry(0.026, 0.009, 8, 16), M.pink, g, v(0, 0.005, -0.22));
    mesh(new THREE.CircleGeometry(0.02, 12), M.foam, g, v(0, 0.005, -0.221), null, [Math.PI, 0, 0]);
    this.tank = mesh(sphere, M.tank, g, v(0, 0.08, 0.035), 0.042);
    this.foam = mesh(sphere, M.foam, g, v(0, 0.07, 0.035), 0.03);
    mesh(new THREE.BoxGeometry(0.035, 0.035, 0.06), M.blue, g, v(0, -0.05, -0.09));
    for (const sx of [-1, 1]) mesh(sphere, M.pink, g, v(sx * 0.031, 0, -0.03), v(0.006, 0.02, 0.02));

    // Net launcher: fat tube with a net ball loaded at the mouth
    g = model('net', -0.3, 0.02);
    mesh(new THREE.BoxGeometry(0.065, 0.07, 0.16), M.orange, g, v(0, 0, 0.02));
    mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.24, 16, 1, true), M.blue, g, v(0, 0.02, -0.15), null, [Math.PI / 2, 0, 0]);
    mesh(new THREE.TorusGeometry(0.055, 0.01, 8, 18), M.pink, g, v(0, 0.02, -0.27));
    mesh(new THREE.TorusGeometry(0.047, 0.008, 8, 18), M.pink, g, v(0, 0.02, -0.06));
    this.netBall = mesh(new THREE.IcosahedronGeometry(0.04, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }), g, v(0, 0.02, -0.25));
    mesh(new THREE.BoxGeometry(0.035, 0.035, 0.06), M.blue, g, v(0, -0.05, -0.09));
    mesh(new THREE.BoxGeometry(0.02, 0.03, 0.05), M.pink, g, v(0, 0.06, 0.02));

    // Confetti cannon: flared bell barrel with stripes
    g = model('confetti', -0.32, 0.015);
    mesh(new THREE.BoxGeometry(0.06, 0.07, 0.15), M.orange, g, v(0, 0, 0.03));
    mesh(new THREE.CylinderGeometry(0.075, 0.03, 0.26, 18), M.blue, g, v(0, 0.015, -0.17), null, [-Math.PI / 2, 0, 0]);
    for (const z of [-0.12, -0.2, -0.27]) mesh(new THREE.TorusGeometry(0.03 + (-z - 0.04) * 0.2, 0.006, 6, 18), M.pink, g, v(0, 0.015, z));
    const cMats = [0xff6b8b, 0xffd23f, 0x5fe0b7, 0x9df2ff, 0x7a4fd1].map((c) => new THREE.MeshBasicMaterial({ color: c }));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      mesh(new THREE.BoxGeometry(0.012, 0.012, 0.004), cMats[i % 5], g, v(Math.cos(a) * 0.045, 0.015 + Math.sin(a) * 0.045, -0.3), null, [a, a, 0]);
    }
    mesh(new THREE.BoxGeometry(0.035, 0.035, 0.06), M.blue, g, v(0, -0.05, -0.09));

    // Plushie vacuum: canister + long nozzle + fan at the back
    g = model('vacuum', -0.37, -0.01);
    mesh(new THREE.BoxGeometry(0.07, 0.08, 0.16), M.orange, g, v(0, 0, 0.03));
    mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 16), M.tank, g, v(0, 0.085, 0.02), null, [Math.PI / 2, 0, 0]);
    mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.3, 14), M.blue, g, v(0, -0.01, -0.2), null, [Math.PI / 2, 0, 0]);
    mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.05, 16), M.pink, g, v(0, -0.01, -0.35), null, [-Math.PI / 2, 0, 0]);
    this.fan = new THREE.Group();
    this.fan.position.set(0, 0.005, 0.112);
    g.add(this.fan);
    for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.045, 0.01, 0.004), M.pink, this.fan, null, null, [0, 0, (i * Math.PI) / 3]);
    mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 16), M.blue, g, v(0, 0.005, 0.112));
    mesh(new THREE.BoxGeometry(0.035, 0.035, 0.06), M.blue, g, v(0, -0.05, -0.09));

    // Legendary rainbow ray: sleek white body with rainbow rings and a glowing prism
    g = model('rainbow', -0.3, 0.01);
    const pearl = new THREE.MeshStandardMaterial({ color: 0xf6f1f6, roughness: 0.2, metalness: 0.3 });
    mesh(new THREE.BoxGeometry(0.06, 0.075, 0.2), pearl, g, v(0, 0, 0.02));
    mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.2, 14), pearl, g, v(0, 0.01, -0.17), null, [Math.PI / 2, 0, 0]);
    [0xff4d6d, 0xff9f1c, 0xffd23f, 0x5fe0b7, 0x3f8efc, 0x9b5de5].forEach((c, i) => {
      mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), new THREE.MeshBasicMaterial({ color: c }), g, v(0, 0.01, -0.09 - i * 0.03));
    });
    this.prism = mesh(new THREE.OctahedronGeometry(0.035, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), g, v(0, 0.075, 0.02));
    mesh(new THREE.BoxGeometry(0.035, 0.035, 0.06), M.blue, g, v(0, -0.05, -0.09));

    // Foam minigun: spinning six-barrel cluster with a drum magazine underneath
    g = model('minigun', -0.34, 0.012);
    mesh(new THREE.BoxGeometry(0.07, 0.08, 0.18), M.orange, g, v(0, 0, 0.03));
    mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 18), M.blue, g, v(0, -0.06, -0.02), null, [0, 0, Math.PI / 2]);
    this.minigunBarrels = new THREE.Group();
    this.minigunBarrels.position.set(0, 0.012, -0.2);
    g.add(this.minigunBarrels);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.24, 8), M.blue, this.minigunBarrels, v(Math.cos(a) * 0.024, Math.sin(a) * 0.024, 0), null, [Math.PI / 2, 0, 0]);
    }
    for (const z of [-0.1, 0.06]) mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 16), M.pink, this.minigunBarrels, v(0, 0, z));
    mesh(new THREE.BoxGeometry(0.035, 0.035, 0.06), M.blue, g, v(0, -0.05, -0.09));
    this.spin = 0;

    this.weapon = 'blaster';
    this.muzzle = this.muzzles.blaster;

    // Right hand wrapped around the grip
    const hand = new THREE.Group();
    hand.position.set(0.006, -0.075, 0.07);
    hand.rotation.x = 0.25;
    gun.add(hand);
    mesh(sphere, M.glove, hand, v(0.022, 0.0, 0.0), v(0.03, 0.052, 0.042));
    for (let i = 0; i < 3; i++) addFinger(hand, v(0.03, 0.022 - i * 0.023, -0.032), 0.011, 0.034, [0, Math.PI, 0]);
    addFinger(hand, v(0.03, 0.05, -0.05), 0.0105, 0.032, [0, Math.PI, 0.25]); // trigger finger
    addFinger(hand, v(-0.012, 0.045, 0.012), 0.012, 0.03, [0, Math.PI / 2 + 0.3, 0.2]); // thumb
    limb(hand, v(0.025, -0.035, 0.03), v(0.028, -0.05, 0.05), 0.04, 0.042, M.cuff);
    limb(hand, v(0.028, -0.05, 0.05), v(0.14, -0.26, 0.28), 0.04, 0.052, M.sleeve);
  }

  // Swap weapon with a quick lower-and-raise animation.
  setWeapon(id, instant = false) {
    this.pendingWeapon = id;
    this.muzzle = this.muzzles[id];
    if (instant) {
      this.showWeapon(id);
      this.switchT = 0;
    } else this.switchT = 1;
  }

  showWeapon(id) {
    for (const k in this.models) this.models[k].visible = k === id;
    this.weapon = id;
    this.pendingWeapon = null;
  }

  // Cosmetics: recolour the shared weapon / glove materials.
  applySkin(colors, metal = false) {
    [M.orange, M.blue, M.pink].forEach((m, i) => {
      m.color.setHex(colors[i]);
      m.metalness = metal ? 0.6 : 0;
      m.roughness = metal ? 0.3 : 0.5;
    });
  }

  applyGloves(color, metal = false) {
    M.glove.color.setHex(color);
    M.glove.metalness = metal ? 0.6 : 0;
    M.glove.roughness = metal ? 0.3 : 0.75;
  }

  buildLeftArm() {
    const arm = new THREE.Group();
    this.root.add(arm);
    this.leftArm = arm;
    // flat palm, fingers forward (-z), thumb to the right
    mesh(sphere, M.glove, arm, v(0, 0, 0), v(0.048, 0.022, 0.055));
    for (let i = 0; i < 4; i++) {
      addFinger(arm, v(-0.03 + i * 0.02, 0.004, -0.045), 0.0105, 0.035 - Math.abs(i - 1.5) * 0.004, [0, Math.PI / 2, -0.35]);
    }
    addFinger(arm, v(0.04, 0.008, -0.005), 0.012, 0.03, [0, 0.5, 0.35]);
    limb(arm, v(0, -0.005, 0.045), v(0, -0.02, 0.075), 0.04, 0.042, M.cuff);
    limb(arm, v(0, -0.02, 0.075), v(-0.02, -0.2, 0.38), 0.04, 0.052, M.sleeve);
    this.carryAnchor = new THREE.Group();
    this.carryAnchor.position.set(0, 0.02, -0.01);
    arm.add(this.carryAnchor);
    arm.position.copy(POSE.support.pos);
    arm.rotation.copy(POSE.support.rot);
  }

  // Only the item on top of the load sits in the hand; the rest of the load is shown in the HUD.
  layoutCarried(carried) {
    carried.forEach((p, i) => {
      const top = i === carried.length - 1;
      p.mesh.visible = top;
      if (!top) return;
      if (p.kind === 'can') {
        p.mesh.position.set(0, 0.1, -0.01);
        p.mesh.rotation.set(0, 0.6, 0);
        p.mesh.scale.setScalar(0.45);
      } else {
        p.mesh.position.set(0, 0, 0);
        p.mesh.rotation.set(0, 0.35, 0);
        p.mesh.scale.setScalar(CARRY_SCALE * Math.min(1, p.def.scale)); // big ones shrink to fit the hand
      }
    });
  }

  kickRecoil(strength = 1) {
    this.recoil = strength;
    if (this.weapon === 'minigun') this.spin = 1;
  }
  playThrow() {
    this.throwT = 1;
  }
  playGrab() {
    this.grabT = 1;
  }

  // s: { dt, bob, moving, lookDX, lookDY, sprinting, reloading, ammoFrac, vacuumOn, netLoaded, carried }
  update(s) {
    const dt = s.dt;
    this.time += dt;
    const k = (rate) => Math.min(1, dt * rate);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.switchT = Math.max(0, this.switchT - dt * 4);
    if (this.pendingWeapon && this.switchT <= 0.5) this.showWeapon(this.pendingWeapon);
    const sw = Math.sin(this.switchT * Math.PI);
    this.throwT = Math.max(0, this.throwT - dt * 3.5);
    this.grabT = Math.max(0, this.grabT - dt * 5);
    this.carryBlend += ((s.carried.length > 0 ? 1 : 0) - this.carryBlend) * k(10);
    this.reloadT += ((s.reloading ? 1 : 0) - this.reloadT) * k(12);
    this.sprint += ((s.sprinting ? 1 : 0) - this.sprint) * k(8);

    // Sway: the whole viewmodel lags behind mouse movement.
    this.swayX += (THREE.MathUtils.clamp(-s.lookDX * 0.0006, -0.04, 0.04) - this.swayX) * k(10);
    this.swayY += (THREE.MathUtils.clamp(s.lookDY * 0.0006, -0.04, 0.04) - this.swayY) * k(10);
    const bobX = Math.sin(s.bob) * 0.012 * s.moving;
    const bobY = -Math.abs(Math.cos(s.bob)) * 0.012 * s.moving;
    const idle = Math.sin(this.time * 1.6) * 0.003;
    this.root.position.set(this.swayX + bobX, this.swayY + bobY + idle - this.sprint * 0.03, 0);
    this.root.rotation.set(this.sprint * -0.12, this.sprint * 0.35, this.swayX * 2 + this.sprint * 0.1);

    // Gun: recoil kick + reload tilt
    const r = this.recoil;
    this.gun.position.set(GUN_POS.x, GUN_POS.y - this.reloadT * 0.06 + r * 0.01 - sw * 0.25, GUN_POS.z + r * 0.05);
    this.gun.rotation.set(r * 0.18 + this.reloadT * 0.5 - sw * 0.6, 0, this.reloadT * -0.5);
    this.netBall.visible = !!s.netLoaded;
    this.prism.rotation.y += dt * 3;
    // minigun barrels spin up while firing and wind down after
    this.spin = Math.max(0, this.spin - dt * 1.5);
    this.minigunBarrels.rotation.z += dt * 40 * this.spin;
    this.prism.material.color.setHSL((this.time * 0.3) % 1, 0.8, 0.65);
    if (s.vacuumOn) {
      this.fan.rotation.z += dt * 40;
      this.gun.position.x += (Math.random() - 0.5) * 0.003;
      this.gun.position.y += (Math.random() - 0.5) * 0.003;
    }
    const fill = 0.25 + 0.75 * Math.min(1, s.ammoFrac);
    this.foam.scale.set(0.03, 0.03 * fill, 0.03);
    this.foam.position.y = 0.07 - (1 - fill) * 0.025;

    // Left arm: blend support <-> carry, plus grab / throw / reload motions.
    const b = this.carryBlend;
    const arm = this.leftArm;
    arm.position.lerpVectors(POSE.support.pos, POSE.carry.pos, b);
    arm.rotation.set(
      THREE.MathUtils.lerp(POSE.support.rot.x, POSE.carry.rot.x, b),
      THREE.MathUtils.lerp(POSE.support.rot.y, POSE.carry.rot.y, b),
      THREE.MathUtils.lerp(POSE.support.rot.z, POSE.carry.rot.z, b),
    );
    // follow the gun when supporting it
    arm.position.y += (1 - b) * (r * 0.01 - sw * 0.25 - this.reloadT * (0.07 + Math.sin(this.time * 14) * 0.02));
    arm.position.z += (1 - b) * r * 0.05;
    const th = Math.sin(this.throwT * Math.PI);
    const gr = Math.sin(this.grabT * Math.PI);
    arm.position.z -= th * 0.2 + gr * 0.18;
    arm.position.y += th * 0.1 - gr * 0.04;
    arm.rotation.x += th * 0.5;

    s.carried.forEach((p, i) => {
      p.mesh.rotation.z = Math.sin(s.bob + i * 0.8) * 0.06 * s.moving + Math.sin(this.time * 2 + i) * 0.02;
    });
  }
}
