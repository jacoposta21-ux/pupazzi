// Navigation grid for ground robots: a 0.5 m occupancy grid of the factory floor built from the
// colliders (anything taller than a robot can climb), and A* paths over it. The grid is rebuilt
// only when the colliders change (machines placed, moved or sold, belts laid...).
import * as THREE from 'three';
import { LAYOUT } from '../data/config.js';

const CELL = 0.5;
const CLEARANCE = 0.42; // robot radius + a little margin
const STEP_HEIGHT = 0.35; // obstacles lower than this don't block (dock pads...)
const DIAG = Math.SQRT2;

export class Nav {
  constructor(game) {
    this.game = game;
    const F = LAYOUT.floor;
    this.x0 = F.minX;
    this.z0 = F.minZ;
    this.w = Math.ceil((F.maxX - F.minX) / CELL);
    this.h = Math.ceil((F.maxZ - F.minZ) / CELL);
    this.grid = new Uint8Array(this.w * this.h);
    this.version = -1;
  }

  refresh() {
    const v = this.game.colliders.version;
    if (v === this.version) return;
    this.version = v;
    this.grid.fill(0);
    const r = CLEARANCE;
    for (const b of this.game.colliders.boxes) {
      if (b.disabled || b.height <= STEP_HEIGHT) continue;
      const i0 = Math.max(0, Math.floor((b.minX - r - this.x0) / CELL));
      const i1 = Math.min(this.w - 1, Math.floor((b.maxX + r - this.x0) / CELL));
      const j0 = Math.max(0, Math.floor((b.minZ - r - this.z0) / CELL));
      const j1 = Math.min(this.h - 1, Math.floor((b.maxZ + r - this.z0) / CELL));
      for (let j = j0; j <= j1; j++) {
        const cz = this.z0 + (j + 0.5) * CELL;
        if (cz < b.minZ - r || cz > b.maxZ + r) continue;
        for (let i = i0; i <= i1; i++) {
          const cx = this.x0 + (i + 0.5) * CELL;
          if (cx >= b.minX - r && cx <= b.maxX + r) this.grid[j * this.w + i] = 1;
        }
      }
    }
    // keep the robots off the walls' edge cells
    for (let i = 0; i < this.w; i++) this.grid[i] = this.grid[(this.h - 1) * this.w + i] = 1;
    for (let j = 0; j < this.h; j++) this.grid[j * this.w] = this.grid[j * this.w + this.w - 1] = 1;
  }

  cellOf(p) {
    return [
      Math.min(this.w - 1, Math.max(0, Math.floor((p.x - this.x0) / CELL))),
      Math.min(this.h - 1, Math.max(0, Math.floor((p.z - this.z0) / CELL))),
    ];
  }

  center(i, j) {
    return new THREE.Vector3(this.x0 + (i + 0.5) * CELL, 0, this.z0 + (j + 0.5) * CELL);
  }

  blocked(i, j) {
    return i < 0 || j < 0 || i >= this.w || j >= this.h || this.grid[j * this.w + i] === 1;
  }

  // Is the world point on a free cell?
  isFree(p) {
    this.refresh();
    const [i, j] = this.cellOf(p);
    return !this.blocked(i, j);
  }

  // Closest free cell to (i, j), searching outwards up to `maxR` cells.
  nearestFree(i, j, maxR = 6) {
    if (!this.blocked(i, j)) return [i, j];
    for (let r = 1; r <= maxR; r++) {
      let best = null;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r || this.blocked(i + di, j + dj)) continue;
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            best = [i + di, j + dj];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // A* from `from` to `to` (world points). Returns world waypoints (smoothed), or null if unreachable.
  path(from, to) {
    this.refresh();
    const s = this.nearestFree(...this.cellOf(from), 3);
    const g = this.nearestFree(...this.cellOf(to), 4);
    if (!s || !g) return null;
    const W = this.w;
    const start = s[1] * W + s[0];
    const goal = g[1] * W + g[0];
    if (start === goal) return [this.center(g[0], g[1])];
    const n = this.w * this.h;
    const cost = new Float32Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const hEst = (k) => {
      const dx = Math.abs((k % W) - g[0]), dz = Math.abs(Math.floor(k / W) - g[1]);
      return Math.max(dx, dz) + (DIAG - 1) * Math.min(dx, dz);
    };
    cost[start] = 0;
    heap.push(start, hEst(start));
    let found = false;
    let expanded = 0;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      if (k === goal) {
        found = true;
        break;
      }
      if (++expanded > 6000) break; // safety cap
      closed[k] = 1;
      const i = k % W, j = Math.floor(k / W);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (this.blocked(ni, nj)) continue;
          // no cutting corners
          if (di && dj && (this.blocked(i + di, j) || this.blocked(i, j + dj))) continue;
          const nk = nj * W + ni;
          if (closed[nk]) continue;
          const c = cost[k] + (di && dj ? DIAG : 1);
          if (c < cost[nk]) {
            cost[nk] = c;
            prev[nk] = k;
            heap.push(nk, c + hEst(nk));
          }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = prev[k]) cells.push(k);
    cells.reverse();
    // string-pulling: keep only the cells we can't skip in a straight line
    const out = [];
    let anchor = 0;
    for (let k = 2; k < cells.length; k++) {
      if (!this.lineFree(cells[anchor], cells[k])) {
        anchor = k - 1;
        out.push(cells[anchor]);
      }
    }
    out.push(goal);
    return out.map((k) => this.center(k % W, Math.floor(k / W)));
  }

  // Straight segment between two cells crosses only free cells?
  lineFree(a, b) {
    const W = this.w;
    let x0 = a % W, y0 = Math.floor(a / W);
    const x1 = b % W, y1 = Math.floor(b / W);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      // check the cells the robot's body would touch
      if (this.blocked(Math.floor(x + 0.5), Math.floor(y + 0.5)) || this.blocked(Math.round(x), Math.round(y))) return false;
    }
    return true;
  }
}

class MinHeap {
  constructor() {
    this.k = [];
    this.p = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, pri) {
    const k = this.k, p = this.p;
    k.push(key);
    p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= p[i]) break;
      [k[up], k[i]] = [k[i], k[up]];
      [p[up], p[i]] = [p[i], p[up]];
      i = up;
    }
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
