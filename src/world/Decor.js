// Cosmetic factory decorations bought in the Style shop: bunting, potted plants, a golden teddy statue.
import * as THREE from 'three';
import { PLUSHIES } from '../data/config.js';
import { buildPlushie } from '../entities/PlushieModel.js';

const FLAG_COLORS = [0xff6b8b, 0xffd23f, 0x5fe0b7, 0x3f73c4, 0x7a4fd1];

export class Decor {
  constructor(game) {
    this.game = game;
    this.items = {
      decor_bunting: this.buildBunting(),
      decor_plants: this.buildPlants(),
      decor_statue: this.buildStatue(),
    };
    for (const it of Object.values(this.items)) {
      it.group.visible = false;
      game.scene.add(it.group);
      for (const c of it.colliders) c.disabled = true;
    }
  }

  buildBunting() {
    const group = new THREE.Group();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.45, 0], 3));
    tri.computeVertexNormals();
    const rows = [-8, 0, 8, 16];
    const perRow = 42;
    const flags = new THREE.InstancedMesh(tri, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), rows.length * perRow);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xf4f1ea });
    let k = 0;
    for (const z of rows) {
      const pts = [];
      for (let i = 0; i <= perRow; i++) {
        const x = -17 + (34 * i) / perRow;
        const y = 6.6 - 0.9 * (1 - (x / 17) ** 2);
        pts.push(new THREE.Vector3(x, y, z));
        if (i < perRow) {
          m.makeTranslation(x + 0.4, y, z);
          flags.setMatrixAt(k, m);
          flags.setColorAt(k, c.setHex(FLAG_COLORS[k % FLAG_COLORS.length]));
          k++;
        }
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ropeMat));
    }
    group.add(flags);
    return { group, colliders: [] };
  }

  buildPlants() {
    const group = new THREE.Group();
    const colliders = [];
    const pot = new THREE.MeshStandardMaterial({ color: 0xd9734e, roughness: 0.9 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3fae6a, roughness: 0.8 });
    const leaf2 = new THREE.MeshStandardMaterial({ color: 0x5fcf84, roughness: 0.8 });
    const potGeo = new THREE.CylinderGeometry(0.38, 0.28, 0.6, 14);
    const leafGeo = new THREE.SphereGeometry(1, 12, 8);
    for (const [x, z] of [[-17, 15], [17, 15.5], [-17, 3], [-5, -13], [5.5, -13.2], [17, -1]]) {
      const p = new THREE.Group();
      p.position.set(x, 0, z);
      const potMesh = new THREE.Mesh(potGeo, pot);
      potMesh.position.y = 0.3;
      potMesh.castShadow = true;
      p.add(potMesh);
      for (let i = 0; i < 5; i++) {
        const l = new THREE.Mesh(leafGeo, i % 2 ? leaf : leaf2);
        const a = (i / 5) * Math.PI * 2;
        l.position.set(Math.cos(a) * 0.22, 0.9 + (i % 3) * 0.18, Math.sin(a) * 0.22);
        l.scale.set(0.3, 0.38, 0.3);
        l.castShadow = true;
        p.add(l);
      }
      group.add(p);
      colliders.push(this.game.colliders.add(x - 0.38, x + 0.38, z - 0.38, z + 0.38, 1.4));
    }
    return { group, colliders };
  }

  buildStatue() {
    const group = new THREE.Group();
    group.position.set(0, 0, -11.2);
    const marble = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.8, 24), marble);
    ped.position.y = 0.4;
    ped.castShadow = ped.receiveShadow = true;
    group.add(ped);
    const { root } = buildPlushie(PLUSHIES.golden, true);
    root.scale.setScalar(2.6);
    root.position.y = 0.8;
    group.add(root);
    this.statue = root;
    return { group, colliders: [this.game.colliders.add(-1.4, 1.4, -12.6, -9.8, 99)] };
  }

  // decor: array of owned+enabled decor ids
  apply(decor) {
    for (const [id, it] of Object.entries(this.items)) {
      const on = decor.includes(id);
      it.group.visible = on;
      for (const c of it.colliders) c.disabled = !on;
    }
  }

  update(dt) {
    if (this.items.decor_statue.group.visible) this.statue.rotation.y = Math.sin(performance.now() / 2000) * 0.3;
  }
}
