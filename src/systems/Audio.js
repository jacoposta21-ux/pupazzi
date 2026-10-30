// Procedural WebAudio sound effects: no audio files to download.
let ctx = null;
let master = null;
let noiseBuffer = null;
let userMuted = false;
let adMuted = false;

function applyVolume() {
  if (master) master.gain.value = userMuted || adMuted ? 0 : 0.5;
}

function tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0 }) {
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.3, freq = 1000, type = 'lowpass', delay = 0 }) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const SFX = {
  shoot() {
    tone({ freq: 520, to: 180, type: 'square', dur: 0.09, vol: 0.1 });
    noise({ dur: 0.08, vol: 0.15, freq: 3000, type: 'highpass' });
  },
  hit: () => tone({ freq: 900, to: 1500, type: 'sine', dur: 0.08, vol: 0.2 }),
  squeak() {
    const f = 900 + Math.random() * 500;
    tone({ freq: f, to: f * 1.6, type: 'triangle', dur: 0.12, vol: 0.14 });
    tone({ freq: f * 1.5, to: f, type: 'triangle', dur: 0.1, vol: 0.1, delay: 0.1 });
  },
  ko: () => tone({ freq: 700, to: 200, type: 'triangle', dur: 0.35, vol: 0.2 }),
  grab: () => tone({ freq: 300, to: 650, type: 'sine', dur: 0.12, vol: 0.25 }),
  throw: () => noise({ dur: 0.18, vol: 0.15, freq: 1500, type: 'bandpass' }),
  stuff() {
    noise({ dur: 0.35, vol: 0.3, freq: 400 });
    tone({ freq: 120, to: 60, type: 'sawtooth', dur: 0.3, vol: 0.1 });
  },
  reject: () => tone({ freq: 160, type: 'square', dur: 0.25, vol: 0.12 }),
  can: () => tone({ freq: 1200, to: 900, type: 'triangle', dur: 0.06, vol: 0.08 }),
  cash() {
    tone({ freq: 1318, type: 'sine', dur: 0.1, vol: 0.12 });
    tone({ freq: 1760, type: 'sine', dur: 0.18, vol: 0.12, delay: 0.07 });
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
  buy: () => tone({ freq: 600, to: 1200, type: 'triangle', dur: 0.12, vol: 0.18 }),
  click: () => tone({ freq: 800, type: 'sine', dur: 0.04, vol: 0.1 }),
  jump: () => tone({ freq: 300, to: 480, type: 'sine', dur: 0.1, vol: 0.06 }),
};

export const Audio = {
  // Must be called from a user gesture (browser autoplay policy).
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      applyVolume();
    }
    if (ctx.state === 'suspended') ctx.resume();
  },
  setMuted(m) {
    userMuted = m;
    applyVolume();
  },
  get muted() {
    return userMuted;
  },
  setAdMuted(m) {
    adMuted = m;
    applyVolume();
  },
  play(name) {
    if (!ctx || userMuted || adMuted) return;
    SFX[name]?.();
  },
};
