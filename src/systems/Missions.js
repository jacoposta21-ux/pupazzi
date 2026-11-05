// Timed missions: one at a time, short and optional. Completing one pays cash (and sometimes a nugget).
import { MISSIONS, MISSION_GAP, MISSION_NUGGET_CHANCE, levelValueMult, plushieWeights } from '../data/config.js';
import { Audio } from './Audio.js';
import { Platform } from './Platform.js';

export class Missions {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.cooldown = 6;
    const bus = game.bus;
    bus.on('plushieStuffed', ({ type }) => {
      this.progress('stuffAny', 1);
      this.progress('stuffType', 1, type);
      if (type === 'golden') this.progress('golden', 1);
    });
    bus.on('plushieKO', (p) => {
      this.progress('ko', 1);
      if (p.type === 'knight') this.progress('koKnight', 1);
    });
    bus.on('canSold', ({ value }) => this.progress('ship', value));
  }

  reset() {
    this.current = null;
    this.cooldown = 6;
  }

  start() {
    const L = this.game.level;
    const pool = MISSIONS.filter((m) => !m.minLevel || L >= m.minLevel);
    const def = pool[Math.floor(Math.random() * pool.length)];
    const m = { id: def.id, goal: def.count(L), progress: 0, time: def.time, total: def.time };
    if (def.id === 'stuffType') {
      // a plushie type that actually shows up at this level
      const w = plushieWeights(L);
      const types = Object.keys(w).filter((k) => w[k] > 0 && k !== 'golden');
      m.target = types[Math.floor(Math.random() * types.length)];
    }
    m.reward = Math.round((levelValueMult(L) * 12 * (6 + L)) / 5) * 5;
    m.nugget = Math.random() < MISSION_NUGGET_CHANCE;
    this.current = m;
    Audio.play('tutorial');
  }

  progress(id, amount, type) {
    const m = this.current;
    if (!m || m.id !== id || m.done) return;
    if (m.target && type !== m.target) return;
    m.progress = Math.min(m.goal, m.progress + amount);
    if (m.progress >= m.goal) this.complete();
  }

  complete() {
    const m = this.current;
    const game = this.game;
    m.done = true;
    m.time = 2.5; // keep the "completed" banner on screen briefly
    game.addEarnings(m.reward);
    if (m.nugget) game.addNuggets(1);
    game.data.totals.missions = (game.data.totals.missions || 0) + 1;
    game.ui.toast('missionDone', { v: game.ui.money(m.reward) + (m.nugget ? ' + 💎' : '') });
    Audio.play('mission');
    Platform.happytime();
  }

  update(dt) {
    if (this.game.tutorial.active) return;
    if (!this.current) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.start();
      return;
    }
    this.current.time -= dt;
    if (this.current.time <= 0) {
      if (!this.current.done) Audio.play('reject');
      this.current = null;
      this.cooldown = MISSION_GAP;
    }
  }
}
