// Builds the static factory: floor, walls with the loading door, props, lights and signs.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { floorTexture, asphaltTexture, wallTexture, hazardTexture, signTexture, shutterTexture } from './Textures.js';

export function buildFactory(scene, colliders, { shadows }) {
  const solids = [];
  const { floor: F, wallHeight: H, door: D } = LAYOUT;
  const T = 0.5; // wall thickness

  const addBox = (w, h, d, mat, x, y, z, { collide = true, solid = true, cast = true } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast && shadows;
    m.receiveShadow = shadows;
    scene.add(m);
    if (collide) colliders.add(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + h / 2);
    if (solid) solids.push(m);
    return m;
  };

  // --- Lights ---
  scene.add(new THREE.HemisphereLight(0xe6eeff, 0x4a3f36, 1.1));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.8);
  sun.position.set(10, 22, 8);
  sun.target.position.set(0, 0, 4);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // --- Ground ---
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(F.maxX - F.minX, F.maxZ - F.minZ),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((F.minX + F.maxX) / 2, 0, (F.minZ + F.maxZ) / 2);
  floor.receiveShadow = shadows;
  scene.add(floor);
  solids.push(floor);

  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 1 }),
  );
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.02;
  outside.receiveShadow = shadows;
  scene.add(outside);

  // Road stripes in front of the loading door
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf0f0e0 });
  for (let x = -60; x <= 60; x += 6) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.25), stripeMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.0, LAYOUT.truckLaneZ + 3.2);
    scene.add(s);
  }

  // Painted unloading bay
  const bay = new THREE.Mesh(
    new THREE.PlaneGeometry(D.halfWidth * 2 + 4, 0.4),
    new THREE.MeshStandardMaterial({ map: hazardTexture(10) }),
  );
  bay.rotation.x = -Math.PI / 2;
  bay.position.set(D.x, 0.01, 18);
  scene.add(bay);

  // --- Walls ---
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.85 });
  const wallMatShort = wallMat.clone();
  wallMatShort.map = wallTexture();
  wallMatShort.map.repeat.set(3, 1);
  const W = F.maxX - F.minX + T * 2;
  const L = F.maxZ - F.minZ + T * 2;
  addBox(W, H, T, wallMat, 0, H / 2, F.minZ - T / 2, { cast: false }); // front
  addBox(T, H, L, wallMat, F.minX - T / 2, H / 2, (F.minZ + F.maxZ) / 2, { cast: false }); // left
  addBox(T, H, L, wallMat, F.maxX + T / 2, H / 2, (F.minZ + F.maxZ) / 2, { cast: false }); // right
  // back wall, split around the loading door
  const segW = (W - D.halfWidth * 2) / 2;
  addBox(segW, H, T, wallMatShort, F.minX - T + segW / 2, H / 2, F.maxZ + T / 2, { cast: false });
  addBox(segW, H, T, wallMatShort, F.maxX + T - segW / 2, H / 2, F.maxZ + T / 2, { cast: false });
  const lintel = addBox(D.halfWidth * 2, H - D.height, T, wallMat, D.x, D.height + (H - D.height) / 2, F.maxZ + T / 2, {
    collide: false,
    cast: false,
  });
  lintel.material = new THREE.MeshStandardMaterial({ color: 0x8f9cab });
  // Invisible barrier: the player can't wander outside, plushies hop in over it.
  colliders.add(D.x - D.halfWidth, D.x + D.halfWidth, F.maxZ - 0.2, F.maxZ + T + 0.5, 99);

  // Door frame in hazard paint
  const frameMat = new THREE.MeshStandardMaterial({ map: hazardTexture(1) });
  addBox(0.3, D.height, 0.7, frameMat, D.x - D.halfWidth - 0.15, D.height / 2, F.maxZ + T / 2, { collide: false });
  addBox(0.3, D.height, 0.7, frameMat, D.x + D.halfWidth + 0.15, D.height / 2, F.maxZ + T / 2, { collide: false });

  // Ceiling + beams + lamps
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(W, L),
    new THREE.MeshStandardMaterial({ color: 0x5b6270, roughness: 1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, (F.minZ + F.maxZ) / 2);
  scene.add(ceiling);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0xe8455f, roughness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 1.2 });
  for (let z = F.minZ + 4; z < F.maxZ; z += 8) {
    addBox(W, 0.4, 0.4, beamMat, 0, H - 0.3, z, { collide: false, solid: false, cast: false });
    for (let x = -12; x <= 12; x += 8) {
      addBox(1.8, 0.12, 0.5, lampMat, x, H - 0.6, z, { collide: false, solid: false, cast: false });
    }
  }

  // --- Props ---
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x7d8796, roughness: 0.7 });
  for (const [x, z] of [[-12, 12], [12, 12], [12, -2], [3, -9]]) {
    addBox(0.8, H, 0.8, pillarMat, x, H / 2, z);
    addBox(0.9, 1.2, 0.9, new THREE.MeshStandardMaterial({ map: hazardTexture(1) }), x, 0.6, z, { collide: false });
  }

  const crateMat = new THREE.MeshStandardMaterial({ color: 0xc8955a, roughness: 0.9 });
  const crateDark = new THREE.MeshStandardMaterial({ color: 0xa8743f, roughness: 0.9 });
  const crates = [
    [15.5, 21, 1.4], [15.5, 19.4, 1.4], [15.6, 21, 1.4, 1.4], [-15.5, 21.2, 1.2], [-14.1, 21.4, 1.0],
    [16, -11.5, 1.4], [14.5, -12.2, 1.1], [16.2, -11.5, 1.0, 1.4], [6, -12.6, 1.2], [-2, -12.8, 0.9],
  ];
  for (const [x, z, s, y0 = 0] of crates) {
    addBox(s, s, s, Math.random() < 0.5 ? crateMat : crateDark, x, y0 + s / 2, z, { collide: y0 === 0 });
  }

  // Shelving along the right wall
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x3f73c4, roughness: 0.6 });
  for (const z of [2, 7]) {
    addBox(1.2, 3.2, 4, shelfMat, 17.3, 1.6, z);
  }

  // Signs
  const sign = (text, bg, w, h, x, y, z, rotY) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: signTexture(text, bg), toneMapped: false }),
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
  };
  sign('STUFFED CO.', '#ff6b8b', 8, 2, 0, 5.6, F.minZ + 0.01, 0);
  sign('UNLOADING', '#2fb58a', 4, 1, D.x, 5.2, F.maxZ - 0.01, Math.PI);

  // Roll-up shutter on the loading door: opens for deliveries, closes when the truck leaves.
  const shutter = new THREE.Mesh(
    new THREE.BoxGeometry(D.halfWidth * 2, D.height, 0.12),
    new THREE.MeshStandardMaterial({ map: shutterTexture(), roughness: 0.6, metalness: 0.3 }),
  );
  shutter.position.set(D.x, D.height / 2, F.maxZ + T / 2);
  shutter.castShadow = shadows;
  scene.add(shutter);

  // Shop terminal: a chunky kiosk with a glowing screen, facing the middle of the factory.
  const term = new THREE.Group();
  term.position.set(LAYOUT.terminal.x, 0, LAYOUT.terminal.z);
  scene.add(term);
  const kioskMat = new THREE.MeshStandardMaterial({ color: 0x2a2140, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.8), kioskMat);
  base.position.y = 0.55;
  base.castShadow = shadows;
  term.add(base);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.25), new THREE.MeshStandardMaterial({ color: 0xff6b8b, roughness: 0.5 }));
  head.position.set(0, 1.5, -0.1);
  head.rotation.x = -0.25;
  head.castShadow = shadows;
  term.add(head);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.7),
    new THREE.MeshBasicMaterial({ map: signTexture('SHOP', '#2fb58a', '#fff', 512, 300), toneMapped: false }),
  );
  screen.position.set(0, 1.52, 0.04);
  screen.rotation.x = -0.25;
  term.add(screen);
  const topMat = new THREE.MeshBasicMaterial({ map: signTexture('TERMINAL', '#2a2140'), toneMapped: false });
  for (const back of [false, true]) {
    const topSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), topMat);
    topSign.position.set(0, 2.25, back ? -0.11 : -0.09);
    if (back) topSign.rotation.y = Math.PI;
    term.add(topSign);
  }
  term.lookAt(LAYOUT.playerSpawn.x, 0, LAYOUT.playerSpawn.z);
  solids.push(base, head);
  colliders.add(LAYOUT.terminal.x - 0.6, LAYOUT.terminal.x + 0.6, LAYOUT.terminal.z - 0.6, LAYOUT.terminal.z + 0.6, 2);

  // Shipping chute in the west wall: the only place where cans get paid.
  const S = LAYOUT.shipping;
  const top = LAYOUT.belt.top;
  const chute = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 1.6), new THREE.MeshStandardMaterial({ color: 0x1b1d22 }));
  chute.position.set(F.minX + 0.1, top + 0.55, S.z);
  scene.add(chute);
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x2c6fd1, transparent: true, opacity: 0.8 });
  for (let i = -3; i <= 3; i++) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.2), flapMat);
    flap.position.set(F.minX + 0.3, top + 0.6, S.z + i * 0.21);
    scene.add(flap);
  }
  const shipSign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.8),
    new THREE.MeshBasicMaterial({ map: signTexture('SHIPPING', '#3f73c4'), toneMapped: false }),
  );
  shipSign.position.set(F.minX + 0.01, 3.1, S.z);
  shipSign.rotation.y = Math.PI / 2;
  scene.add(shipSign);

  return { solids, sun, shutter, terminalScreen: screen };
}
