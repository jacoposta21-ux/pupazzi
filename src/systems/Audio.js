// Procedural WebAudio: sound effects + an adaptive soundtrack. No audio files to download.
//
// Signal chain: voices -> sfx / music buses -> master -> compressor -> speakers, with a shared
// reverb send so everything sits in the same "room". Four music tracks (menu, factory, arena, boss)
// share one sequencer; switching happens on the next bar so the music never cuts mid-phrase.
// Every effect has a loudness budget and a minimum repeat interval, so busy moments stay clean.

let ctx = null;
let master = null;
let comp = null;
let sfxBus = null;
let musicBus = null;
let reverb = null;
let sfxWet = null;
let musicWet = null;
let noiseBuffer = null;
let sfxMuted = false;
let musicMuted = false;
let adMuted = false;
let platformMuted = false; // the portal asked for silence (its overlays, a muted page)

const MASTER_VOL = 0.85;
const MUSIC_VOL = 0.22;
const SFX_VOL = 0.9;

function applyVolume() {
  if (!master) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(adMuted || platformMuted ? 0 : MASTER_VOL, t, 0.02);
  sfxBus.gain.setTargetAtTime(sfxMuted ? 0 : SFX_VOL, t, 0.02);
  musicBus.gain.setTargetAtTime(musicMuted ? 0 : MUSIC_VOL * Music.duck, t, 0.12);
}

// Reverb impulse: stereo noise with an exponential tail.
function makeImpulse(seconds = 1.8, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function getNoise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// Connects a node to its bus, plus an optional reverb send.
function route(node, dest, wet) {
  node.connect(dest);
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send);
    send.connect(dest === musicBus ? musicWet : sfxWet);
  }
}

// One oscillator voice with an attack/decay envelope, optional pitch glide, filter and detuned twin.
function tone({
  freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, at = null, dest = sfxBus,
  attack = 0.005, lp = null, detune = 0, wet = 0, glide = null,
}) {
  const t0 = at ?? ctx.currentTime + delay;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let out = g;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    g.connect(f);
    out = f;
  }
  route(out, dest, wet);
  const oscs = detune ? [-detune, detune] : [0];
  for (const d of oscs) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = d;
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + (glide ?? dur));
    o.connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

function noise({ dur = 0.2, vol = 0.3, freq = 1000, type = 'lowpass', q = 1, delay = 0, at = null, dest = sfxBus, attack = 0.002, wet = 0, sweep = null }) {
  const t0 = at ?? ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g);
  route(g, dest, wet);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.05);
}

