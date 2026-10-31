// Procedural WebAudio: sound effects + a small looping chiptune. No audio files to download.
let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let noiseBuffer = null;
let sfxMuted = false;
let musicMuted = false;
let adMuted = false;

const MUSIC_VOL = 0.22;

function applyVolume() {
  if (!master) return;
  master.gain.value = adMuted ? 0 : 0.5;
  sfxBus.gain.value = sfxMuted ? 0 : 1;
  musicBus.gain.setTargetAtTime(musicMuted ? 0 : MUSIC_VOL * Music.duck, ctx.currentTime, 0.1);
}

function tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, at = null, dest = sfxBus }) {
  const t0 = at ?? ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.3, freq = 1000, type = 'lowpass', delay = 0, at = null, dest = sfxBus }) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = at ?? ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const SFX = {
  shoot() {
    tone({ freq: 520, to: 180, type: 'square', dur: 0.09, vol: 0.1 });
    noise({ dur: 0.08, vol: 0.15, freq: 3000, type: 'highpass' });
  },
  hit: () => tone({ freq: 900, to: 1500, type: 'sine', dur: 0.08, vol: 0.2 }),
  clang() {
    tone({ freq: 1800, to: 1500, type: 'triangle', dur: 0.15, vol: 0.12 });
    tone({ freq: 2700, type: 'sine', dur: 0.1, vol: 0.06 });
  },
  armorBreak() {
    noise({ dur: 0.25, vol: 0.25, freq: 4000, type: 'highpass' });
    tone({ freq: 900, to: 300, type: 'triangle', dur: 0.3, vol: 0.15 });
  },
  squeak() {
    const f = 900 + Math.random() * 500;
    tone({ freq: f, to: f * 1.6, type: 'triangle', dur: 0.12, vol: 0.14 });
    tone({ freq: f * 1.5, to: f, type: 'triangle', dur: 0.1, vol: 0.1, delay: 0.1 });
  },
  ko: () => tone({ freq: 700, to: 200, type: 'triangle', dur: 0.35, vol: 0.2 }),
  pop() {
    tone({ freq: 400, to: 1200, type: 'sine', dur: 0.15, vol: 0.2 });
    noise({ dur: 0.1, vol: 0.15, freq: 2000, type: 'bandpass' });
  },
  grab: () => tone({ freq: 300, to: 650, type: 'sine', dur: 0.12, vol: 0.25 }),
  throw: () => noise({ dur: 0.18, vol: 0.15, freq: 1500, type: 'bandpass' }),
  stuff() {
    noise({ dur: 0.35, vol: 0.3, freq: 400 });
    tone({ freq: 120, to: 60, type: 'sawtooth', dur: 0.3, vol: 0.1 });
  },
  reject: () => tone({ freq: 160, type: 'square', dur: 0.25, vol: 0.12 }),
  can() {
    tone({ freq: 1200, to: 900, type: 'triangle', dur: 0.06, vol: 0.08 });
    noise({ dur: 0.12, vol: 0.06, freq: 800 });
  },
  cash() {
    tone({ freq: 1318, type: 'sine', dur: 0.1, vol: 0.12 });
    tone({ freq: 1760, type: 'sine', dur: 0.18, vol: 0.12, delay: 0.07 });
    tone({ freq: 2637, type: 'sine', dur: 0.12, vol: 0.05, delay: 0.07 });
  },
  horn() {
    tone({ freq: 220, type: 'sawtooth', dur: 0.4, vol: 0.08 });
    tone({ freq: 277, type: 'sawtooth', dur: 0.4, vol: 0.06 });
  },
  reload() {
    tone({ freq: 300, to: 500, type: 'square', dur: 0.06, vol: 0.07 });
    tone({ freq: 500, to: 300, type: 'square', dur: 0.06, vol: 0.07, delay: 0.25 });
  },
  empty: () => tone({ freq: 200, type: 'square', dur: 0.04, vol: 0.07 }),
  tick: () => tone({ freq: 1000, type: 'sine', dur: 0.05, vol: 0.12 }),
  bell() {
    [880, 1108, 1318].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.45, vol: 0.14, delay: i * 0.12 }));
  },
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.14, delay: i * 0.09 }));
  },
  buy: () => tone({ freq: 600, to: 1200, type: 'triangle', dur: 0.12, vol: 0.18 }),
  click: () => tone({ freq: 800, type: 'sine', dur: 0.04, vol: 0.1 }),
  jump: () => tone({ freq: 300, to: 480, type: 'sine', dur: 0.1, vol: 0.06 }),
  land: () => noise({ dur: 0.08, vol: 0.08, freq: 300 }),
  step: () => noise({ dur: 0.05, vol: 0.035, freq: 500 }),
  robot: () => tone({ freq: 1400, to: 2000, type: 'square', dur: 0.05, vol: 0.04 }),
  tutorial: () => tone({ freq: 880, to: 1320, type: 'sine', dur: 0.15, vol: 0.12 }),
  swap() {
    tone({ freq: 500, to: 700, type: 'square', dur: 0.05, vol: 0.06 });
    tone({ freq: 700, to: 900, type: 'square', dur: 0.05, vol: 0.06, delay: 0.08 });
  },
  net() {
    noise({ dur: 0.25, vol: 0.25, freq: 600, type: 'bandpass' });
    tone({ freq: 220, to: 140, type: 'triangle', dur: 0.2, vol: 0.15 });
  },
  netHit() {
    noise({ dur: 0.3, vol: 0.2, freq: 900, type: 'bandpass' });
    tone({ freq: 600, to: 1200, type: 'triangle', dur: 0.2, vol: 0.12 });
  },
  netMiss: () => noise({ dur: 0.2, vol: 0.15, freq: 500 }),
  confetti() {
    noise({ dur: 0.35, vol: 0.35, freq: 2500, type: 'highpass' });
    tone({ freq: 160, to: 50, type: 'sine', dur: 0.25, vol: 0.4 });
    [1046, 1318, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.12, vol: 0.06, delay: 0.05 + i * 0.05 }));
  },
  vacuum: () => noise({ dur: 0.16, vol: 0.09, freq: 1200, type: 'bandpass' }),
  minigun() {
    tone({ freq: 700 + Math.random() * 200, to: 260, type: 'square', dur: 0.05, vol: 0.06 });
    noise({ dur: 0.04, vol: 0.08, freq: 3500, type: 'highpass' });
  },
  place() {
    tone({ freq: 220, to: 110, type: 'triangle', dur: 0.2, vol: 0.2 });
    noise({ dur: 0.15, vol: 0.12, freq: 500 });
    tone({ freq: 880, type: 'sine', dur: 0.1, vol: 0.08, delay: 0.1 });
  },
  turret: () => tone({ freq: 700, to: 300, type: 'square', dur: 0.06, vol: 0.035 }),
  armDrop() {
    tone({ freq: 500, to: 250, type: 'square', dur: 0.08, vol: 0.05 });
    noise({ dur: 0.1, vol: 0.06, freq: 1500, type: 'bandpass', delay: 0.05 });
  },
  sort() {
    tone({ freq: 900, to: 1400, type: 'square', dur: 0.06, vol: 0.05 });
    tone({ freq: 1760, type: 'sine', dur: 0.15, vol: 0.08, delay: 0.25 });
  },
  nugget() {
    [1318, 1760, 2093, 2637].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.25, vol: 0.12, delay: i * 0.07 }));
  },
  scan: () => tone({ freq: 1500, to: 1700, type: 'sine', dur: 0.06, vol: 0.04 }),
  scanHit() {
    [880, 1320, 880, 1320].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.08, vol: 0.06, delay: i * 0.09 }));
  },
  shutter: () => noise({ dur: 0.7, vol: 0.06, freq: 700, type: 'bandpass' }),
  rainbow() {
    tone({ freq: 1200 + Math.random() * 600, to: 2400, type: 'sine', dur: 0.08, vol: 0.06 });
  },
  // ---- Arena ----
  poof() {
    noise({ dur: 0.22, vol: 0.22, freq: 900, type: 'bandpass' });
    tone({ freq: 300, to: 900, type: 'sine', dur: 0.12, vol: 0.12 });
  },
  boom() {
    noise({ dur: 0.6, vol: 0.4, freq: 500 });
    tone({ freq: 120, to: 40, type: 'sine', dur: 0.5, vol: 0.4 });
  },
  coreHit() {
    tone({ freq: 140, to: 90, type: 'square', dur: 0.12, vol: 0.09 });
    noise({ dur: 0.1, vol: 0.1, freq: 600 });
  },
  bonk: () => tone({ freq: 520, to: 260, type: 'triangle', dur: 0.1, vol: 0.14 }),
  boing: () => tone({ freq: 180, to: 720, type: 'sine', dur: 0.3, vol: 0.18 }),
  splash() {
    noise({ dur: 0.35, vol: 0.28, freq: 1800, type: 'bandpass' });
    tone({ freq: 500, to: 150, type: 'sine', dur: 0.2, vol: 0.12 });
  },
  feather() {
    noise({ dur: 0.18, vol: 0.28, freq: 1400, type: 'bandpass' });
    tone({ freq: 220, to: 90, type: 'square', dur: 0.12, vol: 0.12 });
  },
  roundStart() {
    [392, 523, 659].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.18, vol: 0.08, delay: i * 0.12 }));
  },
  boss() {
    [196, 185, 175, 165].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.3, vol: 0.1, delay: i * 0.22 }));
  },
  wrap() {
    noise({ dur: 0.12, vol: 0.08, freq: 3000, type: 'highpass' });
    tone({ freq: 1568, type: 'sine', dur: 0.12, vol: 0.06, delay: 0.05 });
  },
};

