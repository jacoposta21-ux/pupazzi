// Build mode: place machines from the inventory anywhere on the factory floor, rotate them,
// pick placed ones back up, and lay belt roads. A translucent ghost snaps to the grid in front of the player.
// Belts: click the start, click the end; the path is an L with a curve (R flips which way it turns).
import * as THREE from 'three';
import { LAYOUT, BELT_PRICE } from '../data/config.js';
import { buildGhost, footprint, dir } from '../entities/Machines.js';
import { beltPath, dirIndex } from '../entities/Belts.js';
import { Audio } from './Audio.js';

const GRID = 0.5;
const REACH = 14;
const MAX_PATH = 80;
const CENTER = new THREE.Vector2(0, 0);
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// Areas that must stay free: the unloading bay at the door and the shop terminal.
const KEEP_CLEAR = [
  { minX: LAYOUT.door.x - 5, maxX: LAYOUT.door.x + 5, minZ: LAYOUT.floor.maxZ - 5, maxZ: LAYOUT.floor.maxZ },
  { minX: LAYOUT.terminal.x - 1.5, maxX: LAYOUT.terminal.x + 1.5, minZ: LAYOUT.terminal.z - 1.5, maxZ: LAYOUT.terminal.z + 1.5 },
];
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

// Pool of translucent tiles previewing a belt path.
const tileGeo = new THREE.BoxGeometry(0.96, 0.2, 0.96);
const tileArrowGeo = new THREE.ConeGeometry(0.18, 0.4, 3);
const okMat = new THREE.MeshBasicMaterial({ color: 0x5fe0b7, transparent: true, opacity: 0.5, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.5, depthWrite: false });