const chord = (notes, opts) => notes.forEach((f, i) => tone({ ...opts, freq: f, delay: (opts.delay ?? 0) + i * (opts.strum ?? 0) }));
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------------------------------------------------------------------------------------------
// Sound effects. Loudness budget: weapons/feedback ~0.15-0.25, UI ~0.08-0.12, big moments ~0.3.
// ---------------------------------------------------------------------------------------------
const SFX = {
  // --- weapons ---
  shoot() {
    // foam dart: soft pneumatic puff + a rubbery "thwip"
    noise({ dur: 0.07, vol: 0.18, freq: 2600, type: 'bandpass', q: 0.8, sweep: 900 });
    tone({ freq: 620, to: 210, type: 'triangle', dur: 0.08, vol: 0.12 });
  },
  minigun() {
    noise({ dur: 0.045, vol: 0.1, freq: 3000, type: 'bandpass', q: 0.9 });
    tone({ freq: 520 + Math.random() * 160, to: 240, type: 'triangle', dur: 0.05, vol: 0.06 });
  },
  feather() {
    noise({ dur: 0.22, vol: 0.24, freq: 1800, type: 'bandpass', q: 0.6, sweep: 500 });
    tone({ freq: 240, to: 90, type: 'sine', dur: 0.14, vol: 0.2 });
  },
  net() {
    noise({ dur: 0.25, vol: 0.18, freq: 700, type: 'bandpass', sweep: 300 });
    tone({ freq: 260, to: 150, type: 'triangle', dur: 0.2, vol: 0.12 });
  },
  netHit() {
    noise({ dur: 0.3, vol: 0.16, freq: 1000, type: 'bandpass' });
    tone({ freq: 600, to: 1200, type: 'triangle', dur: 0.18, vol: 0.1, wet: 0.2 });
  },
  netMiss: () => noise({ dur: 0.18, vol: 0.22, freq: 500 }),
  confetti() {
    noise({ dur: 0.35, vol: 0.16, freq: 2600, type: 'highpass' });
    tone({ freq: 170, to: 50, type: 'sine', dur: 0.25, vol: 0.17 });
    [1046, 1318, 1568, 2093].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.12, vol: 0.05, delay: 0.05 + i * 0.04, wet: 0.3 }));
  },
  vacuum: () => noise({ dur: 0.16, vol: 0.15, freq: 1100, type: 'bandpass', q: 1.2 }),
  rainbow() {
    const f = 1200 + Math.random() * 500;
    tone({ freq: f, to: f * 1.9, type: 'sine', dur: 0.09, vol: 0.06, wet: 0.25 });
  },
  reload() {
    tone({ freq: 320, to: 520, type: 'square', dur: 0.05, vol: 0.05, lp: 2000 });
    noise({ dur: 0.05, vol: 0.06, freq: 2500, type: 'bandpass', delay: 0.12 });
    tone({ freq: 520, to: 340, type: 'square', dur: 0.05, vol: 0.05, lp: 2000, delay: 0.24 });
  },
  empty: () => tone({ freq: 220, type: 'square', dur: 0.04, vol: 0.05, lp: 1500 }),
  splash() {
    noise({ dur: 0.4, vol: 0.26, freq: 2200, type: 'bandpass', q: 0.7, sweep: 600 });
    tone({ freq: 480, to: 140, type: 'sine', dur: 0.22, vol: 0.12 });
    [0.08, 0.15, 0.22].forEach((d) => tone({ freq: 900 + Math.random() * 900, to: 400, type: 'sine', dur: 0.05, vol: 0.05, delay: d }));
  },

  // --- hits & plushies ---
  hit() {
    // plush thump with a little squeak on top
    tone({ freq: 180, to: 90, type: 'sine', dur: 0.09, vol: 0.18 });
    tone({ freq: 1100, to: 1500, type: 'triangle', dur: 0.06, vol: 0.06 });
  },
  ko() {
    tone({ freq: 640, to: 180, type: 'triangle', dur: 0.32, vol: 0.14 });
    [1568, 2093].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.18, vol: 0.05, delay: 0.06 + i * 0.06, wet: 0.35 }));
  },
  clang() {
    tone({ freq: 1800, to: 1500, type: 'triangle', dur: 0.18, vol: 0.1, wet: 0.2 });
    tone({ freq: 2700, type: 'sine', dur: 0.12, vol: 0.05 });
  },
  armorBreak() {
    noise({ dur: 0.25, vol: 0.11, freq: 4000, type: 'highpass' });
    tone({ freq: 900, to: 300, type: 'triangle', dur: 0.3, vol: 0.1 });
  },
  squeak() {
    const f = 900 + Math.random() * 500;
    tone({ freq: f, to: f * 1.6, type: 'triangle', dur: 0.11, vol: 0.09 });
    tone({ freq: f * 1.5, to: f, type: 'triangle', dur: 0.1, vol: 0.07, delay: 0.1 });
  },
  pop() {
    tone({ freq: 400, to: 1200, type: 'sine', dur: 0.14, vol: 0.16 });
    noise({ dur: 0.1, vol: 0.12, freq: 2000, type: 'bandpass' });
  },
  poof() {
    // plushie bursting into cotton: a soft, airy whoomp
    noise({ dur: 0.3, vol: 0.2, freq: 1400, type: 'bandpass', q: 0.6, sweep: 400 });
    tone({ freq: 210, to: 80, type: 'sine', dur: 0.2, vol: 0.18 });
  },
  coin() {
    tone({ freq: 1976, type: 'square', dur: 0.06, vol: 0.055, lp: 4000 });
    tone({ freq: 2637, type: 'square', dur: 0.14, vol: 0.055, lp: 4000, delay: 0.05, wet: 0.2 });
  },
  boom() {
    noise({ dur: 0.7, vol: 0.28, freq: 700, sweep: 120 });
    tone({ freq: 120, to: 38, type: 'sine', dur: 0.55, vol: 0.3 });
    noise({ dur: 1.2, vol: 0.06, freq: 3000, type: 'highpass', delay: 0.05, wet: 0.5 });
  },
  bonk: () => {
    tone({ freq: 520, to: 240, type: 'triangle', dur: 0.1, vol: 0.13 });
    noise({ dur: 0.05, vol: 0.06, freq: 900, type: 'bandpass' });
  },
  boing: () => tone({ freq: 160, to: 760, type: 'sine', dur: 0.32, vol: 0.15, glide: 0.18 }),

  // --- factory ---
  grab: () => tone({ freq: 300, to: 660, type: 'sine', dur: 0.12, vol: 0.16 }),
  throw: () => noise({ dur: 0.2, vol: 0.24, freq: 900, type: 'bandpass', sweep: 2400 }),
  stuff() {
    noise({ dur: 0.35, vol: 0.3, freq: 420, sweep: 160 });
    tone({ freq: 150, to: 55, type: 'sine', dur: 0.25, vol: 0.2 });
    tone({ freq: 120, to: 60, type: 'sawtooth', dur: 0.3, vol: 0.08, lp: 500 });
    tone({ freq: 880, type: 'sine', dur: 0.12, vol: 0.04, delay: 0.2, wet: 0.3 });
  },
  can() {
    tone({ freq: 1250, to: 950, type: 'triangle', dur: 0.06, vol: 0.07 });
    noise({ dur: 0.1, vol: 0.05, freq: 800 });
  },
  canOut() {
    tone({ freq: 700, to: 420, type: 'triangle', dur: 0.08, vol: 0.06 });
    noise({ dur: 0.06, vol: 0.05, freq: 1200, type: 'bandpass', delay: 0.04 });
  },
  cash() {
    tone({ freq: 1318, type: 'sine', dur: 0.1, vol: 0.09 });
    tone({ freq: 1760, type: 'sine', dur: 0.2, vol: 0.09, delay: 0.07, wet: 0.25 });
    tone({ freq: 2637, type: 'sine', dur: 0.12, vol: 0.03, delay: 0.07 });
  },
  sell() {
    tone({ freq: 1568, type: 'sine', dur: 0.08, vol: 0.08 });
    tone({ freq: 1175, type: 'sine', dur: 0.16, vol: 0.08, delay: 0.07, wet: 0.2 });
  },
  horn() {
    chord([220, 277], { type: 'sawtooth', dur: 0.45, vol: 0.05, lp: 1400, attack: 0.03 });
    chord([220, 277], { type: 'sawtooth', dur: 0.35, vol: 0.05, lp: 1400, attack: 0.03, delay: 0.5 });
  },
  shutter: () => noise({ dur: 0.7, vol: 0.13, freq: 700, type: 'bandpass', q: 1.2 }),
  robot: () => tone({ freq: 1400, to: 2000, type: 'square', dur: 0.05, vol: 0.025, lp: 3000 }),
  turret: () => tone({ freq: 700, to: 300, type: 'square', dur: 0.06, vol: 0.03, lp: 2500 }),
  armDrop() {
    tone({ freq: 500, to: 250, type: 'square', dur: 0.08, vol: 0.04, lp: 2000 });
    noise({ dur: 0.1, vol: 0.05, freq: 1500, type: 'bandpass', delay: 0.05 });
  },
  sort() {
    tone({ freq: 900, to: 1400, type: 'square', dur: 0.06, vol: 0.04, lp: 3000 });
    tone({ freq: 1760, type: 'sine', dur: 0.15, vol: 0.06, delay: 0.25 });
  },
  scan: () => tone({ freq: 1500, to: 1700, type: 'sine', dur: 0.06, vol: 0.03 }),
  scanHit() {
    [880, 1320, 880, 1320].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.08, vol: 0.04, lp: 3000, delay: i * 0.09 }));
  },
  nugget() {
    [1318, 1760, 2093, 2637].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.3, vol: 0.09, delay: i * 0.07, wet: 0.4 }));
  },
  wrap() {
    noise({ dur: 0.12, vol: 0.07, freq: 3000, type: 'highpass' });
    tone({ freq: 1568, type: 'sine', dur: 0.12, vol: 0.05, delay: 0.05 });
  },
  place() {
    tone({ freq: 200, to: 110, type: 'triangle', dur: 0.2, vol: 0.16 });
    noise({ dur: 0.15, vol: 0.1, freq: 500 });
    tone({ freq: 988, type: 'sine', dur: 0.12, vol: 0.06, delay: 0.1, wet: 0.25 });
  },
  buildOn() {
    tone({ freq: 523, type: 'triangle', dur: 0.08, vol: 0.07 });
    tone({ freq: 784, type: 'triangle', dur: 0.12, vol: 0.07, delay: 0.07 });
  },
  buildOff() {
    tone({ freq: 784, type: 'triangle', dur: 0.08, vol: 0.06 });
    tone({ freq: 523, type: 'triangle', dur: 0.12, vol: 0.06, delay: 0.07 });
  },

  // --- player ---
  jump: () => tone({ freq: 300, to: 480, type: 'sine', dur: 0.1, vol: 0.05 }),
  land: () => noise({ dur: 0.1, vol: 0.16, freq: 300 }),
  step: () => noise({ dur: 0.05, vol: 0.07, freq: 450 + Math.random() * 150 }),

  // --- UI ---
  click: () => tone({ freq: 820, type: 'sine', dur: 0.04, vol: 0.07 }),
  tick: () => tone({ freq: 1000, type: 'sine', dur: 0.06, vol: 0.1 }),
  swap() {
    tone({ freq: 500, to: 700, type: 'square', dur: 0.05, vol: 0.04, lp: 2500 });
    tone({ freq: 700, to: 900, type: 'square', dur: 0.05, vol: 0.04, lp: 2500, delay: 0.07 });
  },
  uiOpen() {
    tone({ freq: 587, type: 'sine', dur: 0.08, vol: 0.08 });
    tone({ freq: 880, type: 'sine', dur: 0.12, vol: 0.08, delay: 0.06, wet: 0.2 });
  },
  uiClose() {
    tone({ freq: 880, type: 'sine', dur: 0.08, vol: 0.07 });
    tone({ freq: 587, type: 'sine', dur: 0.12, vol: 0.07, delay: 0.06 });
  },
  buy: () => tone({ freq: 600, to: 1200, type: 'triangle', dur: 0.12, vol: 0.13, wet: 0.15 }),
  reject: () => tone({ freq: 170, type: 'square', dur: 0.2, vol: 0.06, lp: 900 }),
  tutorial: () => tone({ freq: 880, to: 1320, type: 'sine', dur: 0.15, vol: 0.09, wet: 0.2 }),
  bell() {
    [880, 1108, 1318].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.45, vol: 0.09, delay: i * 0.12, wet: 0.3 }));
  },

  // --- jingles (rewards, progress) ---
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.1, delay: i * 0.08, wet: 0.3 }));
  },
  reward() {
    [784, 988, 1175, 1568].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.35, vol: 0.09, delay: i * 0.06, wet: 0.4 }));
    noise({ dur: 0.5, vol: 0.03, freq: 6000, type: 'highpass', delay: 0.2, wet: 0.5 });
  },
  levelUp() {
    [523, 659, 784].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.12, vol: 0.05, lp: 3000, delay: i * 0.08 }));
    chord([523, 659, 784, 1046], { type: 'triangle', dur: 0.8, vol: 0.06, delay: 0.26, attack: 0.02, wet: 0.4 });
  },
  mission() {
    [659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.09, delay: i * 0.09, wet: 0.3 }));
  },
  victory() {
    [523, 523, 523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: i < 3 ? 0.12 : 0.5, vol: 0.1, delay: [0, 0.14, 0.28, 0.42, 0.62, 0.82][i], wet: 0.35 }));
  },
  roundStart() {
    [392, 523, 659].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.16, vol: 0.06, lp: 2800, delay: i * 0.11 }));
    tone({ freq: 784, type: 'square', dur: 0.4, vol: 0.06, lp: 2800, delay: 0.33, wet: 0.3 });
  },
  roundClear() {
    [659, 784, 988, 1318].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.25, vol: 0.1, delay: i * 0.08, wet: 0.35 }));
  },
  boss() {
    [147, 139, 131, 123].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.32, vol: 0.09, lp: 900, delay: i * 0.22 }));
    tone({ freq: 62, type: 'sine', dur: 1.2, vol: 0.25, delay: 0.88 });
  },
  coreHit() {
    tone({ freq: 140, to: 90, type: 'square', dur: 0.12, vol: 0.09, lp: 800 });
    noise({ dur: 0.1, vol: 0.12, freq: 600 });
  },
  alarm() {
    [0, 0.25, 0.5].forEach((d) => tone({ freq: 880, to: 660, type: 'square', dur: 0.18, vol: 0.08, lp: 2200, delay: d }));
  },
  gameOver() {
    [392, 370, 349, 294].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: i === 3 ? 0.9 : 0.3, vol: 0.11, delay: i * 0.28, wet: 0.35 }));
  },
};

