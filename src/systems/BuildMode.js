// Build mode: place machines from the inventory anywhere on the factory floor, rotate them,
// and pick placed ones back up. A translucent ghost snaps to a 0.5 m grid in front of the player.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { buildGhost, footprint } from '../entities/Machines.js';
import { Audio } from './Audio.js';

const GRID = 0.5;
const REACH = 12;
const CENTER = new THREE.Vector2(0, 0);
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// Areas that must stay free: the unloading bay at the door and the shop terminal.
const KEEP_CLEAR = [
  { minX: LAYOUT.door.x - 5, maxX: LAYOUT.door.x + 5, minZ: LAYOUT.floor.maxZ - 5, maxZ: LAYOUT.floor.maxZ },
  { minX: LAYOUT.terminal.x - 1.5, maxX: LAYOUT.terminal.x + 1.5, minZ: LAYOUT.terminal.z - 1.5, maxZ: LAYOUT.terminal.z + 1.5 },
];
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

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
  }

  get inventoryTypes() {
    const inv = this.game.data.inventory;
    return Object.keys(inv).filter((k) => inv[k] > 0);
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter(type) {
    this.active = true;
    this.game.player.setViewmodelVisible(false);
    this.select(type ?? this.inventoryTypes[0] ?? null);
    Audio.play('swap');
  }

  exit() {
    this.active = false;
    this.setGhost(null);
    this.highlight(null);
    this.game.player.setViewmodelVisible(true);
  }

  select(type) {
    this.type = type;
    this.setGhost(type);
  }

  setGhost(type) {
    if (this.ghost) this.ghost.removeFromParent();
    this.ghost = type ? buildGhost(type) : null;
    if (this.ghost) this.game.scene.add(this.ghost);
  }

  cycle(d) {
    const list = this.inventoryTypes;
    if (!list.length) return;
    const i = list.indexOf(this.type);
    this.select(list[(i + d + list.length) % list.length]);
  }

  highlight(machine) {
    if (this.hovered === machine) return;
    const set = (m, on) => m?.group.traverse((o) => {
      if (o.isMesh && o.material && 'emissive' in o.material) {
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

  // Is the footprint free (inside the floor, no walls, machines or reserved areas)?
  check(type, x, z, rot) {
    const f = footprint(type, x, z, rot);
    const F = LAYOUT.floor;
    if (f.minX < F.minX + 0.3 || f.maxX > F.maxX - 0.3 || f.minZ < F.minZ + 0.3 || f.maxZ > F.maxZ - 0.3) return false;
    for (const k of KEEP_CLEAR) if (overlaps(f, k)) return false;
    for (const b of this.game.colliders.boxes) if (!b.disabled && b.height > 0.05 && overlaps(f, b)) return false;
    for (const m of this.game.machines) if (overlaps(f, footprint(m.type, m.pos.x, m.pos.z, m.rot))) return false;
    return true;
  }

  update(dt, input) {
    const game = this.game;
    if (input.buildPressed) return this.exit();
    if (input.weaponSlot) this.select(this.inventoryTypes[input.weaponSlot - 1] ?? this.type);
    if (input.wheel || input.swapPressed) this.cycle(Math.sign(input.wheel) || 1);
    if (input.rotatePressed) {
      this.rot = (this.rot + 1) % 4;
      Audio.play('click');
    }

    this.raycaster.setFromCamera(CENTER, game.camera);
    // aiming at a placed machine? (pick-up target)
    const groups = game.machines.map((m) => m.group);
    const hit = this.raycaster.intersectObjects(groups, true)[0];
    let machine = null;
    if (hit && hit.distance < REACH) {
      let o = hit.object;
      while (o && !o.userData.machine) o = o.parent;
      machine = o?.userData.machine ?? null;
    }
    this.highlight(this.type ? null : machine);
    if (input.grabPressed && machine) {
      game.pickUpMachine(machine);
      if (!this.type) this.select(machine.type);
      return;
    }

    if (!this.type || !this.ghost) return;
    const ray = this.raycaster.ray;
    const p = ray.intersectPlane(FLOOR, this.pos);
    if (!p || p.distanceTo(ray.origin) > REACH) {
      this.pos.copy(game.player.pos).addScaledVector(game.player.forward.setY(0).normalize(), 4);
    }
    this.pos.x = Math.round(this.pos.x / GRID) * GRID;
    this.pos.z = Math.round(this.pos.z / GRID) * GRID;
    this.valid = this.check(this.type, this.pos.x, this.pos.z, this.rot);
    this.ghost.position.set(this.pos.x, 0, this.pos.z);
    this.ghost.rotation.y = (-this.rot * Math.PI) / 2;
    this.ghost.userData.mat.color.setHex(this.valid ? 0x5fe0b7 : 0xff4d4d);

    if (input.firePressed) {
      if (!this.valid) {
        Audio.play('reject');
        return;
      }
      game.placeMachine(this.type, this.pos.x, this.pos.z, this.rot);
      if (!game.data.inventory[this.type]) this.select(this.inventoryTypes[0] ?? null);
    }
  }
}
