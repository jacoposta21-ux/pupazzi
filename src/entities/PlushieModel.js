// Procedural cute plushie built from primitives. Shared geometry/materials keep draw setup cheap.
import * as THREE from 'three';

const G = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  lowSphere: new THREE.SphereGeometry(1, 8, 6),
  capsule: new THREE.CapsuleGeometry(1, 2.4, 4, 10),
  cone: new THREE.ConeGeometry(1, 1, 10),
  star: new THREE.OctahedronGeometry(1, 0),
  dome: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
};

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}

function part(geo, material, [sx, sy, sz], [x, y, z], parent, shadows) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  parent.add(m);
  return m;
}

// Returns { root, body, eyes, stars, helmet }. root: position + heading, body: waddle/lying/squash.
export function buildPlushie(def, shadows) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const fur = def.golden
    ? mat(def.color, { metalness: 0.55, roughness: 0.35, emissive: 0x553300, emissiveIntensity: 0.6 })
    : mat(def.color);
  const accent = mat(def.accent);
  const black = mat(0x1d1726, { roughness: 0.3 });
  const white = mat(0xffffff, { roughness: 0.2 });
  const blush = mat(0xff8fa8);

  part(G.sphere, fur, [0.38, 0.36, 0.34], [0, 0.4, 0], body, shadows); // torso
  part(G.sphere, accent, [0.25, 0.25, 0.12], [0, 0.38, 0.25], body, false); // belly
  part(G.sphere, fur, [0.31, 0.29, 0.29], [0, 0.9, 0.02], body, shadows); // head
  part(G.sphere, accent, [0.12, 0.09, 0.08], [0, 0.84, 0.27], body, false); // muzzle
  part(G.lowSphere, black, [0.04, 0.035, 0.03], [0, 0.87, 0.34], body, false); // nose
  part(G.lowSphere, blush, [0.05, 0.03, 0.02], [-0.17, 0.83, 0.25], body, false);
  part(G.lowSphere, blush, [0.05, 0.03, 0.02], [0.17, 0.83, 0.25], body, false);

  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = part(G.lowSphere, black, [0.045, 0.05, 0.03], [sx * 0.1, 0.95, 0.27], body, false);
    part(G.lowSphere, white, [0.35, 0.35, 0.35], [-0.3, 0.35, 0.7], eye, false);
    eyes.push(eye);
    part(G.sphere, fur, [0.11, 0.11, 0.11], [sx * 0.36, 0.45, 0.06], body, shadows); // arms
    part(G.sphere, accent, [0.13, 0.08, 0.16], [sx * 0.17, 0.06, 0.07], body, false); // feet

    if (def.ears === 'round') {
      part(G.sphere, fur, [0.11, 0.11, 0.07], [sx * 0.21, 1.14, 0], body, shadows);
      part(G.sphere, accent, [0.06, 0.06, 0.03], [sx * 0.21, 1.13, 0.05], body, false);
    } else if (def.ears === 'long') {
      const ear = part(G.capsule, fur, [0.065, 0.12, 0.05], [sx * 0.12, 1.35, -0.02], body, shadows);
      ear.rotation.z = -sx * 0.18;
    } else if (def.ears === 'pointy') {
      const ear = part(G.cone, fur, [0.11, 0.22, 0.07], [sx * 0.17, 1.17, 0], body, shadows);
      ear.rotation.z = -sx * 0.25;
    } else if (def.ears === 'floppy') {
      const ear = part(G.capsule, mat(0x8a5a35), [0.07, 0.09, 0.04], [sx * 0.3, 0.88, 0], body, shadows);
      ear.rotation.z = sx * 0.35;
    }
  }

  // Knight helmet: a dented pot with a little plume. Falls off when the armour breaks.
  let helmet = null;
  if (def.helmet) {
    helmet = new THREE.Group();
    const steel = mat(0xb8c0cc, { metalness: 0.75, roughness: 0.3 });
    part(G.dome, steel, [0.33, 0.3, 0.32], [0, 0, 0], helmet, shadows);
    part(G.sphere, steel, [0.36, 0.03, 0.35], [0, 0, 0], helmet, false);
    const plume = part(G.capsule, mat(0xff6b8b), [0.05, 0.06, 0.05], [0, 0.36, -0.05], helmet, false);
    plume.rotation.x = -0.4;
    helmet.position.set(0, 1.03, 0);
    body.add(helmet);
  }
  if (def.splitsInto) {
    // matryoshka seam + painted flower (white/pink: nothing on a plushie should look like gold)
    part(G.sphere, mat(0xffffff), [0.39, 0.03, 0.35], [0, 0.62, 0], body, false);
    part(G.lowSphere, mat(0xff8fa8), [0.07, 0.07, 0.03], [0, 0.42, 0.36], body, false);
  }
  if (def.ears === 'pointy') {
    // a little tail for the kitty
    const tail = part(G.capsule, fur, [0.05, 0.12, 0.05], [0, 0.35, -0.38], body, false);
    tail.rotation.x = -0.9;
  }

  // Dizzy stars shown when knocked out. Child of root so they stay upright.
  const stars = new THREE.Group();
  const starMat = mat(0xffd23f, { emissive: 0x886600, emissiveIntensity: 0.6 });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(G.star, starMat);
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
    s.scale.setScalar(0.07);
    stars.add(s);
  }
  stars.position.y = 0.75;
  stars.visible = false;
  root.add(stars);

  root.scale.setScalar(def.scale);
  return { root, body, eyes, stars, helmet };
}
