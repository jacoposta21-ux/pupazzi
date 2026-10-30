// Orchestrates the game: state machine (menu / playing / dayend), the workday timer,
// truck schedule, economy and saving. Systems communicate through the EventBus.
import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import {
  SAVE_KEY, SETTINGS_KEY, LAYOUT, MAX_PLUSHIES, QUOTA_BONUS, UPGRADES, QUALITY,
  computeStats, dayPlan, dayQuota, pickPlushieType, newSave, upgradeCost,
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
import { Robot } from '../entities/Robot.js';
import { Tutorial } from '../systems/Tutorial.js';
import { UI } from '../ui/UI.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class GameManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.isTouch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
    // Meshes are always built shadow-ready; the quality preset decides if shadows render.
    this.shadows = true;
    this.state = 'loading';
    this.paused = false;
    this.time = 0;
    this.bus = new EventBus();
    this.solids = [];
    this.trucks = [];
    this.robots = [];
    this.truckSchedule = [];
    this.data = newSave();
    this.stats = computeStats({});
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

    addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
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
    this.applyQuality();
    this.particles = new Particles(this.scene);
    this.conveyor = new Conveyor(this);
    this.stuffer = new Stuffer(this);
    this.plushies = new PlushieManager(this);
    this.player = new Player(this);
    this.input = new Input(this);
    this.tutorial = new Tutorial(this);

    this.bus.on('canSold', ({ value, pos }) => {
      if (this.state !== 'playing') return;
      this.data.cash += value;
      this.dayStats.earned += value;
      this.dayStats.shipped += value;
      this.ui.floater(`+$${value}`, pos);
      this.particles.burst(pos, { count: 6, color: 0xffd23f, speed: 1.5, size: 0.05 });
      Audio.play('cash');
      if (!this.dayStats.quotaToastShown && this.dayStats.earned >= this.quota) {
        this.dayStats.quotaToastShown = true;
        this.ui.toast('quotaMet', { b: Math.round(this.quota * QUOTA_BONUS) });
        Platform.happytime();
      }
    });
    this.bus.on('plushieStuffed', () => this.dayStats && this.dayStats.stuffed++);
    this.bus.on('plushieKO', (p) => {
      this.dayStats.knockouts++;
      this.ui.floater('KO!', p.pos.clone().setY(1.4 * p.def.scale), 'ko');
      if (p.def.splitsInto) {
        Audio.play('pop');
        this.particles.burst(p.pos.clone().setY(0.8), { count: 18, color: p.def.accent, speed: 3, size: 0.07, up: 3 });
        this.plushies.split(p, this.data.day);
      }
    });
    this.bus.on('truckArrived', () => this.state === 'playing' && this.ui.toast('truckHere'));

    this.save = Platform.load(SAVE_KEY);
    this.toMenu();
    Platform.loadingStop();
    this.ui.hideLoading();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- State transitions ----------

  resetWorld() {
    this.plushies.clear();
    this.player.carried.length = 0;
    this.player.carryAnchor.clear();
    this.stuffer.reset();
    this.conveyor.flush();
    for (const tr of this.trucks) tr.dispose();
    this.trucks = [];
    this.truckSchedule = [];
    this.disposeRobots();
    this.tutorial?.stop();
    this.particles.clear();
    this.ui.clearFloaters();
  }

  toMenu() {
    if (this.state === 'playing') Platform.gameplayStop();
    this.state = 'menu';
    this.paused = false;
    this.input?.exitLock();
    this.resetWorld();
    this.player.setViewmodelVisible(false);
    this.save = Platform.load(SAVE_KEY);
    // decorative plushies wandering around behind the menu
    for (let i = 0; i < 10; i++) this.plushies.spawnWandering(pickPlushieType(3), 1);
    this.ui.showMenu(this.save);
    Audio.setMusicMood({ calm: true, duck: 1 });
  }

  newGame() {
    this.data = newSave();
    this.resetWorld();
    this.startDay();
  }

  continueGame() {
    this.data = { ...newSave(), ...this.save };
    this.resetWorld();
    this.startDay();
  }

  startDay() {
    this.stats = computeStats(this.data.levels);
    this.quota = dayQuota(this.data.day);
    this.timeLeft = this.stats.dayLength;
    this.dayTime = 0;
    this.lastTick = 11;
    this.dayStats = { stuffed: 0, earned: 0, shipped: 0, knockouts: 0, doubled: false, quotaToastShown: false };

    const plan = dayPlan(this.data.day, this.stats.supply);
    const interval = Math.max(8, (this.stats.dayLength - 25) / plan.trucks);
    this.truckSchedule = [];
    for (let i = 0; i < plan.trucks; i++) this.truckSchedule.push({ at: 3 + i * interval, count: plan.perTruck });

    this.trucksSpawned = 0;
    this.syncRobots();
    this.player.respawn();
    this.player.refill();
    this.ui.shownCash = this.data.cash;
    Audio.setMusicMood({ calm: false, duck: 1 });
    if (!this.settings.tutorialSeen && this.data.day === 1) this.tutorial.start();
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

  endDay() {
    this.state = 'dayend';
    Platform.gameplayStop();
    this.input.exitLock();
    this.tutorial.stop();
    this.disposeRobots();
    Audio.setMusicMood({ calm: true, duck: 1 });

    const flushed = this.stuffer.flush() + this.conveyor.flush();
    const ds = this.dayStats;
    ds.earned += flushed;
    const quotaMet = ds.earned >= this.quota;
    const bonus = quotaMet ? Math.round(this.quota * QUOTA_BONUS) : 0;
    this.data.cash += flushed + bonus;
    const T = this.data.totals;
    T.stuffed += ds.stuffed;
    T.earned += ds.earned + bonus;
    T.knockouts = (T.knockouts || 0) + ds.knockouts;
    const record = ds.earned > (T.bestDay || 0);
    if (record) T.bestDay = ds.earned;
    Audio.play(quotaMet ? 'fanfare' : 'bell');

    // Trucks that didn't make it today are cancelled; plushies still in the factory stay for tomorrow.
    for (const tr of this.trucks) tr.dispose();
    this.trucks = [];
    this.truckSchedule = [];
    this.player.dropAll();

    const summary = {
      day: this.data.day,
      stuffed: ds.stuffed,
      knockouts: ds.knockouts,
      shipped: ds.shipped,
      flushed,
      earned: ds.earned,
      quota: this.quota,
      quotaMet,
      bonus,
      record: record && this.data.day > 1,
      canDouble: Platform.canRewarded && ds.shipped + flushed > 0,
    };
    this.lastDayValue = ds.shipped + flushed;
    this.data.day++;
    this.persist();
    this.ui.showDayEnd(summary);
  }

  async nextDay() {
    if (this.data.day > 2) await Platform.ad('midgame');
    this.startDay();
  }

  async doubleEarnings() {
    if (this.dayStats.doubled) return;
    const ok = await Platform.ad('rewarded');
    if (!ok) return;
    this.dayStats.doubled = true;
    this.data.cash += this.lastDayValue;
    this.persist();
    this.ui.markDoubled(this.lastDayValue);
  }

  buyUpgrade(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const lvl = this.data.levels[id] || 0;
    if (lvl >= u.max) return false;
    const cost = upgradeCost(u, lvl);
    if (this.data.cash < cost) return false;
    this.data.cash -= cost;
    this.data.levels[id] = lvl + 1;
    this.stats = computeStats(this.data.levels);
    Audio.play('buy');
    this.persist();
    return true;
  }

  onTutorialDone() {
    this.data.tutorialDone = true;
    this.settings.tutorialSeen = true;
    this.persist();
    this.saveSettings();
  }

  syncRobots() {
    this.disposeRobots();
    for (let i = 0; i < this.stats.robots; i++) this.robots.push(new Robot(this, i));
  }

  disposeRobots() {
    for (const r of this.robots) r.dispose();
    this.robots = [];
  }

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
      // give the new setting a chance to prove itself too
      if (i - 1 > 0) Object.assign(p, { frames: 0, time: 0, checked: false });
    }
  }

  persist() {
    Platform.save(SAVE_KEY, this.data);
  }

  saveSettings() {
    Platform.save(SETTINGS_KEY, this.settings);
  }

  pause() {
    if (this.state !== 'playing') return;
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
    } else this.input.requestLock();
  }

  onLockChange(locked) {
    if (this.state !== 'playing') return;
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

  updateMenu(dt) {
    const a = this.time * 0.08;
    this.camera.position.set(Math.sin(a) * 13, 6.5, 6 + Math.cos(a) * 13);
    this.camera.lookAt(-2, 1, 2);
    this.plushies.update(dt, { player: null, colliders: this.colliders, stuffer: this.stuffer, time: this.time, particles: this.particles });
    this.stuffer.update(dt);
    this.conveyor.update(dt, this.stats.beltSpeed);
  }

  updatePlaying(dt) {
    // During the tutorial the clock (and further trucks) wait for the player.
    const hold = this.tutorial.holdsClock;
    if (!hold || this.trucksSpawned === 0) this.dayTime += dt;
    if (!hold) this.timeLeft -= dt;
    this.tutorial.update(dt);

    while (this.truckSchedule.length && this.dayTime >= this.truckSchedule[0].at) {
      const { count } = this.truckSchedule.shift();
      this.trucksSpawned++;
      this.trucks.push(new Truck(this, count, (from) => this.unloadPlushie(from)));
    }

    this.player.update(dt, this.input);
    this.plushies.update(dt, {
      player: this.player,
      colliders: this.colliders,
      stuffer: this.stuffer,
      time: this.time,
      particles: this.particles,
    });
    for (const r of this.robots) r.update(dt);
    this.stuffer.update(dt);
    this.conveyor.update(dt, this.stats.beltSpeed);
    for (const tr of this.trucks) tr.update(dt);
    this.trucks = this.trucks.filter((tr) => {
      if (tr.state === 'done') tr.dispose();
      return tr.state !== 'done';
    });

    const sec = Math.ceil(this.timeLeft);
    if (sec <= 10 && sec < this.lastTick && sec > 0) {
      if (this.lastTick === 11) this.ui.toast('lastSeconds');
      this.lastTick = sec;
      Audio.play('tick');
    }
    this.ui.updateHud();
    if (this.timeLeft <= 0) this.endDay();
  }

  unloadPlushie(from) {
    if (this.plushies.count >= MAX_PLUSHIES) return;
    // the tutorial truck brings only teddies
    const type = this.tutorial.active ? 'teddy' : pickPlushieType(this.data.day);
    const p = this.plushies.spawn(type, this.data.day);
    const D = LAYOUT.door;
    const to = new THREE.Vector3(D.x + rand(-D.halfWidth + 0.8, D.halfWidth - 0.8), 0, LAYOUT.floor.maxZ - rand(2.5, 5));
    p.startHop(from, to);
  }
}