// ---------- Music: I–vi–IV–V loop, 16 steps per bar, 4 bars ----------
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 116;
const STEP = 60 / BPM / 4;
const BASS = [36, 33, 29, 31];
const CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
// melody: semitone offsets from C5 (72) per step, null = rest
const MEL = [
  0, null, 4, null, 7, null, 4, 2, 0, null, null, null, -3, null, 0, null,
  -3, null, 0, null, 4, null, 2, 0, -3, null, null, null, null, null, -5, null,
  -7, null, -3, null, 0, null, -3, -5, -7, null, null, null, 0, null, 2, null,
  -1, null, 2, null, 7, null, 5, 4, 2, null, null, null, 4, null, 2, null,
];

const Music = {
  playing: false,
  step: 0,
  next: 0,
  timer: null,
  calm: true, // menu = no drums/melody
  duck: 1,

  start() {
    if (!ctx || this.playing) return;
    this.playing = true;
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  },

  schedule() {
    while (this.next < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.next);
      this.next += STEP;
      this.step = (this.step + 1) % 64;
    }
  },

  playStep(s, at) {
    const bar = Math.floor(s / 16);
    const i = s % 16;
    const dest = musicBus;
    if (i === 0 || i === 6 || i === 8 || i === 14) {
      tone({ freq: midi(BASS[bar]), type: 'triangle', dur: 0.22, vol: 0.5, at, dest });
    }
    if (i === 4 || i === 12) {
      for (const n of CHORDS[bar]) tone({ freq: midi(n), type: 'square', dur: 0.14, vol: 0.05, at, dest });
    }
    if (this.calm) return;
    if (i % 8 === 0) tone({ freq: 150, to: 45, type: 'sine', dur: 0.18, vol: 0.55, at, dest });
    if (i % 2 === 0) noise({ dur: 0.04, vol: i % 4 === 2 ? 0.12 : 0.05, freq: 7000, type: 'highpass', at, dest });
    if (i === 4 || i === 12) noise({ dur: 0.12, vol: 0.12, freq: 1800, type: 'bandpass', at, dest });
    const m = MEL[s];
    if (m !== null) tone({ freq: midi(72 + m), type: 'triangle', dur: 0.2, vol: 0.18, at, dest });
  },
};

export const Audio = {
  // Must be called from a user gesture (browser autoplay policy).
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      sfxBus.connect(master);
      musicBus.connect(master);
      master.connect(ctx.destination);
      applyVolume();
      Music.start();
    }
    if (ctx.state === 'suspended') ctx.resume();
  },
  setMuted(m) {
    sfxMuted = m;
    applyVolume();
  },
  get muted() {
    return sfxMuted;
  },
  setMusicMuted(m) {
    musicMuted = m;
    applyVolume();
  },
  get musicMuted() {
    return musicMuted;
  },
  setAdMuted(m) {
    adMuted = m;
    applyVolume();
  },
  // calm: menu/shop arrangement. duck: 0..1 volume multiplier (e.g. while paused).
  setMusicMood({ calm, duck }) {
    if (calm !== undefined) Music.calm = calm;
    if (duck !== undefined) Music.duck = duck;
    applyVolume();
  },
  play(name) {
    if (!ctx || sfxMuted || adMuted) return;
    SFX[name]?.();
  },
};
