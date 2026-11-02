// Arena mode: a mini-game started from the arcade console in the factory.
// Plushies jump in through four gates in rounds and attack the Stuffer in the middle; popped plushies
// burst into cotton and pay arena coins, spent at the shop stall between rounds (30 s breaks).
// Every 5th round brings a boss (worth a gold nugget for the factory); a short ad break every 7 rounds.
// Losing ends the run; a rewarded video replays the round you lost.
import * as THREE from 'three';
import { ARENA, ARENA_SHOP, arenaItem, arenaCost, repairCost, pickArenaType, newArenaRun } from '../data/config.js';
import { buildArena, GATES, ARENA_CORE, ARENA_SPAWN, ARENA_SHOP_POS } from '../world/ArenaWorld.js';
import { Stuffer } from '../entities/Stuffer.js';
import { Platform } from './Platform.js';
import { Audio } from './Audio.js';

const CHEATS = import.meta.env.VITE_CHEATS === '1';
const F_MARGIN = 1.2;
const _d = new THREE.Vector3();
const COTTON = [0xffffff, 0xf4f1ea, 0xfff6e8];

export class Arena {
  constructor(game) {
    this.game = game;
    this.world = null;
    this.phase = 'off'; // off | intro | round | break | over
    this.round = 0;
    this.timer = 0;
    this.adPlaying = false;
    this.corePos = new THREE.Vector3(ARENA_CORE.x, 0, ARENA_CORE.z);
    this.shopPos = new THREE.Vector3(ARENA_SHOP_POS.x, 0, ARENA_SHOP_POS.z);
  }

  get active() {
    return this.phase !== 'off';
  }

  // Shop opens between rounds only.
  get shopAvailable() {
    return this.phase === 'intro' || this.phase === 'break';
  }

  get coreMax() {
    return ARENA.coreHp + ARENA.coreHpStep * (this.game.data.levels.coreHp || 0);
  }

  get isBossRound() {
    return this.round > 0 && this.round % ARENA.bossEvery === 0;
  }

  // ---------- World ----------

  open() {
    const game = this.game;
    this.world = buildArena(game.scene, game.colliders, { shadows: game.shadows });
    game.solids.push(...this.world.solids);
    // the Stuffer to defend: just the machine, it doesn't process anything here
    this.core = new Stuffer(game, { x: ARENA_CORE.x, z: ARENA_CORE.z, out: { x: 0, z: 1 } });
    this.buildHpBar();
    this.newRun();
  }

  close() {
    this.phase = 'off';
    this.adPlaying = false;
    this.core?.dispose();
    this.core = null;
    this.hpBar?.removeFromParent();
    this.world?.root.removeFromParent();
    this.world = null;
    this.boss = null;
  }

  buildHpBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.26), new THREE.MeshBasicMaterial({ color: 0x2a2140, depthWrite: false }));
    this.hpFillMat = new THREE.MeshBasicMaterial({ color: 0x5fe0b7, depthWrite: false });
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.18), this.hpFillMat);
    this.hpFill.position.z = 0.01;
    g.add(bg, this.hpFill);
    g.position.set(ARENA_CORE.x, 4.2, ARENA_CORE.z);
    this.game.scene.add(g);
    this.hpBar = g;
  }

  // Keep a point inside the lawn (and out of the hedges).
  clampInside(v) {
    const F = { minX: -18 + F_MARGIN, maxX: 18 - F_MARGIN, minZ: -14 + F_MARGIN, maxZ: 24 - F_MARGIN };
    v.x = THREE.MathUtils.clamp(v.x, F.minX, F.maxX);
    v.z = THREE.MathUtils.clamp(v.z, F.minZ, F.maxZ);
    if (this.game.colliders.pointInside(v.x, v.z)) v.set(v.x * 0.8, 0, v.z * 0.8);
    return v;
  }

  // ---------- Run flow ----------

  newRun() {
    const game = this.game;
    game.clearMachines();
    game.plushies.clear();
    game.data = newArenaRun();
    game.refreshStats();
    this.round = 0;
    this.kills = 0;
    this.coins = 0;
    this.coreHp = this.coreMax;
    this.goldens = [];
    this.boss = null;
    this.retried = false;
    this.phase = 'intro';
    this.timer = ARENA.introTime;
    game.player.respawn(ARENA_SPAWN, 0);
    game.player.carried.length = 0;
    game.player.weapons.current = 'blaster';
    game.player.weapons.select('blaster', true);
    game.player.refill();
    game.ui.arenaBanner('arenaWelcome', 'arenaWelcomeSub');
    const career = game.career;
    career.arena.runs = (career.arena.runs || 0) + 1;
    game.persist();
  }

  startRound(retry = false) {
    const game = this.game;
    if (!retry) this.round++;
    const r = this.round;
    // ad break on the way back into the action (every 7 rounds; every round on Poki, which sets its own pace)
    if (!retry && r > 1 && (r - 1) % Platform.arenaBreakEvery === 0 && Platform.hasAds) {
      this.adPlaying = true;
      Platform.ad('midgame').finally(() => (this.adPlaying = false));
    }
    this.phase = 'round';
    this.roundTime = 0;
    this.toSpawn = ARENA.count(r);
    this.spawnT = 1.2;
    this.bossPending = this.isBossRound;
    if (this.bossPending) this.toSpawn = Math.round(this.toSpawn * 0.5);
    this.goldenAt = r >= 3 && Math.random() < ARENA.goldenChance ? 5 + Math.random() * 15 : -1;
    const career = game.career;
    if (r > (career.arena.best || 0)) {
      career.arena.best = r;
      game.persist();
    }
    game.ui.arenaBanner(this.bossPending ? 'bossRound' : 'roundN', this.bossPending ? 'bossRoundSub' : 'roundSub', { n: r });
    Audio.play(this.bossPending ? 'boss' : 'roundStart');
    Audio.setMusicMood({ calm: false, duck: 1 });
  }

  roundCleared() {
    const game = this.game;
    const bonus = ARENA.clearBonus(this.round);
    this.earn(bonus);
    game.ui.arenaBanner('roundClear', 'roundClearSub', { n: this.round, v: bonus });
    Audio.play('fanfare');
    this.phase = 'break';
    this.timer = ARENA.breakTime;
    game.player.refill();
  }

  gameOver() {
    const game = this.game;
    this.phase = 'over';
    const at = this.corePos.clone().setY(1.5);
    for (let i = 0; i < 4; i++) game.particles.burst(at, { count: 30, color: COTTON[i % 3], speed: 6, size: 0.12, up: 5, life: 1.4, gravity: 4, soft: true });
    game.particles.burst(at, { count: 30, color: 0xff6b8b, speed: 5, size: 0.08, up: 4 });
    Audio.play('boom');
    this.core.group.visible = false;
    const career = game.career;
    const record = this.round >= (career.arena.best || 0);
    game.persist();
    // a beat to watch the Stuffer pop, then the results
    setTimeout(() => game.showArenaOver({ round: this.round, kills: this.kills, coins: this.coins, best: career.arena.best, record }), 1200);
  }

  // Rewarded video: replay the round that was lost, with the Stuffer repaired.
  async retryRound() {
    const game = this.game;
    const ok = CHEATS || (await Platform.ad('rewarded'));
    if (!ok) {
      if (!Platform.silentAds) game.ui.toast('adFailed');
      return false;
    }
    for (const p of [...game.plushies.list]) game.plushies.remove(p);
    this.goldens = [];
    this.boss = null;
    this.core.group.visible = true;
    this.coreHp = this.coreMax;
    this.phase = 'retry';
    this.timer = ARENA.retryTime;
    game.player.refill();
    game.ui.arenaBanner('retryTitle', 'retrySub', { n: this.round });
    return true;
  }

  restartRun() {
    this.core.group.visible = true;
    this.newRun();
  }

  earn(v) {
    this.game.data.cash += v;
    this.coins += v;
  }

  // ---------- Frame ----------

  update(dt, input) {
    const game = this.game;
    this.animate(dt);
    if (this.phase === 'intro' || this.phase === 'break' || this.phase === 'retry') {
      this.timer -= dt;
      if (input.readyPressed && this.phase !== 'retry') this.timer = 0;
      if (this.timer <= 0) this.startRound(this.phase === 'retry');
    } else if (this.phase === 'round') this.updateRound(dt);
    // golden runners leave after a while
    for (const g of [...this.goldens]) {
      g.t -= dt;
      if (g.p.state === 'gone') this.goldens.splice(this.goldens.indexOf(g), 1);
      else if (g.t <= 0) {
        game.particles.burst(g.p.pos.clone().setY(0.5), { count: 14, color: 0xffd23f, speed: 2, size: 0.06, up: 2 });
        game.plushies.remove(g.p);
        this.goldens.splice(this.goldens.indexOf(g), 1);
      }
    }
  }

  // While the shop is open the world is frozen, but the break keeps counting down.
  tickShop(dt) {
    if (this.phase !== 'intro' && this.phase !== 'break') return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.game.closeShop();
      this.startRound();
    }
  }

  animate(dt) {
    const w = this.world;
    if (!w) return;
    for (const p of w.portals) {
      p.tex.rotation += dt * (1.2 + p.flash * 6);
      p.flash = Math.max(0, p.flash - dt * 1.5);
      p.mesh.material.opacity = 0.75 + p.flash * 0.25;
    }
    w.closedSign.visible = !this.shopAvailable;
    this.core.update(dt);
    // Stuffer health bar, always facing the camera
    const k = Math.max(0, this.coreHp / this.coreMax);
    this.hpFill.scale.x = Math.max(0.001, k);
    this.hpFill.position.x = -1.25 * (1 - k);
    this.hpFillMat.color.setHex(k > 0.5 ? 0x5fe0b7 : k > 0.25 ? 0xffd23f : 0xff4d4d);
    this.hpBar.quaternion.copy(this.game.camera.quaternion);
    this.hpBar.visible = this.phase !== 'over';
    this.flash = Math.max(0, (this.flash ?? 0) - dt * 3);
    this.core.bodyMat.emissive.setHex(0xff0000);
    this.core.bodyMat.emissiveIntensity = this.flash * 0.6;
  }

  updateRound(dt) {
    const game = this.game;
    const r = this.round;
    this.roundTime += dt;
    let alive = 0;
    for (const p of game.plushies.list) if (p.arena) alive++;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.toSpawn > 0 && alive < ARENA.maxAlive(r)) {
      this.spawn(pickArenaType(r));
      this.toSpawn--;
      this.spawnT = ARENA.spawnGap(r) * (0.7 + Math.random() * 0.6);
    }
    if (this.bossPending && this.roundTime > 3) {
      this.bossPending = false;
      const type = ARENA.bosses[(Math.floor(r / ARENA.bossEvery) - 1) % ARENA.bosses.length];
      this.boss = this.spawn(type);
      game.ui.arenaBanner('bossHere', 'p_' + type);
      Audio.play('boss');
    }
    if (this.goldenAt > 0 && this.roundTime > this.goldenAt) {
      this.goldenAt = -1;
      const g = this.spawn('golden');
      this.goldens.push({ p: g, t: 20 });
      game.ui.toast('goldenHere');
    }
    if (this.toSpawn === 0 && !this.bossPending && alive === 0) this.roundCleared();
  }

  // A plushie jumps in through a gate (random unless given).
  spawn(type, gate = null) {
    const game = this.game;
    const r = this.round;
    const g = gate ?? GATES[Math.floor(Math.random() * GATES.length)];
    const p = game.plushies.spawn(type, 1);
    const mult = ARENA.hpMult(r) * (p.def.boss ? ARENA.bossHpMult(r) : 1);
    p.maxHp = p.hp = Math.max(1, Math.round(p.def.hp * mult));
    if (p.def.armor) p.armor = p.maxArmor = Math.round(p.def.armor * mult);
    p.arena = type !== 'golden'; // the golden one just runs around
    p.noGrab = true;
    p.speedMult = ARENA.speedMult(r);
    const side = (Math.random() - 0.5) * 3;
    const tx = g.out.x === 0 ? side : 0, tz = g.out.x === 0 ? 0 : side;
    const from = new THREE.Vector3(g.x + g.out.x * 3, 0.6, g.z + g.out.z * 3);
    const to = new THREE.Vector3(g.x - g.out.x * (3 + p.radius) + tx, 0, g.z - g.out.z * (3 + p.radius) + tz);
    p.startHop(from, to, 1);
    const portal = this.world.portals.find((x) => x.gate === g);
    if (portal) portal.flash = 1;
    return p;
  }

  // ---------- Attackers ----------

  // Distance from a plushie's edge to the Stuffer's box.
  coreGap(p) {
    const b = this.core.bounds;
    const dx = Math.max(b.minX - p.pos.x, 0, p.pos.x - b.maxX);
    const dz = Math.max(b.minZ - p.pos.z, 0, p.pos.z - b.maxZ);
    return Math.hypot(dx, dz) - p.radius;
  }

  // Moves an attacker towards the Stuffer (A* around obstacles) and hits it once there. Returns its speed.
  drive(p, dt) {
    const game = this.game;
    if (this.phase === 'over') {
      p.state = 'attack';
      return 0;
    }
    const c = this.corePos;
    if (this.coreGap(p) < 0.45) {
      p.state = 'attack';
      p.heading = Math.atan2(c.x - p.pos.x, c.z - p.pos.z);
      p.attackT = (p.attackT ?? 0.4) - dt;
      if (p.attackT <= 0) {
        p.attackT = ARENA.attackGap;
        p.squash = 1;
        if (p.def.fuse) this.bomberBlow(p);
        else this.hitCore(ARENA.dmg[p.type] ?? 3, p);
      }
      return 0.3;
    }
    p.state = 'charge';
    let speed = (ARENA.speed[p.type] ?? 2) * (p.speedMult ?? 1);
    for (const m of game.machines) if (m.type === 'glue') speed *= m.slows(p.pos);

    // where to go: a waypoint of the A* path, or straight at the Stuffer
    p.repath = (p.repath ?? 0) - dt;
    const big = p.radius > 0.6; // bosses push their way straight through
    if (!big && (!p.path || p.repath <= 0 || p.navV !== game.colliders.version)) {
      _d.subVectors(p.pos, c).setY(0).normalize();
      const goal = c.clone().addScaledVector(_d, 2.3);
      p.path = game.nav.path(p.pos, goal);
      p.wp = 0;
      p.repath = 2.5 + Math.random();
      p.navV = game.colliders.version;
    }
    let target = c;
    if (!big && p.path) {
      while (p.wp < p.path.length && Math.hypot(p.path[p.wp].x - p.pos.x, p.path[p.wp].z - p.pos.z) < 0.5) p.wp++;
      if (p.wp < p.path.length) target = p.path[p.wp];
    }
    _d.set(target.x - p.pos.x, 0, target.z - p.pos.z);
    if (_d.lengthSq() < 1e-4) _d.set(c.x - p.pos.x, 0, c.z - p.pos.z);
    _d.normalize();

    // stuck against something? sidestep for a moment
    p.stuckT = (p.stuckT ?? 0) + dt;
    if (p.stuckT > 1) {
      if (p.lastPos && p.lastPos.distanceTo(p.pos) < 0.25 && p.state === 'charge') {
        p.sidestep = 0.8;
        p.sideDir = Math.random() < 0.5 ? 1 : -1;
        p.repath = 0;
      }
      p.lastPos = (p.lastPos ?? new THREE.Vector3()).copy(p.pos);
      p.stuckT = 0;
    }
    if (p.sidestep > 0) {
      p.sidestep -= dt;
      const sx = -_d.z * p.sideDir, sz = _d.x * p.sideDir;
      _d.set(_d.x * 0.3 + sx, 0, _d.z * 0.3 + sz).normalize();
    }
    p.steer(_d, speed, dt);
    return speed;
  }

  hitCore(dmg, p = null) {
    const game = this.game;
    if (this.phase !== 'round' || this.coreHp <= 0) return;
    this.coreHp -= dmg;
    this.flash = 1;
    this.core.shake = 0.3;
    const at = p ? p.pos.clone().lerp(this.corePos, 0.4).setY(1) : this.corePos.clone().setY(1.5);
    game.particles.burst(at, { count: 6, color: 0xffffff, speed: 2, size: 0.06, up: 2 });
    const now = performance.now();
    if (!this.lastHitSound || now - this.lastHitSound > 120) {
      this.lastHitSound = now;
      Audio.play('coreHit');
    }
    if (this.coreHp <= this.coreMax * 0.25 && !this.warned) {
      this.warned = true;
      game.ui.toast('coreLow');
    }
    if (this.coreHp > this.coreMax * 0.25) this.warned = false;
    if (this.coreHp <= 0) {
      this.coreHp = 0;
      this.gameOver();
    }
  }

  // A firecracker pup reached the Stuffer: big damage, no coins.
  bomberBlow(p) {
    const game = this.game;
    const at = p.pos.clone().setY(0.6);
    game.plushies.remove(p);
    this.boom(at);
    this.hitCore(ARENA.dmg.bomber, null);
  }

  boom(at, radius = 2.5) {
    const game = this.game;
    game.particles.burst(at, { count: 30, color: 0xffd23f, speed: radius * 2, size: 0.07, up: 3 });
    game.particles.burst(at, { count: 20, color: 0xff6b8b, speed: radius * 1.6, size: 0.06, up: 2.5 });
    game.particles.burst(at, { count: 14, color: 0x5fe0b7, speed: radius * 1.6, size: 0.05, up: 2.5 });
    Audio.play('boom');
  }

  // Area damage (mines, firecracker pups popped early).
  blast(at, radius, dmg) {
    const game = this.game;
    this.boom(at, radius);
    for (const p of [...game.plushies.list]) {
      if (!p.targetable) continue;
      const d = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
      if (d > radius + p.radius) continue;
      const result = p.takeHit(dmg, at);
      game.player.weapons.applyHit(p, result, p.pos.clone().setY(0.6 * p.def.scale), { quiet: true });
    }
  }

  // A plushie was knocked out: it bursts into cotton and pays coins.
  onKO(p) {
    const game = this.game;
    if (p.state === 'gone') return;
    const s = p.def.scale;
    const at = p.pos.clone().setY(p.pos.y + 0.5 * s);
    game.plushies.remove(p);
    for (let i = 0; i < 3; i++) game.particles.burst(at, { count: Math.round(8 * s), color: COTTON[i], speed: 3 * s, size: 0.08 * Math.sqrt(s), up: 3, life: 1.1, gravity: 3, soft: true });
    game.particles.burst(at, { count: Math.round(6 * s), color: p.def.color, speed: 2.5 * s, size: 0.06, up: 2.5 });
    Audio.play('poof');
    const coins = ARENA.coins[p.type] ?? 10;
    this.earn(coins);
    this.kills++;
    game.data.totals.knockouts++;
    game.ui.floater(`+🪙${coins}`, at.clone().setY(at.y + 0.6), 'coin');
    if (p.def.boss) this.bossDefeated(p, at);
    if (p.def.fuse) this.blast(at, 2.5, 3);
    if (p.def.splitsInto) {
      for (let i = 0; i < p.def.splitCount; i++) {
        const c = this.spawnChild(p.def.splitsInto, at);
        const a = (i / p.def.splitCount) * Math.PI * 2 + Math.random();
        const to = this.clampInside(new THREE.Vector3(at.x + Math.cos(a) * 2 * s, 0, at.z + Math.sin(a) * 2 * s));
        c.startHop(at.clone(), to, 0.6);
      }
    }
  }

  spawnChild(type, at) {
    const game = this.game;
    const c = game.plushies.spawn(type, 1);
    c.maxHp = c.hp = Math.max(1, Math.round(c.def.hp * ARENA.hpMult(this.round)));
    c.arena = true;
    c.noGrab = true;
    c.speedMult = ARENA.speedMult(this.round);
    c.pos.copy(at);
    return c;
  }

  // Boss down: a gold nugget for the factory (career save), counted at once.
  bossDefeated(p, at) {
    const game = this.game;
    if (this.boss === p) this.boss = null;
    const career = game.career;
    career.nuggets += 1;
    career.totals.nuggets = (career.totals.nuggets || 0) + 1;
    career.arena.bosses = (career.arena.bosses || 0) + 1;
    game.persist();
    game.ui.floater('💎 +1', at.clone().setY(at.y + 1.4), 'nugget');
    game.ui.arenaBanner('bossDown', 'bossDownSub');
    Platform.happytime();
    Audio.play('nugget');
    game.particles.burst(at, { count: 40, color: 0xffd23f, speed: 4, size: 0.08, up: 4 });
  }

  // ---------- Shop ----------

  priceOf(item) {
    const D = this.game.data;
    if (item.kind === 'repair') return repairCost(Math.max(1, this.round));
    if (item.kind === 'upgrade') return arenaCost(item, D.levels[item.id] || 0);
    if (item.kind === 'placeable') return arenaCost(item, D.bought[item.id] || 0);
    return item.cost;
  }

  // Can this be bought right now? (not counting money)
  available(item) {
    const D = this.game.data;
    if (item.kind === 'repair') return this.coreHp < this.coreMax;
    if (item.kind === 'upgrade') return (D.levels[item.id] || 0) < item.max;
    if (item.kind === 'weapon') return !D.unlocks[item.id];
    return true;
  }

  buy(id) {
    const game = this.game;
    const D = game.data;
    const item = arenaItem(id);
    const cost = this.priceOf(item);
    if (!this.available(item) || D.cash < cost) return false;
    D.cash -= cost;
    if (item.kind === 'repair') this.coreHp = Math.min(this.coreMax, this.coreHp + this.coreMax * 0.5);
    else if (item.kind === 'upgrade') {
      D.levels[id] = (D.levels[id] || 0) + 1;
      if (id === 'coreHp') this.coreHp += ARENA.coreHpStep;
      game.refreshStats();
    } else if (item.kind === 'weapon') {
      D.unlocks[id] = true;
      const W = game.player.weapons;
      if (id in W.ammo) W.ammo[id] = W.mag(id);
      W.select(id, true);
    } else {
      D.bought[id] = (D.bought[id] || 0) + 1;
      D.inventory[id] = (D.inventory[id] || 0) + 1;
      game.lastBought = id;
    }
    Audio.play(item.kind === 'weapon' ? 'fanfare' : 'buy');
    return true;
  }

  // Selling a placed defence back gives half of what the last one cost.
  resale(type) {
    const item = arenaItem(type);
    const n = Math.max(0, (this.game.data.bought[type] || 0) - 1);
    return Math.round(arenaCost(item, n) * 0.5);
  }

  get shopItems() {
    return ARENA_SHOP;
  }
}