// Minimum time between two plays of the same sound (ms): busy scenes don't stack identical voices.
const MIN_GAP = { hit: 45, ko: 60, poof: 50, coin: 70, can: 50, canOut: 120, turret: 60, robot: 200, coreHit: 120, squeak: 250, clang: 60, scan: 80, step: 60 };
const lastPlayed = {};

// ---------------------------------------------------------------------------------------------
// Music: four tracks on one 16-step sequencer. Notes are MIDI numbers.
// bars: [chord root for the bass, chord tones for pads/stabs]; mel: per bar, [step, note, length].
// ---------------------------------------------------------------------------------------------
const TRACKS = {
  // Main menu / victory: calm, airy pads and a bell melody (F major)
  menu: {
    bpm: 92,
    bars: [[41, [65, 69, 72, 76]], [38, [62, 65, 69, 72]], [34, [62, 65, 70, 74]], [36, [60, 64, 67, 72]]],
    bass: [[0, 0, 12], [8, 7, 6]],
    pads: true,
    alwaysFull: true, // nothing to strip: the bells play in calm mode too
    drums: null,
    mel: [
      [[0, 81, 4], [4, 79, 4], [8, 77, 8]],
      [[0, 77, 4], [4, 76, 4], [8, 74, 8]],
      [[0, 74, 4], [4, 77, 4], [8, 81, 4], [12, 79, 4]],
      [[0, 79, 8], [8, 76, 8]],
    ],
    lead: 'bell',
  },
  // Factory: bouncy and upbeat (C major)
  factory: {
    bpm: 112,
    bars: [
      [36, [60, 64, 67]], [33, [57, 60, 64]], [29, [53, 57, 60]], [31, [55, 59, 62]],
      [36, [60, 64, 67]], [28, [55, 59, 64]], [29, [53, 57, 60]], [31, [55, 59, 62]],
    ],
    bass: [[0, 0, 3], [3, 0, 2], [6, 7, 2], [8, 12, 2], [10, 7, 2], [12, 0, 2], [14, 7, 2]],
    stabs: [2, 6, 10, 14],
    drums: { kick: [0, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [14] },
    mel: [
      [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 76, 2], [8, 77, 1], [9, 76, 1], [10, 74, 2], [12, 72, 4]],
      [[0, 69, 2], [2, 72, 2], [4, 76, 4], [8, 74, 2], [10, 72, 2], [12, 71, 4]],
      [[0, 69, 2], [2, 72, 2], [4, 77, 2], [6, 76, 2], [8, 74, 2], [10, 72, 2], [12, 74, 4]],
      [[0, 71, 2], [2, 74, 2], [4, 79, 6], [10, 77, 2], [12, 76, 2], [14, 74, 2]],
      [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 84, 2], [8, 83, 2], [10, 79, 2], [12, 76, 4]],
      [[0, 71, 2], [2, 76, 2], [4, 79, 4], [8, 76, 2], [10, 74, 2], [12, 76, 4]],
      [[0, 77, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 69, 4], [12, 72, 4]],
      [[0, 74, 4], [4, 71, 2], [6, 74, 2], [8, 79, 8]],
    ],
    lead: 'pluck',
  },
  // Arena: driving and tense (A minor)
  arena: {
    bpm: 132,
    bars: [
      [33, [57, 60, 64]], [29, [53, 57, 60]], [36, [60, 64, 67]], [31, [55, 59, 62]],
      [33, [57, 60, 64]], [29, [53, 57, 60]], [31, [55, 59, 62]], [28, [56, 59, 64]],
    ],
    bass: [[0, 0, 2], [2, 0, 2], [4, 0, 2], [6, 12, 2], [8, 0, 2], [10, 0, 2], [12, 0, 2], [14, 12, 2]],
    arp: true,
    drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], open: [], crash: true },
    mel: [
      [[0, 81, 3], [3, 79, 1], [4, 76, 2], [6, 72, 2], [8, 74, 3], [11, 76, 1], [12, 72, 4]],
      [[0, 77, 3], [3, 76, 1], [4, 72, 2], [6, 69, 2], [8, 72, 4], [12, 74, 4]],
      [[0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 67, 2], [8, 72, 3], [11, 74, 1], [12, 76, 4]],
      [[0, 74, 2], [2, 71, 2], [4, 67, 4], [8, 71, 2], [10, 74, 2], [12, 79, 4]],
      [[0, 81, 3], [3, 79, 1], [4, 76, 2], [6, 72, 2], [8, 74, 3], [11, 76, 1], [12, 72, 4]],
      [[0, 77, 3], [3, 76, 1], [4, 72, 2], [6, 69, 2], [8, 72, 4], [12, 74, 4]],
      [[0, 79, 3], [3, 77, 1], [4, 74, 2], [6, 71, 2], [8, 74, 4], [12, 71, 4]],
      [[0, 68, 2], [2, 71, 2], [4, 76, 4], [8, 80, 4], [12, 76, 4]],
    ],
    lead: 'lead',
  },
  // Boss: heavy and dramatic (D minor)
  boss: {
    bpm: 144,
    bars: [[38, [62, 65, 69]], [34, [58, 62, 65]], [31, [55, 58, 62]], [33, [57, 61, 64]]],
    bass: [[0, 0, 1], [1, 0, 1], [3, 0, 1], [4, 0, 1], [6, 0, 1], [8, 0, 1], [9, 0, 1], [11, 0, 1], [12, 12, 1], [14, 0, 1]],
    heavy: true,
    pads: true,
    drums: { kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [], crash: true },
    mel: [
      [[0, 74, 6], [6, 77, 2], [8, 76, 4], [12, 74, 4]],
      [[0, 70, 6], [6, 74, 2], [8, 77, 8]],
      [[0, 79, 6], [6, 77, 2], [8, 74, 4], [12, 70, 4]],
      [[0, 73, 4], [4, 76, 4], [8, 81, 8]],
    ],
    lead: 'lead',
  },
};

