// Poki SDK backend for Platform (same interface as the CrazyGames one).
// The Poki SDK is the only external script allowed on Poki; everything else is bundled.
// Ad frequency is entirely Poki's: the game just offers a commercialBreak at each natural pause.
const SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

export function createPoki(loadScript, safe) {
  let sdk = null;
  const P = {
    env: 'poki',
    adblock: false,
    onAdStart: null,
    onAdEnd: null,
    // Poki rules: ad breaks when going back into gameplay, every arena round, no custom ad-block messages
    breakOnResume: true,
    arenaBreakEvery: 1,
    silentAds: true,
    autoStart: true, // straight into the game, no main menu

    async init() {
      const ok = await loadScript(SDK_URL, 8000);
      if (!ok || !window.PokiSDK) return;
      sdk = window.PokiSDK;
      try {
        await sdk.init();
      } catch {
        // ad blocker: the game stays fully playable, Poki handles the messaging
        P.adblock = true;
      }
    },

    get hasAds() {
      return !!sdk;
    },
    // rewarded buttons stay visible: with an ad blocker the video simply grants nothing
    get canRewarded() {
      return !!sdk;
    },

    loadingStart() {},
    loadingStop: () => safe(() => sdk?.gameLoadingFinished()),
    gameplayStart: () => safe(() => sdk?.gameplayStart()),
    gameplayStop: () => safe(() => sdk?.gameplayStop()),
    happytime() {},

    // type: 'midgame' | 'rewarded'. Resolves true when the ad played (rewarded: reward granted).
    ad(type) {
      if (!sdk) return Promise.resolve(false);
      let started = false;
      const onStart = () => {
        started = true;
        P.onAdStart?.();
      };
      const call = type === 'rewarded' ? sdk.rewardedBreak(onStart) : sdk.commercialBreak(onStart);
      return Promise.resolve(call)
        .then((r) => (type === 'rewarded' ? !!r : true))
        .catch(() => false)
        .finally(() => started && P.onAdEnd?.());
    },

    save(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },

    load(key) {
      try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
  };
  return P;
}