export class BuildMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.type = null;
    this.rot = 0;
    this.ghost = null;
    this.valid = false;
    this.hovered = null; // placed machine under the crosshair (for pick-up)
    this.raycaster = new THREE.Raycaster();
    this.pos = new THREE.Vector3();
    // belt tool
    this.beltStart = null;
    this.xFirst = true;
    this.path = [];
    this.pathCost = 0;
    this.pool = [];
    this.pathGroup = new THREE.Group();
    game.scene.add(this.pathGroup);
  }

  get inventoryTypes() {
    const inv = this.game.data.inventory;
    return Object.keys(inv).filter((k) => inv[k] > 0);
  }

  // Tools on the build bar: belts (always, paid per metre) then the machines in the bag.
  get tools() {
    return ['belt', ...this.inventoryTypes];
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter(type) {
    this.active = true;
    this.game.player.setViewmodelVisible(false);
    this.select(type ?? this.inventoryTypes[0] ?? 'belt');
    Audio.play('swap');
  }

  exit() {
    this.active = false;
    this.setGhost(null);
    this.highlight(null);
    this.beltStart = null;
    this.showPath([]);
    this.game.player.setViewmodelVisible(true);
  }

  select(type) {
    this.type = type;
    this.beltStart = null;
    this.showPath([]);
    this.setGhost(type === 'belt' ? null : type);
  }

  setGhost(type) {
    if (this.ghost) this.ghost.removeFromParent();
    this.ghost = type ? buildGhost(type) : null;
    if (this.ghost) this.game.scene.add(this.ghost);
  }

  cycle(d) {
    const list = this.tools;
    const i = list.indexOf(this.type);
    this.select(list[(i + d + list.length) % list.length]);
  }

  highlight(machine) {
    if (this.hovered === machine) return;
    const set = (m, on) => m?.group.traverse((o) => {
      if (o.isMesh && o.material && !Array.isArray(o.material) && 'emissive' in o.material) {
        if (on) {
          o.userData.prevMat = o.material;
          o.material = o.material.clone();
          o.material.emissive = new THREE.Color(0x5fe0b7);
          o.material.emissiveIntensity = 0.5;
        } else if (o.userData.prevMat) {
          o.material = o.userData.prevMat;
          o.userData.prevMat = null;
        }
      }
    });
    set(this.hovered, false);
    this.hovered = machine;
    set(machine, true);
  }

  isTileCollider(b) {
    for (const t of this.game.beltNet.tiles.values()) if (t.collider === b) return true;
    return false;
  }

  // Is the footprint free (inside the floor, no walls, machines or reserved areas)?
  // The scanner gate is open in the middle: only its two posts need free space, so belts can run under it.
  check(type, x, z, rot) {
    const f = footprint(type, x, z, rot);
    const F = LAYOUT.floor;
    if (f.minX < F.minX + 0.3 || f.maxX > F.maxX - 0.3 || f.minZ < F.minZ + 0.3 || f.maxZ > F.maxZ - 0.3) return false;
    for (const k of KEEP_CLEAR) if (overlaps(f, k)) return false;
    let solid = [f];
    if (type === 'scanner') {
      const d = dir(rot);
      solid = [-1.95, 1.95].map((s) => {
        const cx = x - d.z * s, cz = z + d.x * s;
        return { minX: cx - 0.25, maxX: cx + 0.25, minZ: cz - 0.25, maxZ: cz + 0.25 };
      });
    }
    for (const r of solid) {
      for (const b of this.game.colliders.boxes) if (!b.disabled && b.height > 0.05 && overlaps(r, b)) return false;
      for (const m of this.game.machines) if (overlaps(r, footprint(m.type, m.pos.x, m.pos.z, m.rot))) return false;
    }
    return true;
  }

  // Can a 1 m belt tile go in this cell? Existing tiles are fine (they get re-pointed); so is the
  // middle of a scanner gate.
  checkCell(x, z) {
    const r = { minX: x - 0.48, maxX: x + 0.48, minZ: z - 0.48, maxZ: z + 0.48 };
    const F = LAYOUT.floor;
    if (r.minX < F.minX || r.maxX > F.maxX || r.minZ < F.minZ + 0.3 || r.maxZ > F.maxZ - 0.3) return false;
    if (this.game.beltNet.at(x, z)) return !this.game.beltNet.at(x, z).fixed;
    for (const k of KEEP_CLEAR) if (overlaps(r, k)) return false;
    for (const b of this.game.colliders.boxes) {
      if (b.disabled || b.height <= 0.05 || !overlaps(r, b) || this.isTileCollider(b)) continue;
      return false;
    }
    for (const m of this.game.machines) {
      if (m.type === 'scanner') continue;
      if (overlaps(r, footprint(m.type, m.pos.x, m.pos.z, m.rot))) return false;
    }
    return true;
  }

  showPath(cells, valid = true) {
    while (this.pool.length < Math.min(cells.length, MAX_PATH)) {
      const g = new THREE.Group();
      const slab = new THREE.Mesh(tileGeo, okMat);
      slab.position.y = LAYOUT.belt.top - 0.1;
      const arrow = new THREE.Mesh(tileArrowGeo, okMat);
      arrow.rotation.z = -Math.PI / 2;
      arrow.position.y = LAYOUT.belt.top + 0.1;
      g.add(slab, arrow);
      this.pathGroup.add(g);
      this.pool.push(g);
    }
    this.pool.forEach((g, i) => {
      const c = cells[i];
      g.visible = !!c;
      if (!c) return;
      g.position.set(c.x, 0, c.z);
      const d = dir(c.d);
      g.rotation.y = Math.atan2(-d.z, d.x);
      const mat = valid && c.ok !== false ? okMat : badMat;
      g.children.forEach((m) => (m.material = mat));
    });
  }

  aimPoint() {
    const ray = this.raycaster.ray;
    const p = ray.intersectPlane(FLOOR, this.pos);
    if (!p || p.distanceTo(ray.origin) > REACH) {
      this.pos.copy(this.game.player.pos).addScaledVector(this.game.player.forward.setY(0).normalize(), 4);
    }
    return this.pos;
  }

  updateBelt(input) {
    const game = this.game;
    const p = this.aimPoint();
    const cell = { x: Math.round(p.x), z: Math.round(p.z) };
    // default direction for a single tile: where the player is looking
    const f = game.player.forward;
    const facing = Math.abs(f.x) > Math.abs(f.z) ? dirIndex(f.x, 0) : dirIndex(0, f.z);
    let cells;
    if (!this.beltStart) cells = [{ ...cell, d: facing }];
    else {
      cells = beltPath(this.beltStart, cell, this.xFirst, facing);
      if (cells.length > MAX_PATH) cells = cells.slice(0, MAX_PATH);
    }
    let ok = true;
    for (const c of cells) {
      c.ok = this.checkCell(c.x, c.z);
      ok &&= c.ok;
    }
    const fresh = cells.filter((c) => !game.beltNet.at(c.x, c.z)).length;
    this.path = cells;
    this.pathCost = fresh * BELT_PRICE;
    this.valid = ok && game.data.cash >= this.pathCost;
    this.showPath(cells, this.valid || !this.beltStart);

    if (input.throwPressed && this.beltStart) {
      this.beltStart = null; // right click / F: cancel the start point
      Audio.play('click');
    }
    if (!input.firePressed) return;
    if (!this.beltStart) {
      if (!cells[0].ok) return Audio.play('reject');
      this.beltStart = cell;
      Audio.play('click');
      return;
    }
    if (!this.valid) return Audio.play('reject');
    game.buildBelts(cells);
    this.exit(); // back to the blaster right away
  }

  update(dt, input) {
    const game = this.game;
    if (input.buildPressed) return this.exit();
    if (input.weaponSlot) this.select(this.tools[input.weaponSlot - 1] ?? this.type);
    if (input.wheel || input.swapPressed) this.cycle(Math.sign(input.wheel) || 1);
    if (input.rotatePressed) {
      if (this.type === 'belt') this.xFirst = !this.xFirst;
      else this.rot = (this.rot + 1) % 4;
      Audio.play('click');
    }

    this.raycaster.setFromCamera(CENTER, game.camera);
    // aiming at a placed machine or a belt tile? (pick-up target)
    const groups = game.machines.map((m) => m.group);
    const tiles = game.beltNet.list.filter((t) => !t.fixed).map((t) => t.group);
    const hit = this.raycaster.intersectObjects([...groups, ...tiles], true)[0];
    let machine = null;
    let tile = null;
    if (hit && hit.distance < REACH) {
      let o = hit.object;
      while (o && !o.userData.machine && !o.userData.tile) o = o.parent;
      machine = o?.userData.machine ?? null;
      tile = o?.userData.tile ?? null;
    }
    this.highlight(this.type && this.type !== 'belt' ? null : machine);
    this.hoveredTile = tile;
    if (input.grabPressed && (machine || tile)) {
      if (machine) {
        game.pickUpMachine(machine);
        if (this.type === 'belt') this.select(machine.type);
      } else game.pickUpBelt(tile);
      return;
    }

    if (this.type === 'belt') return this.updateBelt(input);
    if (!this.type || !this.ghost) return;
    const p = this.aimPoint();
    // Stuffers, scanners and extractors snap to whole metres so they line up with belt tiles
    const grid = ['stuffer', 'scanner', 'extractor'].includes(this.type) ? 1 : GRID;
    p.x = Math.round(p.x / grid) * grid;
    p.z = Math.round(p.z / grid) * grid;
    this.valid = this.check(this.type, p.x, p.z, this.rot);
    this.ghost.position.set(p.x, 0, p.z);
    this.ghost.rotation.y = (-this.rot * Math.PI) / 2;
    this.ghost.userData.mat.color.setHex(this.valid ? 0x5fe0b7 : 0xff4d4d);

    if (input.firePressed) {
      if (!this.valid) {
        Audio.play('reject');
        return;
      }
      game.placeMachine(this.type, p.x, p.z, this.rot);
      // back to the blaster right away; press B again to place more
      this.exit();
    }
  }
}
