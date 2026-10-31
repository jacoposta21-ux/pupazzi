// The arena: an open lawn fenced by hedges, with four gates (one per side) where the plushies jump in,
// the Stuffer to defend in the middle and a shop stall on one side. Same footprint as the factory floor,
// so the nav grid, build mode and plushie bounds work unchanged.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { grassTexture, portalTexture, stripeTexture, signTexture, hazardTexture } from './Textures.js';

const F = LAYOUT.floor;
export const ARENA_CORE = { x: 0, z: 5 };
export const ARENA_SHOP_POS = { x: 13.5, z: 17.5 };
export const ARENA_SPAWN = { x: 0, z: 12 };
const GAP = 2.6; // half-width of a gate opening
const HEDGE_H = 1.1;
const HEDGE_T = 0.8;

// Gates: centre on the fence, outward direction, portal colour.
export const GATES = [
  { id: 'N', x: 0, z: F.minZ, out: { x: 0, z: -1 }, color: '#ff6b8b' },
  { id: 'S', x: 0, z: F.maxZ, out: { x: 0, z: 1 }, color: '#5fe0b7' },
  { id: 'W', x: F.minX, z: ARENA_CORE.z, out: { x: -1, z: 0 }, color: '#ffd23f' },
  { id: 'E', x: F.maxX, z: ARENA_CORE.z, out: { x: 1, z: 0 }, color: '#3f8efc' },
];

// Areas build mode must keep free: the gates' mouths, the Stuffer's surroundings and the shop.
export const ARENA_KEEP_CLEAR = [
  ...GATES.map((g) => {
    const along = g.out.x === 0;
    const inX = -g.out.x * 4, inZ = -g.out.z * 4;
    return along
      ? { minX: g.x - GAP - 0.5, maxX: g.x + GAP + 0.5, minZ: Math.min(g.z, g.z + inZ), maxZ: Math.max(g.z, g.z + inZ) }
      : { minX: Math.min(g.x, g.x + inX), maxX: Math.max(g.x, g.x + inX), minZ: g.z - GAP - 0.5, maxZ: g.z + GAP + 0.5 };
  }),
  { minX: ARENA_CORE.x - 2.6, maxX: ARENA_CORE.x + 2.6, minZ: ARENA_CORE.z - 2.6, maxZ: ARENA_CORE.z + 2.6 },
  { minX: ARENA_SHOP_POS.x - 2.2, maxX: ARENA_SHOP_POS.x + 2.2, minZ: ARENA_SHOP_POS.z - 2.2, maxZ: ARENA_SHOP_POS.z + 2.2 },
];

