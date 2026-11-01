// Playgama Bridge backend for Platform (same interface as the CrazyGames one).
// Docs: https://github.com/playgama/bridge — the CDN script only downloads the current portal's adapter.
// Saves are read once at start-up into a cache (the game reads them synchronously) and written through.
import { SAVE_KEY, SETTINGS_KEY } from '../data/config.js';

const BRIDGE_URL = 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';
const KEYS = [SAVE_KEY, SETTINGS_KEY];

export function createPlaygama(loadScript, safe) {
  let bridge = null;
  let ready = false;
  const cache = {};

  const local = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  const P = {
    env: 'playgama',
    adblock: false,
    onAdStart: null,
    onAdEnd: null,

    async init() {
      const ok = await loadScript(BRIDGE_URL, 8000);
      if (!ok || !window.bridge) return;
      try {
        await window.bridge.initialize();
        bridge = window.bridge;
        const E = bridge.EVENT_NAME;
        // the portal can mute or pause the game (e.g. its own ads, tab switches)
        bridge.platform.on?.(E.AUDIO_STATE_CHANGED, (on) => (on ? P.onAdEnd?.() : P.onAdStart?.()));
        bridge.platform.on?.(E.PAUSE_STATE_CHANGED, (paused) => (paused ? P.onAdStart?.() : P.onAdEnd?.()));
        const values = await bridge.storage.get(KEYS, false).catch(() => null);
        if (Array.isArray(values)) KEYS.forEach((k, i) => values[i] != null && (cache[k] = values[i]));
      } catch (e) {
        console.warn('[Platform] Playgama Bridge init failed', e);
        bridge = null;
      }
    },

    get hasAds() {
      return !!bridge?.advertisement.isInterstitialSupported;
    },

    get canRewarded() {
      return !!bridge?.advertisement.isRewardedSupported;
    },

    send(msg) {
      safe(() => bridge?.platform.sendMessage(msg));
    },
    loadingStart() {},
    loadingStop() {
      if (ready) return;
      ready = true;
      P.send('game_ready');
    },
    gameplayStart: () => P.send('gameplay_started'),
    gameplayStop: () => P.send('gameplay_stopped'),
    happytime() {},

    // type: 'midgame' | 'rewarded'. Resolves true when the ad played (rewarded: reward granted).
    ad(type) {
      return new Promise((resolve) => {
        if (!bridge) return resolve(false);
        const A = bridge.advertisement;
        const rewarded = type === 'rewarded';
        const event = rewarded ? bridge.EVENT_NAME.REWARDED_STATE_CHANGED : bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED;
        let opened = false;
        let granted = false;
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          A.off?.(event, onState);
          if (opened) P.onAdEnd?.();
          resolve(ok);
        };
        const onState = (state) => {
          if (state === 'opened') {
            opened = true;
            P.onAdStart?.();
          } else if (state === 'rewarded') granted = true;
          else if (state === 'closed') finish(rewarded ? granted : true);
          else if (state === 'failed') finish(false);
        };
        A.on(event, onState);
        // an interstitial can be skipped by the portal (minimum delay): don't wait forever
        setTimeout(() => !opened && finish(false), rewarded ? 15000 : 4000);
        try {
          if (rewarded) A.showRewarded();
          else A.showInterstitial();
        } catch {
          finish(false);
        }
      });
    },

    save(key, value) {
      const s = JSON.stringify(value);
      cache[key] = s;
      local.set(key, s);
      if (bridge) bridge.storage.set(key, s).catch(() => {});
    },

    load(key) {
      const s = cache[key] ?? local.get(key);
      try {
        return s ? (typeof s === 'string' ? JSON.parse(s) : s) : null;
      } catch {
        return null;
      }
    },
  };
  return P;
}
