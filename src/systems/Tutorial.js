// First-day guided tutorial: a hint banner plus a bouncing 3D arrow over the current target.
// It ends by sending the player to the shop terminal.
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';
import { Audio } from './Audio.js';

const DOOR = new THREE.Vector3(LAYOUT.door.x, 0, LAYOUT.floor.maxZ - 3);
const CHUTE = new THREE.Vector3(LAYOUT.floor.minX + 1, LAYOUT.belt.top, LAYOUT.shipping.z);

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = null;
    this.timer = 0;
    this.shopSeen = false;
    game.bus.on('shopOpened', () => (this.shopSeen = true));

    const mat = new THREE.MeshBasicMaterial({ color: 0xff6b8b, depthTest: false, transparent: true });
    const ring = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    this.arrow = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 16), mat);
    cone.rotation.x = Math.PI;
    const outline = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.53, 16), ring);
    outline.rotation.x = Math.PI;
    outline.position.y = 0.02;
    outline.renderOrder = 998;
    cone.renderOrder = 999;
    this.arrow.add(outline, cone);
    this.arrow.visible = false;
    game.scene.add(this.arrow);
  }

  // Steps: [id, target(): Vector3|null, done(): bool]
  get steps() {
    const g = this.game;
    const P = g.player;
    const list = g.plushies.list;
    const grounded = () => list.filter((p) => p.state !== 'hop' && p.state !== 'carried');
    const nearest = (filter) => {
      let best = null;
      let bd = Infinity;
      for (const p of list) {
        if (!filter(p)) continue;
        const d = p.pos.distanceToSquared(P.pos);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best;
    };
    return {
      wait: {
        target: () => DOOR,
        done: () => grounded().length > 0,
        next: 'shoot',
      },
      shoot: {
        target: () => nearest((p) => p.grabbable && p.state !== 'ko')?.pos,
        done: () => list.some((p) => p.state === 'ko') || P.carried.length > 0,
        next: 'grab',
      },
      grab: {
        target: () => nearest((p) => p.state === 'ko')?.pos,
        done: () => P.carried.length > 0,
        back: () => !list.some((p) => p.state === 'ko') && 'shoot',
        next: 'throw',
      },
      throw: {
        target: () => g.stuffer?.hopperCenter ?? null,
        done: () => this.stuffed > 0,
        back: () => P.carried.length === 0 && !list.some((p) => p.state === 'thrown') && 'shoot',
        next: 'ship',
      },
      ship: {
        target: () => CHUTE,
        done: () => this.timer > 6,
        next: 'terminal',
      },
      terminal: {
        target: () => g.terminalPos.clone().setY(1.2),
        done: () => this.shopSeen,
        next: null,
      },
    };
  }

  start() {
    this.active = true;
    this.stuffed = 0;
    this.shopSeen = false;
    this.unsub?.();
    this.unsub = this.game.bus.on('plushieStuffed', () => this.stuffed++);
    this.go('wait');
  }

  stop() {
    this.active = false;
    this.arrow.visible = false;
    this.game.ui.tutorial(null);
  }

  go(step) {
    this.step = step;
    this.timer = 0;
    this.game.ui.tutorial(step);
    if (step !== 'wait') Audio.play('tutorial');
  }

  update(dt) {
    if (!this.active) return;
    this.timer += dt;
    const s = this.steps[this.step];
    if (s.done()) {
      if (s.next) this.go(s.next);
      else {
        this.stop();
        this.game.onTutorialDone();
        return;
      }
    } else {
      const back = s.back?.();
      if (back) this.go(back);
    }
    const target = this.steps[this.step].target();
    this.arrow.visible = !!target;
    if (target) {
      const lift = this.step === 'throw' ? 1.4 : this.step === 'ship' ? 1.6 : this.step === 'wait' ? 2.2 : 1.6;
      this.arrow.position.set(target.x, (target.y || 0) + lift + Math.abs(Math.sin(this.timer * 4)) * 0.3, target.z);
      this.arrow.rotation.y += dt * 2;
    }
  }
}