export function buildArena(scene, colliders, { shadows }) {
  const root = new THREE.Group();
  scene.add(root);
  const solids = [];

  const box = (w, h, d, mat, x, y, z, { collide = true, height, solid = true } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = shadows;
    root.add(m);
    if (collide) colliders.add(x - w / 2, x + w / 2, z - d / 2, z + d / 2, height ?? y + h / 2);
    if (solid) solids.push(m);
    return m;
  };

  // --- Ground ---
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(F.maxX - F.minX, F.maxZ - F.minZ),
    new THREE.MeshStandardMaterial({ map: grassTexture([6, 6]), roughness: 1 }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set((F.minX + F.maxX) / 2, 0, (F.minZ + F.maxZ) / 2);
  lawn.receiveShadow = shadows;
  root.add(lawn);
  solids.push(lawn);
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ map: grassTexture([40, 40]), color: 0xb8d8a8, roughness: 1 }),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.y = -0.02;
  field.receiveShadow = shadows;
  root.add(field);

  // paths from each gate to the Stuffer
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xe8d6b0, roughness: 1 });
  for (const g of GATES) {
    const len = Math.hypot(g.x - ARENA_CORE.x, g.z - ARENA_CORE.z);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, len), pathMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = Math.atan2(g.out.x, g.out.z);
    p.position.set((g.x + ARENA_CORE.x) / 2, 0.005, (g.z + ARENA_CORE.z) / 2);
    p.receiveShadow = shadows;
    root.add(p);
  }
  // hazard ring around the Stuffer
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.3, 48), new THREE.MeshStandardMaterial({ map: hazardTexture(16) }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ARENA_CORE.x, 0.01, ARENA_CORE.z);
  root.add(ring);

  // --- Hedges with gaps at the gates. Invisible tall colliders keep the player in. ---
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 0.95 });
  const bumps = [];
  const hedge = (x0, z0, x1, z1) => {
    const w = Math.abs(x1 - x0) || HEDGE_T, d = Math.abs(z1 - z0) || HEDGE_T;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(w, HEDGE_H, d, hedgeMat, cx, HEDGE_H / 2, cz, { height: 99 });
    const n = Math.max(w, d);
    for (let i = 0.5; i < n; i += 0.9) bumps.push([w > d ? Math.min(x0, x1) + i : cx, w > d ? cz : Math.min(z0, z1) + i]);
  };
  const T = HEDGE_T / 2;
  // north / south (gaps around x = 0)
  for (const z of [F.minZ - T, F.maxZ + T]) {
    hedge(F.minX - HEDGE_T, z, -GAP, z);
    hedge(GAP, z, F.maxX + HEDGE_T, z);
  }
  // west / east (gaps around the Stuffer's z)
  for (const x of [F.minX - T, F.maxX + T]) {
    hedge(x, F.minZ - HEDGE_T, x, ARENA_CORE.z - GAP);
    hedge(x, ARENA_CORE.z + GAP, x, F.maxZ + HEDGE_T);
  }
  const bumpMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 8, 6), hedgeMat, bumps.length);
  const m4 = new THREE.Matrix4();
  bumps.forEach(([x, z], i) => bumpMesh.setMatrixAt(i, m4.makeTranslation(x, HEDGE_H, z)));
  bumpMesh.castShadow = shadows;
  root.add(bumpMesh);

  // --- Gates: an arch with a swirling portal; plushies jump in through it ---
  const portals = [];
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf6f1f6, roughness: 0.5 });
  for (const g of GATES) {
    const along = g.out.x === 0; // gate opening runs along x
    const tx = along ? 1 : 0, tz = along ? 0 : 1;
    for (const s of [-1, 1]) {
      const px = g.x + tx * s * (GAP + 0.3), pz = g.z + tz * s * (GAP + 0.3);
      box(0.6, 4.2, 0.6, postMat, px, 2.1, pz);
      box(0.7, 0.3, 0.7, new THREE.MeshStandardMaterial({ color: g.color }), px, 4.35, pz, { collide: false });
    }
    box(along ? GAP * 2 + 1.2 : 0.6, 0.5, along ? 0.6 : GAP * 2 + 1.2, new THREE.MeshStandardMaterial({ color: g.color }), g.x, 4.2, g.z, { collide: false });
    // invisible barrier: the player stays in, plushies hop over it
    colliders.add(g.x - (along ? GAP : 0.5), g.x + (along ? GAP : 0.5), g.z - (along ? 0.5 : GAP), g.z + (along ? 0.5 : GAP), 99);
    const tex = portalTexture(g.color);
    tex.center.set(0.5, 0.5);
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(GAP * 2, 3.9),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    portal.position.set(g.x + g.out.x * 0.6, 1.95, g.z + g.out.z * 0.6);
    portal.rotation.y = along ? 0 : Math.PI / 2;
    root.add(portal);
    portals.push({ gate: g, mesh: portal, tex, flash: 0 });
  }

  // --- Toy-block cover, off the gate lanes ---
  const blockColors = [0xff6b8b, 0x5fe0b7, 0xffd23f, 0x3f8efc, 0x9b5de5];
  const blocks = [[-7, -3], [7, -3], [-7, 13], [7, 13], [-12, -9], [12, -9], [-12, 19]];
  blocks.forEach(([x, z], i) => {
    const s = 1.2;
    const b = box(s, s, s, new THREE.MeshStandardMaterial({ color: blockColors[i % blockColors.length], roughness: 0.6 }), x, s / 2, z);
    b.rotation.y = 0;
    if (i % 2 === 0) box(0.9, 0.9, 0.9, new THREE.MeshStandardMaterial({ color: blockColors[(i + 2) % 5], roughness: 0.6 }), x, s + 0.45, z, { collide: false });
  });

  // --- Trees around the field ---
  const trunk = new THREE.MeshStandardMaterial({ color: 0x8a5a35, roughness: 0.9 });
  const leaves = [0x4fae5b, 0x6cc46a, 0x3f8f4a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + Math.random() * 0.1;
    const r = 34 + Math.random() * 10;
    const x = Math.cos(a) * r, z = 5 + Math.sin(a) * r;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 8), trunk);
    t.position.set(x, 1.2, z);
    root.add(t);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random(), 10, 8), leaves[i % 3]);
    crown.position.set(x, 3.6 + Math.random(), z);
    crown.castShadow = false;
    root.add(crown);
  }

  // --- Shop stall ---
  const shop = new THREE.Group();
  shop.position.set(ARENA_SHOP_POS.x, 0, ARENA_SHOP_POS.z);
  root.add(shop);
  const wood = new THREE.MeshStandardMaterial({ color: 0xc8955a, roughness: 0.8 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1), wood);
  counter.position.y = 0.55;
  counter.castShadow = shadows;
  shop.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.2), new THREE.MeshStandardMaterial({ color: 0xff6b8b }));
  top.position.y = 1.15;
  shop.add(top);
  for (const sx of [-1.15, 1.15]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), postMat);
    post.position.set(sx, 1.3, 0.45);
    shop.add(post);
  }
  const awning = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 1.6), new THREE.MeshStandardMaterial({ map: stripeTexture() }));
  awning.position.set(0, 2.6, 0.3);
  awning.rotation.x = 0.2;
  shop.add(awning);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 0.5),
    new THREE.MeshBasicMaterial({ map: signTexture('SHOP', '#2fb58a'), toneMapped: false }),
  );
  sign.position.set(0, 3.0, 1.12);
  shop.add(sign);
  // "closed" board shown during rounds
  const closed = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.45),
    new THREE.MeshBasicMaterial({ map: signTexture('CLOSED', '#ff4d6d'), toneMapped: false }),
  );
  closed.position.set(0, 0.7, 0.51);
  shop.add(closed);
  // a few prizes on the counter
  const prizeCols = [0xff6b8b, 0x5fe0b7, 0x3f8efc];
  prizeCols.forEach((c, i) => {
    const pz = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: c }));
    pz.position.set(-0.7 + i * 0.7, 1.36, 0);
    shop.add(pz);
  });
  shop.lookAt(ARENA_CORE.x, 0, ARENA_CORE.z);
  solids.push(counter);
  colliders.add(ARENA_SHOP_POS.x - 1.2, ARENA_SHOP_POS.x + 1.2, ARENA_SHOP_POS.z - 1.2, ARENA_SHOP_POS.z + 1.2, 2.4);

  return { root, solids, portals, closedSign: closed };
}
