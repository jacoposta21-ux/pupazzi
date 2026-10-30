// Axis-aligned boxes on the XZ plane with a height. Entities are vertical cylinders (circle + feet height).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Colliders {
  constructor() {
    this.boxes = [];
  }

  add(minX, maxX, minZ, maxZ, height = 99) {
    const box = { minX, maxX, minZ, maxZ, height };
    this.boxes.push(box);
    return box;
  }

  // Pushes the circle out of every box taller than `stepY`. Returns true if anything was hit.
  resolve(pos, r, stepY = 0) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.boxes) {
        if (stepY >= b.height) continue;
        const cx = clamp(pos.x, b.minX, b.maxX);
        const cz = clamp(pos.z, b.minZ, b.maxZ);
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          const pl = pos.x - b.minX, pr = b.maxX - pos.x, pb = pos.z - b.minZ, pf = b.maxZ - pos.z;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) pos.x = b.minX - r;
          else if (m === pr) pos.x = b.maxX + r;
          else if (m === pb) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
      }
    }
    return hit;
  }

  // Highest walkable surface under the circle that is not above `stepY`.
  groundHeight(pos, r, stepY) {
    let h = 0;
    const rr = r * 0.7;
    for (const b of this.boxes) {
      if (b.height > stepY || b.height <= h) continue;
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      if (dx * dx + dz * dz < rr * rr) h = b.height;
    }
    return h;
  }

  pointInside(x, z, y = 0) {
    for (const b of this.boxes) {
      if (y < b.height && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }
}
