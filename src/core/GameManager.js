// Orchestrates the game: menu / playing state, continuous truck deliveries, economy, factory level,
// missions, the shop terminal, build mode, nuggets & X-ray, saving. Systems talk through the EventBus.
import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import {
  SAVE_KEY, SETTINGS_KEY, LAYOUT, MAX_PLUSHIES, UPGRADES, QUALITY, UNLOCKS, COSMETICS, DEFAULT_EQUIP,
  PLACEABLES, LEGENDARY_WEAPONS, GOAL, XRAY_AD_SECONDS, GOLD_TRUCK_COUNT,
  computeStats, truckPlan, pickPlushieType, newSave, upgradeCost, placeableCost, levelFromEarned, levelValueMult,
} from '../data/config.js';
import { Platform } from '../systems/Platform.js';
import { Audio } from '../systems/Audio.js';
import { Input } from '../systems/Input.js';
import { Colliders } from '../world/Colliders.js';
import { buildFactory } from '../world/Factory.js';
import { Particles } from '../fx/Particles.js';
import { Conveyor } from '../entities/Conveyor.js';
import { Stuffer } from '../entities/Stuffer.js';
import { PlushieManager } from '../entities/Plushies.js';
import { Player } from '../entities/Player.js';
import { Truck } from '../entities/Truck.js';
import { createMachine } from '../entities/Machines.js';
import { Tutorial } from '../systems/Tutorial.js';
import { Missions } from '../systems/Missions.js';
import { BuildMode } from '../systems/BuildMode.js';
import { UI } from '../ui/UI.js';
import { Decor } from '../world/Decor.js';

const rand = (a, b) => a + Math.random() * (b - a);
// Test builds only (npm run build:cheats): bottomless cash and nuggets to try everything quickly.
const CHEATS = import.meta.env.VITE_CHEATS === '1';
const CHEAT_CASH = 1e12;
const CHEAT_NUGGETS = 9999;
const AUTOSAVE_EVERY = 15;
const SHUTTER_SPEED = 6;