const Music = {
  playing: false,
  track: 'menu',
  pending: null,
  step: 0,
  next: 0,
  timer: null,
  calm: true, // calm arrangement: no drums, no lead (shop, breaks, pauses)
  duck: 1,

  start() {
    if (!ctx || this.playing) return;
    this.playing = true;
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
    applyVolume();
  },

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
  },

  // Switch on the next bar line (immediately when silent).
  setTrack(name) {
    if (!TRACKS[name]) return;
    if (!this.playing) {
      this.track = name;
      this.step = 0;
      this.pending = null;
      this.start();
      return;
    }
    if (name === this.track && !this.pending) return;
    this.pending = name === this.track ? null : name;
  },

  get stepDur() {
    return 60 / TRACKS[this.track].bpm / 4;
  },

  schedule() {
    while (this.next < ctx.currentTime + 0.12) {
      if (this.pending && this.step % 16 === 0) {
        this.track = this.pending;
        this.pending = null;
        this.step = 0;
      }
      this.playStep(this.step, this.next);
      this.next += this.stepDur;
      this.step = (this.step + 1) % (TRACKS[this.track].bars.length * 16);
    }
  },

  playStep(s, at) {
    const T = TRACKS[this.track];
    const bar = Math.floor(s / 16);
    const i = s % 16;
    const [root, notes] = T.bars[bar];
    const dest = musicBus;
    const sd = this.stepDur;

    // bass
    for (const [st, off, len] of T.bass) {
      if (st !== i) continue;
      const f = midi(root + off);
      if (T.heavy) tone({ freq: f, type: 'sawtooth', dur: sd * len * 0.95, vol: 0.22, lp: 420, at, dest, attack: 0.004 });
      else tone({ freq: f, type: 'triangle', dur: sd * len * 0.95, vol: 0.5, at, dest, attack: 0.004 });
      tone({ freq: f / 2, type: 'sine', dur: sd * len * 0.9, vol: 0.25, at, dest });
    }
    // pads: one long chord per bar
    if (T.pads && i === 0) {
      for (const n of notes) tone({ freq: midi(n), type: 'sawtooth', dur: sd * 16, vol: 0.022, lp: 1100, detune: 8, attack: 0.4, at, dest, wet: 0.5 });
    }
    // off-beat chord stabs
    if (T.stabs?.includes(i)) {
      for (const n of notes) tone({ freq: midi(n), type: 'square', dur: 0.13, vol: 0.022, lp: 1900, detune: 6, at, dest, wet: 0.2 });
    }
    if (this.calm && !T.alwaysFull) return;
    // arpeggio (arena): chord tones climbing in 16ths
    if (T.arp) {
      const seq = [notes[0], notes[1], notes[2], notes[0] + 12, notes[2], notes[1]];
      tone({ freq: midi(seq[i % seq.length] + 12), type: 'square', dur: sd * 0.9, vol: 0.018, lp: 2600, at, dest, wet: 0.25 });
    }
    // drums
    const D = T.drums;
    if (D) {
      if (D.kick.includes(i)) {
        tone({ freq: 150, to: 42, type: 'sine', dur: 0.2, vol: 0.62, at, dest, glide: 0.12 });
        noise({ dur: 0.02, vol: 0.12, freq: 3000, type: 'highpass', at, dest });
      }
      if (D.snare.includes(i)) {
        noise({ dur: 0.14, vol: 0.16, freq: 1800, type: 'bandpass', q: 0.7, at, dest, wet: 0.25 });
        tone({ freq: 210, to: 160, type: 'triangle', dur: 0.08, vol: 0.14, at, dest });
      }
      if (D.hat.includes(i)) noise({ dur: 0.035, vol: i % 4 === 2 ? 0.06 : 0.035, freq: 8000, type: 'highpass', at, dest });
      if (D.open.includes(i)) noise({ dur: 0.16, vol: 0.04, freq: 7000, type: 'highpass', at, dest });
      if (D.crash && s === 0) noise({ dur: 1.4, vol: 0.06, freq: 5000, type: 'highpass', at, dest, wet: 0.4 });
    }
    // lead melody
    for (const [st, n, len] of T.mel[bar]) {
      if (st !== i) continue;
      const f = midi(n);
      const dur = sd * len * 0.92;
      if (T.lead === 'bell') {
        tone({ freq: f, type: 'sine', dur: Math.max(0.6, dur), vol: 0.09, at, dest, wet: 0.5 });
        tone({ freq: f * 2, type: 'sine', dur: 0.4, vol: 0.025, at, dest, wet: 0.5 });
      } else if (T.lead === 'pluck') {
        tone({ freq: f, type: 'triangle', dur, vol: 0.12, at, dest, wet: 0.25 });
        tone({ freq: f, type: 'square', dur: Math.min(dur, 0.12), vol: 0.025, lp: 3000, at, dest });
      } else {
        tone({ freq: f, type: 'sawtooth', dur, vol: 0.05, lp: 2400, detune: 7, attack: 0.02, at, dest, wet: 0.3 });
      }
    }
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
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      // each bus has its own reverb return, so muting music or effects also mutes their echo
      const impulse = makeImpulse();
      reverb = ctx.createConvolver();
      reverb.buffer = impulse;
      sfxWet = ctx.createGain();
      sfxWet.connect(reverb).connect(sfxBus);
      const musicVerb = ctx.createConvolver();
      musicVerb.buffer = impulse;
      musicWet = ctx.createGain();
      musicWet.connect(musicVerb).connect(musicBus);
      sfxBus.connect(master);
      musicBus.connect(master);
      master.connect(comp);
      comp.connect(ctx.destination);
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
  setPlatformMuted(m) {
    platformMuted = m;
    applyVolume();
  },
  setAdMuted(m) {
    adMuted = m;
    applyVolume();
  },
  // calm: stripped-down arrangement (shop, breaks). duck: 0..1 music volume (pause menus).
  setMusicMood({ calm, duck }) {
    if (calm !== undefined) Music.calm = calm;
    if (duck !== undefined) Music.duck = duck;
    applyVolume();
  },
  // 'menu' | 'factory' | 'arena' | 'boss': switches on the next bar line.
  setTrack(name) {
    Music.setTrack(name);
    if (ctx && !Music.playing) Music.start();
  },
  // Silence the soundtrack (game over); setTrack() brings it back.
  stopMusic() {
    Music.stop();
  },
  play(name) {
    if (!ctx || sfxMuted || adMuted || platformMuted) return;
    const now = performance.now();
    const gap = MIN_GAP[name] ?? 25;
    if (now - (lastPlayed[name] ?? -1e9) < gap) return;
    lastPlayed[name] = now;
    SFX[name]?.();
  },
};

