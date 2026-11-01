// Portal SDK wrapper. The build picks the portal (VITE_PLATFORM):
//  - default: CrazyGames HTML5 SDK v3
//  - 'playgama': Playgama Bridge (npm run build:playgama)
// Everything degrades gracefully when no SDK is available (local dev, other portals):
// ads resolve to false, saves use localStorage.
import { createPlaygama } from './PlaygamaPlatform.js';

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const PORTAL = import.meta.env.VITE_PLATFORM || 'crazygames';

let sdk = null;

function loadScript(src, timeout = 5000) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(false), timeout);
  });
}

function safe(fn) {
  try {
    fn();
  } catch (e) {
    console.warn('[Platform]', e);
  }
}

const CrazyPlatform = {
  env: 'none',
  adblock: false,
  onAdStart: null,
  onAdEnd: null,

  async init() {
    const ok = await loadScript(SDK_URL);
    const SDK = window.CrazyGames?.SDK;
    if (!ok || !SDK) return;
    try {
      await SDK.init();
      this.env = SDK.environment;
      if (this.env !== 'disabled') sdk = SDK;
      if (sdk) this.adblock = !!(await sdk.ad.hasAdblock());
    } catch (e) {
      console.warn('[Platform] SDK init failed', e);
    }
  },

  get hasAds() {
    return !!sdk;
  },

  // Rewarded offers are only shown when an ad can actually play.
  get canRewarded() {
    return !!sdk && !this.adblock;
  },

  loadingStart: () => safe(() => sdk?.game.loadingStart()),
  loadingStop: () => safe(() => sdk?.game.loadingStop()),
  gameplayStart: () => safe(() => sdk?.game.gameplayStart()),
  gameplayStop: () => safe(() => sdk?.game.gameplayStop()),
  happytime: () => safe(() => sdk?.game.happytime()),

  // type: 'midgame' | 'rewarded'. Resolves true when the ad played to completion.
  ad(type) {
    return new Promise((resolve) => {
      if (!sdk) return resolve(false);
      const end = (ok) => {
        this.onAdEnd?.();
        resolve(ok);
      };
      try {
        sdk.ad.requestAd(type, {
          adStarted: () => this.onAdStart?.(),
          adFinished: () => end(true),
          adError: () => end(false),
        });
      } catch {
        end(false);
      }
    });
  },

  save(key, value) {
    const s = JSON.stringify(value);
    if (sdk && this.env === 'crazygames') safe(() => sdk.data.setItem(key, s));
    try {
      localStorage.setItem(key, s);
    } catch {}
  },

  load(key) {
    let s = null;
    if (sdk && this.env === 'crazygames') safe(() => (s = sdk.data.getItem(key)));
    if (!s) {
      try {
        s = localStorage.getItem(key);
      } catch {}
    }
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  },
};

export const Platform = PORTAL === 'playgama' ? createPlaygama(loadScript, safe) : CrazyPlatform;