export class GameManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.isTouch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
    // Meshes are always built shadow-ready; the quality preset decides if shadows render.
    this.shadows = true;
    this.state = 'loading';
    this.paused = false;
    this.shopOpen = false;
    this.time = 0;
    this.bus = new EventBus();
    this.solids = [];
    this.trucks = [];
    this.machines = [];
    this.lines = [];
    this.stuffers = [];
    this.data = newSave();
    this.stats = computeStats({});
    this.level = 1;
    this.xrayTimer = 0; // seconds of free X-ray from a rewarded ad
    this.xrayOn = false; // scanner toggled by the player
    this.goldTruckPending = false;
    this.settings = {
      sens: 1,
      muted: false,
      music: true,
      quality: this.isTouch ? 'low' : 'high',
      ...(Platform.load(SETTINGS_KEY) || {}),
    };
    if (!QUALITY[this.settings.quality]) this.settings.quality = 'high';
    Audio.setMuted(this.settings.muted);
    Audio.setMusicMuted(!this.settings.music);
    this.perf = { frames: 0, time: 0, checked: false };

    const r = new THREE.WebGLRenderer({ canvas, antialias: !this.isTouch, powerPreference: 'high-performance' });
    r.setSize(innerWidth, innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9cbe6);
    this.scene.fog = new THREE.Fog(0xa9cbe6, 45, 110);
    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.03, 200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.clock = new THREE.Clock();
    this.terminalPos = new THREE.Vector3(LAYOUT.terminal.x, 0, LAYOUT.terminal.z);

    addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') {
        this.pause();
        this.persist();
      }
    });
  }

  async init() {
    this.ui = new UI(this);
    // Canvas textures use the Fredoka font: make sure it's ready before drawing them.
    await Promise.race([document.fonts?.load('700 40px Fredoka'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
    await Platform.init();
    Platform.loadingStart();
    Platform.onAdStart = () => Audio.setAdMuted(true);
    Platform.onAdEnd = () => Audio.setAdMuted(false);

    this.colliders = new Colliders();
    const factory = buildFactory(this.scene, this.colliders, { shadows: this.shadows });
    this.solids.push(...factory.solids);
    this.sun = factory.sun;
    this.shutter = factory.shutter;
    this.shutterOpen = 0;
    this.applyQuality();
    this.particles = new Particles(this.scene);

    // The starter line is fixed; more lines are placed as machines.
    const ml = LAYOUT.mainLine;
    const mainConveyor = new Conveyor(this, {
      start: { x: ml.x + ml.out.x * 1.5, z: ml.z + ml.out.z * 1.5 },
      dir: ml.out,
      length: ml.beltLength,
      end: 'wall',
    });
    this.stuffer = new Stuffer(this, ml, mainConveyor);
    this.addLine({ stuffer: this.stuffer, conveyor: mainConveyor });

    this.decor = new Decor(this);
    this.plushies = new PlushieManager(this);
    this.player = new Player(this);
    this.input = new Input(this);
    this.tutorial = new Tutorial(this);
    this.missions = new Missions(this);
    this.build = new BuildMode(this);

    this.bus.on('canSold', ({ value, pos }) => {
      if (this.state !== 'playing') return;
      this.addEarnings(value);
      this.ui.floater(`+${this.ui.money(value)}`, pos);
      this.particles.burst(pos, { count: 6, color: 0xffd23f, speed: 1.5, size: 0.05 });
      Audio.play('cash');
    });
    this.bus.on('plushieStuffed', () => this.data.totals.stuffed++);
    this.bus.on('plushieKO', (p) => {
      this.data.totals.knockouts++;
      this.ui.floater('KO!', p.pos.clone().setY(1.4 * p.def.scale), 'ko');
      if (p.def.splitsInto) {
        Audio.play('pop');
        this.particles.burst(p.pos.clone().setY(0.8), { count: 18, color: p.def.accent, speed: 3, size: 0.07, up: 3 });
        this.plushies.split(p, this.level);
      }
    });
    this.bus.on('truckArrived', () => this.state === 'playing' && this.ui.toast('truckHere'));

    this.save = Platform.load(SAVE_KEY);
    this.toMenu();
    Platform.loadingStop();
    this.ui.hideLoading();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- Lines & machines ----------

  addLine(line) {
    this.lines.push(line);
    this.stuffers.push(line.stuffer);
    line.conveyor.setWrapper(this.stats.wrap);
    this.applyCosmetics?.();
  }

  removeLine(line) {
    this.lines = this.lines.filter((l) => l !== line);
    this.stuffers = this.stuffers.filter((s) => s !== line.stuffer);
  }

  get lures() {
    return this.machines.filter((m) => m.type === 'lure');
  }

  placeMachine(type, x, z, rot, fromSave = false) {
    const m = createMachine(this, type, x, z, rot);
    this.machines.push(m);
    if (!fromSave) {
      this.data.inventory[type]--;
      this.data.placed.push({ type, x, z, rot });
      this.particles.burst(new THREE.Vector3(x, 0.5, z), { count: 16, color: 0x5fe0b7, speed: 2.5, size: 0.06, up: 2 });
      Audio.play('place');
      this.persist();
    }
    this.applyCosmetics();
    return m;
  }

  pickUpMachine(m) {
    m.dispose();
    this.machines = this.machines.filter((x) => x !== m);
    const i = this.data.placed.findIndex((p) => p.type === m.type && p.x === m.pos.x && p.z === m.pos.z && p.rot === m.rot);
    if (i >= 0) this.data.placed.splice(i, 1);
    this.data.inventory[m.type] = (this.data.inventory[m.type] || 0) + 1;
    Audio.play('grab');
    this.persist();
  }

  clearMachines() {
    for (const m of this.machines) m.dispose();
    this.machines = [];
  }

  // ---------- Economy ----------

  // Every dollar earned counts towards the factory level and the $1M goal.
  addEarnings(v) {
    this.data.cash += v;
    this.data.earned += v;
    const L = levelFromEarned(this.data.earned);
    if (L > this.level) {
      this.level = L;
      this.ui.toast('levelUp', { n: L });
      Audio.play('fanfare');
      this.particles.burst(this.player.pos.clone().setY(2), { count: 30, color: 0xffd23f, speed: 3, size: 0.06, up: 3 });
    }
    if (!this.data.won && this.data.earned >= GOAL) {
      this.data.won = true;
      this.persist();
      this.showVictory();
    }
  }

  addNuggets(n) {
    this.data.nuggets += n;
    this.data.totals.nuggets = (this.data.totals.nuggets || 0) + n;
  }

  onNuggetFound(pos) {
    this.addNuggets(1);
    this.ui.toast('nuggetFound');
    this.ui.floater('💎 +1', pos, 'nugget');
    this.particles.burst(pos, { count: 20, color: 0xffd23f, speed: 2.5, size: 0.06, up: 2.5 });
    Audio.play('nugget');
    this.persist();
  }

  get xrayActive() {
    return this.xrayTimer > 0 || (this.xrayOn && !!this.data.unlocks.scanner);
  }

  buyUpgrade(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const lvl = this.data.levels[id] || 0;
    if (lvl >= u.max) return false;
    const cost = upgradeCost(u, lvl);
    if (this.data.cash < cost) return false;
    this.data.cash -= cost;
    this.data.levels[id] = lvl + 1;
    this.refreshStats();
    Audio.play('buy');
    this.persist();
    return true;
  }

  buyUnlock(id) {
    const u = UNLOCKS.find((x) => x.id === id);
    if (this.data.unlocks[id] || this.data.cash < u.cost) return false;
    this.data.cash -= u.cost;
    this.data.unlocks[id] = true;
    this.refreshStats();
    Audio.play('fanfare');
    this.persist();
    return true;
  }

  buyLegendaryWeapon(id) {
    const w = LEGENDARY_WEAPONS.find((x) => x.id === id);
    if (this.data.unlocks[id] || this.data.nuggets < w.nuggets) return false;
    this.data.nuggets -= w.nuggets;
    this.data.unlocks[id] = true;
    Audio.play('fanfare');
    this.persist();
    return true;
  }

  // Buying a machine puts it in the inventory; it's placed in build mode.
  buyPlaceable(id) {
    const def = PLACEABLES.find((x) => x.id === id);
    const cost = placeableCost(def, this.data.bought[id] || 0);
    if (def.nuggets) {
      if (this.data.nuggets < cost) return false;
      this.data.nuggets -= cost;
    } else {
      if (this.data.cash < cost) return false;
      this.data.cash -= cost;
    }
    this.data.bought[id] = (this.data.bought[id] || 0) + 1;
    this.data.inventory[id] = (this.data.inventory[id] || 0) + 1;
    Audio.play('buy');
    this.persist();
    return true;
  }

  // Buys a cosmetic, or equips / toggles it if already owned.
  buyCosmetic(id) {
    const c = COSMETICS.find((x) => x.id === id);
    const cos = this.data.cosmetics;
    const owned = c.cost === 0 || cos.owned.includes(id);
    if (!owned) {
      if (this.data.cash < c.cost) return false;
      this.data.cash -= c.cost;
      cos.owned.push(id);
      Audio.play('buy');
      if (c.slot === 'decor') cos.decor.push(id);
      else cos.equipped[c.slot] = id;
    } else if (c.slot === 'decor') {
      const i = cos.decor.indexOf(id);
      if (i >= 0) cos.decor.splice(i, 1);
      else cos.decor.push(id);
      Audio.play('click');
    } else {
      cos.equipped[c.slot] = id;
      Audio.play('click');
    }
    this.applyCosmetics();
    this.persist();
    return true;
  }

  // Rewarded ads (the only ads in the game).
  async watchAd(kind) {
    const ok = await Platform.ad('rewarded');
    if (!ok) return false;
    if (kind === 'xray') this.xrayTimer = XRAY_AD_SECONDS;
    else if (kind === 'goldTruck') this.goldTruckPending = true;
    else if (kind === 'cash') this.addEarnings(this.adCashReward);
    this.persist();
    return true;
  }

  get adCashReward() {
    return Math.round((levelValueMult(this.level) * 25 * (6 + this.level)) / 10) * 10;
  }

  refreshStats() {
    this.stats = computeStats(this.data.levels, this.data.unlocks);
    for (const l of this.lines) l.conveyor.setWrapper(this.stats.wrap);
  }

  applyCosmetics() {
    if (!this.player) return;
    const cos = this.data.cosmetics ?? newSave().cosmetics;
    const find = (id) => COSMETICS.find((c) => c.id === id);
    const gloves = find(cos.equipped.gloves) ?? find(DEFAULT_EQUIP.gloves);
    const skin = find(cos.equipped.blaster) ?? find(DEFAULT_EQUIP.blaster);
    const paint = find(cos.equipped.stuffer) ?? find(DEFAULT_EQUIP.stuffer);
    this.player.vm.applyGloves(gloves.color, gloves.metal);
    this.player.vm.applySkin(skin.colors, skin.metal);
    for (const s of this.stuffers) s.bodyMat.color.setHex(paint.color);
    this.decor.apply(cos.decor);
  }

  // ---------- State ----------

  resetWorld() {
    this.build?.exit();
    this.plushies.clear();
    this.player.carried.length = 0;
    this.player.carryAnchor.clear();
    this.clearMachines();
    for (const l of this.lines) {
      l.stuffer.reset();
      l.conveyor.flush();
    }
    for (const tr of this.trucks) tr.dispose();
    this.trucks = [];
    this.tutorial?.stop();
    this.missions?.reset();
    this.particles.clear();
    this.ui.clearFloaters();
    this.xrayTimer = 0;
    this.xrayOn = false;
    this.goldTruckPending = false;
  }

  // Builds the saved factory: machines, cosmetics, stats.
  loadWorld() {
    this.refreshStats();
    this.level = levelFromEarned(this.data.earned);
    for (const p of this.data.placed) this.placeMachine(p.type, p.x, p.z, p.rot, true);
    this.applyCosmetics();
  }

  toMenu() {
    if (this.state === 'playing') {
      Platform.gameplayStop();
      this.persist();
    }
    this.state = 'menu';
    this.paused = false;
    this.shopOpen = false;
    this.input?.exitLock();
    this.resetWorld();
    this.player.setViewmodelVisible(false);
    this.save = Platform.load(SAVE_KEY);
    // show the player's own factory behind the menu
    this.data = this.mergeSave(this.save ?? {});
    this.loadWorld();
    for (let i = 0; i < 10; i++) this.plushies.spawnWandering(pickPlushieType(Math.max(3, this.level)), 1);
    this.ui.showMenu(this.save);
    Audio.setMusicMood({ calm: true, duck: 1 });
  }

  // Merge onto a fresh save so older saves gain any new fields (v1 "day" saves included).
  mergeSave(save = {}) {
    const fresh = newSave();
    const data = {
      ...fresh,
      ...save,
      levels: { ...save.levels },
      unlocks: { ...save.unlocks },
      placed: [...(save.placed ?? [])],
      inventory: { ...save.inventory },
      bought: { ...save.bought },
      totals: { ...fresh.totals, ...save.totals },
      cosmetics: {
        owned: [...(save.cosmetics?.owned ?? [])],
        equipped: { ...DEFAULT_EQUIP, ...save.cosmetics?.equipped },
        decor: [...(save.cosmetics?.decor ?? [])],
      },
    };
    if (!save.version || save.version < 2) {
      // v1: the second line was an unlock, robots were an upgrade level
      data.earned = save.totals?.earned ?? data.cash;
      if (data.unlocks.line2) data.inventory.line = (data.inventory.line || 0) + 1;
      if (data.levels.robot) data.inventory.dock = (data.inventory.dock || 0) + data.levels.robot;
      delete data.unlocks.line2;
      delete data.levels.robot;
      delete data.levels.overtime;
      delete data.day;
      data.version = 2;
    }
    return data;
  }

  newGame() {
    this.data = newSave();
    this.resetWorld();
    this.loadWorld();
    this.startPlaying();
  }

  continueGame() {
    // the menu already built the saved factory
    this.plushies.clear();
    this.startPlaying();
  }

  // Keeps cash and nuggets topped up without touching lifetime earnings (level / goal stay honest).
  topUpCheats() {
    if (this.data.cash < CHEAT_CASH / 2) this.data.cash = CHEAT_CASH;
    if (this.data.nuggets < CHEAT_NUGGETS / 2) this.data.nuggets = CHEAT_NUGGETS;
  }

  startPlaying() {
    if (CHEATS) this.topUpCheats();
    this.refreshStats();
    this.level = levelFromEarned(this.data.earned);
    this.nextTruck = 3;
    this.autosave = AUTOSAVE_EVERY;
    this.player.respawn();
    this.player.refill();
    this.ui.shownCash = this.data.cash;
    Audio.setMusicMood({ calm: false, duck: 1 });
    if (!this.settings.tutorialSeen) this.tutorial.start();
    this.player.setViewmodelVisible(true);
    this.state = 'playing';
    this.ui.showGameplay();
    Platform.gameplayStart();
    if (this.isTouch) this.paused = false;
    else {
      this.paused = !this.input.locked;
      this.input.requestLock();
      this.ui.showPause(this.paused);
    }
  }

  // ---------- Shop terminal ----------

  openShop() {
    if (this.shopOpen) return;
    if (CHEATS) this.topUpCheats();
    this.shopOpen = true;
    this.paused = true;
    this.input.exitLock();
    this.ui.showShop(true);
    Audio.play('swap');
    Audio.setMusicMood({ duck: 0.6 });
    this.bus.emit('shopOpened');
  }

  closeShop() {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    this.ui.showShop(false);
    this.persist();
    Audio.setMusicMood({ duck: 1 });
    // jump straight into placing anything just bought
    if (this.build.inventoryTypes.length && !this.build.active) this.build.enter();
    this.resume();
  }

  onTutorialDone() {
    this.data.tutorialDone = true;
    this.settings.tutorialSeen = true;
    this.persist();
    this.saveSettings();
  }

  showVictory() {
    this.paused = true;
    this.input.exitLock();
    Audio.play('fanfare');
    Platform.happytime();
    this.ui.showVictory();
  }

  closeVictory() {
    this.ui.hideVictory();
    this.resume();
  }

  // ---------- Settings ----------

  setQuality(q) {
    this.settings.quality = q;
    this.applyQuality();
    this.saveSettings();
  }

  applyQuality() {
    const preset = QUALITY[this.settings.quality];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatio));
    this.renderer.setSize(innerWidth, innerHeight, false);
    if (this.renderer.shadowMap.enabled !== preset.shadows) {
      this.renderer.shadowMap.enabled = preset.shadows;
      this.sun.castShadow = preset.shadows;
      // materials must recompile when shadow support toggles
      this.scene.traverse((o) => {
        if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true;
      });
    }
  }

  // One-time automatic downgrade if the first seconds of play run badly.
  checkPerformance(dt) {
    const p = this.perf;
    if (p.checked) return;
    p.frames++;
    p.time += dt;
    if (p.time < 6) return;
    p.checked = true;
    const fps = p.frames / p.time;
    const order = ['low', 'medium', 'high'];
    const i = order.indexOf(this.settings.quality);
    if (fps < 30 && i > 0) {
      this.setQuality(order[i - 1]);
      this.ui.refreshSettings();
      this.ui.toast('perfLowered');
      if (i - 1 > 0) Object.assign(p, { frames: 0, time: 0, checked: false });
    }
  }

  persist() {
    if (this.state === 'menu' && !this.save) return; // nothing to save before the first game
    Platform.save(SAVE_KEY, this.data);
  }

  saveSettings() {
    Platform.save(SETTINGS_KEY, this.settings);
  }

  pause() {
    if (this.state !== 'playing' || this.shopOpen) return;
    this.paused = true;
    Audio.setMusicMood({ duck: 0.4 });
    this.input.exitLock();
    this.ui.showPause(true);
  }

  resume() {
    if (this.state !== 'playing') return;
    if (this.isTouch) {
      this.paused = false;
      this.ui.showPause(false);
      Audio.setMusicMood({ duck: 1 });
    } else {
      this.input.requestLock();
      // if the browser refuses the lock (no user gesture), show the click-to-play screen
      if (!this.input.locked) this.ui.showPause(true);
    }
  }

  onLockChange(locked) {
    if (this.state !== 'playing' || this.shopOpen || this.ui.victoryOpen) return;
    this.paused = !locked;
    this.ui.showPause(!locked);
    Audio.setMusicMood({ duck: locked ? 1 : 0.4 });
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  // ---------- Frame ----------

  frame() {
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    if (this.state === 'playing' && !this.paused) this.checkPerformance(raw);
    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'playing' && !this.paused) this.updatePlaying(dt);
    this.particles.update(dt);
    this.ui.updateFloaters(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  plushieCtx(withPlayer) {
    return {
      player: withPlayer ? this.player : null,
      colliders: this.colliders,
      stuffers: this.stuffers,
      lures: this.lures,
      time: this.time,
      particles: this.particles,
      xray: withPlayer && this.xrayActive,
    };
  }

  updateMenu(dt) {
    const a = this.time * 0.08;
    this.camera.position.set(Math.sin(a) * 13, 6.5, 6 + Math.cos(a) * 13);
    this.camera.lookAt(-2, 1, 2);
    this.plushies.update(dt, this.plushieCtx(false));
    this.updateLines(dt);
  }

  updatePlaying(dt) {
    this.tutorial.update(dt);
    this.missions.update(dt);
    if (this.xrayTimer > 0) this.xrayTimer = Math.max(0, this.xrayTimer - dt);
    if (this.input.xrayPressed) this.toggleXray();

    // Continuous deliveries: one truck at a time; the next one is scheduled once it has left.
    const busy = this.trucks.some((t) => t.state !== 'leaving' && t.state !== 'done');
    const full = this.plushies.count >= MAX_PLUSHIES;
    if (!busy && !full && (!this.tutorial.active || this.tutorial.step === 'wait')) this.nextTruck -= dt;
    if (this.goldTruckPending && !busy) this.nextTruck = Math.min(this.nextTruck, 0);
    if (this.nextTruck <= 0 && !busy) {
      const plan = truckPlan(this.level, this.stats.supply);
      const golden = this.goldTruckPending;
      this.goldTruckPending = false;
      const count = golden ? GOLD_TRUCK_COUNT : this.tutorial.active ? 4 : plan.count;
      this.trucks.push(new Truck(this, count, (from, g) => this.unloadPlushie(from, g), { golden }));
      this.nextTruck = plan.interval;
    }

    this.player.update(dt, this.input);
    this.plushies.update(dt, this.plushieCtx(true));
    for (const m of this.machines) m.update(dt);
    this.updateLines(dt);
    this.decor.update(dt);
    for (const tr of this.trucks) tr.update(dt);
    this.trucks = this.trucks.filter((tr) => {
      if (tr.state === 'done') tr.dispose();
      return tr.state !== 'done';
    });
    this.updateShutter(dt);

    if (CHEATS) this.topUpCheats();
    this.autosave -= dt;
    if (this.autosave <= 0) {
      this.autosave = AUTOSAVE_EVERY;
      this.persist();
    }
    this.ui.updateHud();
  }

  toggleXray() {
    if (!this.data.unlocks.scanner) {
      this.ui.toast(this.xrayTimer > 0 ? 'xrayAdActive' : 'xrayNeedScanner');
      return;
    }
    this.xrayOn = !this.xrayOn;
    Audio.play(this.xrayOn ? 'xrayOn' : 'click');
  }

  // The shutter is open while a truck is pulling in or unloading.
  updateShutter(dt) {
    const want = this.trucks.some((t) => t.state === 'unloading' || (t.state === 'arriving' && t.mesh.position.x > -25)) ? 1 : 0;
    const prev = this.shutterOpen;
    this.shutterOpen += Math.sign(want - this.shutterOpen) * Math.min(Math.abs(want - this.shutterOpen), dt * (SHUTTER_SPEED / LAYOUT.door.height));
    if ((prev === 0 && this.shutterOpen > 0) || (prev === 1 && this.shutterOpen < 1)) Audio.play('shutter');
    const D = LAYOUT.door;
    this.shutter.position.y = D.height / 2 + this.shutterOpen * (D.height - 0.3);
  }

  updateLines(dt) {
    for (const l of this.lines) {
      l.stuffer.update(dt);
      l.conveyor.update(dt, this.stats.beltSpeed);
    }
  }

  unloadPlushie(from, golden) {
    if (this.plushies.count >= MAX_PLUSHIES) return;
    // the tutorial truck brings only teddies
    const type = golden ? 'golden' : this.tutorial.active ? 'teddy' : pickPlushieType(this.level);
    const p = this.plushies.spawn(type, this.level);
    const D = LAYOUT.door;
    const to = new THREE.Vector3(D.x + rand(-D.halfWidth + 0.8, D.halfWidth - 0.8), 0, LAYOUT.floor.maxZ - rand(2.5, 5));
    p.startHop(from, to);
  }
}