// Dev-only loudness check: renders a sound (or a music track) offline and returns its peak / RMS.
export const __AudioDebug = import.meta.env.DEV
  ? {
      SFX,
      TRACKS,
      async measure(name, { music = false, seconds = 2, wet = false, raw = false } = {}) {
        const saved = { ctx, sfxBus, sfxWet, musicBus, musicWet, noiseBuffer, track: Music.track, calm: Music.calm };
        const off = new OfflineAudioContext(1, Math.floor(44100 * seconds), 44100);
        ctx = off;
        noiseBuffer = null;
        sfxBus = musicBus = off.createGain();
        sfxBus.gain.value = music ? MUSIC_VOL : SFX_VOL;
        sfxBus.connect(off.destination);
        sfxWet = musicWet = off.createGain();
        sfxWet.gain.value = wet ? 1 : 0; // dry measure unless asked
        if (wet) {
          const savedCtx = ctx;
          const v = off.createConvolver();
          v.buffer = makeImpulse();
          sfxWet.connect(v).connect(sfxBus);
          ctx = savedCtx;
        } else sfxWet.connect(off.destination);
        if (music) {
          Music.track = name;
          Music.calm = false;
          const sd = 60 / TRACKS[name].bpm / 4;
          for (let st = 0, t = 0; t < seconds; st++, t += sd) Music.playStep(st % (TRACKS[name].bars.length * 16), t);
        } else SFX[name]();
        const buf = await off.startRendering();
        Object.assign({}, saved);
        ({ ctx, sfxBus, sfxWet, musicBus, musicWet, noiseBuffer } = saved);
        Music.track = saved.track;
        Music.calm = saved.calm;
        const d = buf.getChannelData(0);
        if (raw) return Array.from(d);
        let peak = 0, sum = 0;
        for (const v of d) {
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
        }
        return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4) };
      },
    }
  : null;
