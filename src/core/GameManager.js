// Orchestrates the game: state machine (menu / playing / dayend), the workday timer,
// truck schedule, economy and saving. Systems communicate through the EventBus.
import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import {
  SAVE_KEY, SETTINGS_KEY, LAYOUT, MAX_PLUSHIES, QUOTA_BONUS, UPGRADES,
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
import { UI } from '../ui/UI.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class GameManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.isTouch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
    this.shadows = !this.isTouch;
    this.state = 'loading';
    this.paused = false;
    this.time = 0;
    this.bus = new EventBus();
    this.solids = [];
    this.trucks = [];
    this.truckSchedule = [];
    this.data = newSave();
    this.stats = computeStats({});
    this.settings = { sens: 1, muted: false, ...(Platform.load(SETTINGS_KEY) || {}) };
    Audio.setMuted(this.settings.muted);

    const r = new THREE.WebGLRenderer({ canvas, antialias: !this.isTouch, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, this.isTouch ? 1.5 : 2));
    r.setSize(innerWidth, innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9cbe6);
    this.scene.fog = new THREE.Fog(0xa9cbe6, 45, 110);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200);
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
    await Platform.init();
    Platform.loadingStart();
    Platform.onAdStart = () => Audio.setAdMuted(true);
    Platform.onAdEnd = () => Audio.setAdMuted(false);

    this.colliders = new Colliders();
    const factory = buildFactory(this.scene, this.colliders, { shadows: this.shadows });
    this.solids.push(...factory.solids);
    this.particles = new Particles(this.scene);
    this.conveyor = new Conveyor(this);
    this.stuffer = new Stuffer(this);
    this.plushies = new PlushieManager(this);
    this.player = new Player(this);
    this.input = new Input(this);

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
      this.ui.floater('KO!', p.pos.clone().setY(1.4), 'ko');
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

    this.player.respawn();
    this.player.refill();
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
    Audio.play('bell');

    const flushed = this.stuffer.flush() + this.conveyor.flush();
    const ds = this.dayStats;
    ds.earned += flushed;
    const quotaMet = ds.earned >= this.quota;
    const bonus = quotaMet ? Math.round(this.quota * QUOTA_BONUS) : 0;
    this.data.cash += flushed + bonus;
    this.data.totals.stuffed += ds.stuffed;
    this.data.totals.earned += ds.earned + bonus;

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
      canDouble: Platform.hasAds && ds.shipped + flushed > 0,
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

  persist() {
    Platform.save(SAVE_KEY, this.data);
  }

  saveSettings() {
    Platform.save(SETTINGS_KEY, this.settings);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.paused = true;
    this.input.exitLock();
    this.ui.showPause(true);
  }

  resume() {
    if (this.state !== 'playing') return;
    if (this.isTouch) {
      this.paused = false;
      this.ui.showPause(false);
    } else this.input.requestLock();
  }

  onLockChange(locked) {
    if (this.state !== 'playing') return;
    this.paused = !locked;
    this.ui.showPause(!locked);
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  // ---------- Frame ----------

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
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
    this.plushies.update(dt, { player: null, colliders: this.colliders, stuffer: this.stuffer, time: this.time });
    this.stuffer.update(dt);
    this.conveyor.update(dt, this.stats.beltSpeed);
  }

  updatePlaying(dt) {
    this.dayTime += dt;
    this.timeLeft -= dt;

    while (this.truckSchedule.length && this.dayTime >= this.truckSchedule[0].at) {
      const { count } = this.truckSchedule.shift();
      this.trucks.push(new Truck(this, count, (from) => this.unloadPlushie(from)));
    }

    this.player.update(dt, this.input);
    this.plushies.update(dt, { player: this.player, colliders: this.colliders, stuffer: this.stuffer, time: this.time });
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
    const p = this.plushies.spawn(pickPlushieType(this.data.day), this.data.day);
    const D = LAYOUT.door;
    const to = new THREE.Vector3(D.x + rand(-D.halfWidth + 0.8, D.halfWidth - 0.8), 0, LAYOUT.floor.maxZ - rand(2.5, 5));
    p.startHop(from, to);
  }
}
