// DOM overlay: menus, HUD, shop terminal, build bar, toasts and floating numbers.
// Reads game state; purchases go through GameManager methods.
import * as THREE from 'three';
import { t, applyI18n, lang } from '../i18n.js';
import {
  UPGRADES, UNLOCKS, COSMETICS, WEAPONS, PLACEABLES, LEGENDARY_WEAPONS, GOAL, AD_NUGGETS, BELT_PRICE, BELT_PACK, adCashReward,
  upgradeCost, placeableCost, levelThreshold, MAX_LEVEL, ARENA_SHOP, PLUSHIES,
} from '../data/config.js';
import { Platform } from '../systems/Platform.js';
import { Audio } from '../systems/Audio.js';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();
const locale = lang === 'it' ? 'it-IT' : 'en-US';
const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 });
const full = new Intl.NumberFormat(locale);

export class UI {
  constructor(game) {
    this.game = game;
    this.floaters = [];
    this.cache = {};
    this.tab = 'upgrades';
    this.victoryOpen = false;
    applyI18n();
    document.body.classList.toggle('touch', game.isTouch);

    const click = (id, fn) =>
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        Audio.unlock();
        Audio.play('click');
        fn();
      });
    click('btn-new', () => this.onNewGame());
    click('btn-continue', () => game.continueGame());
    click('btn-resume', () => game.resume());
    click('btn-quit', () => game.toMenu());
    click('btn-close-shop', () => game.closeShop());
    click('btn-victory', () => game.closeVictory());
    click('btn-touch-pause', () => game.pause());
    click('btn-leave-arena', () => game.exitArena());
    click('btn-arena-retry', () => game.arenaRetry());
    click('btn-arena-restart', () => game.arenaRestart());
    click('btn-arena-leave', () => game.exitArena());
    document.querySelectorAll('.tab').forEach((el) =>
      el.addEventListener('click', () => {
        Audio.play('click');
        this.tab = el.dataset.tab;
        this.renderShop();
      }),
    );
    const each = (cls, fn) =>
      document.querySelectorAll(cls).forEach((el) =>
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          Audio.unlock();
          fn();
          Audio.play('click');
          game.saveSettings();
          this.refreshSettings();
        }),
      );
    each('.set-sound', () => {
      game.settings.muted = !game.settings.muted;
      Audio.setMuted(game.settings.muted);
    });
    each('.set-music', () => {
      game.settings.music = !game.settings.music;
      Audio.setMusicMuted(!game.settings.music);
    });
    each('.set-quality', () => {
      const order = ['low', 'medium', 'high'];
      game.setQuality(order[(order.indexOf(game.settings.quality) + 1) % order.length]);
    });
    // Clicking anywhere on the pause backdrop also resumes (desktop pointer lock needs a click).
    $('pause').addEventListener('click', (e) => {
      if (e.target.id === 'pause') game.resume();
    });
    addEventListener('keydown', (e) => {
      if (game.shopOpen && (e.code === 'Escape' || e.code === 'KeyE')) game.closeShop();
    });
    const sens = $('sens');
    sens.value = game.settings.sens;
    sens.addEventListener('input', () => {
      game.settings.sens = parseFloat(sens.value);
      game.saveSettings();
    });
    this.refreshSettings();
    this.shownCash = 0;
  }

  money(v) {
    // arena coins in the arena, dollars in the factory
    if (this.game.mode === 'arena') return '🪙' + full.format(Math.round(v));
    return '$' + (v >= 100000 ? compact.format(v) : full.format(Math.round(v)));
  }

  refreshSettings() {
    const st = this.game.settings;
    const setAll = (cls, text) => document.querySelectorAll(cls).forEach((el) => (el.textContent = text));
    setAll('.set-sound', t(st.muted ? 'soundOff' : 'soundOn'));
    setAll('.set-music', t(st.music ? 'musicOn' : 'musicOff'));
    setAll('.set-quality', t('quality', { q: t('q_' + st.quality) }));
  }

  show(id, visible = true) {
    $(id).classList.toggle('hidden', !visible);
  }

  hideLoading() {
    this.show('loading', false);
  }

  // New game over an existing save needs a second click to confirm.
  onNewGame() {
    const btn = $('btn-new');
    if (this.game.save && !this.confirmNew) {
      this.confirmNew = true;
      btn.textContent = t('confirmNew');
      btn.classList.add('danger');
      return;
    }
    this.confirmNew = false;
    this.game.newGame();
  }

  showMenu(save) {
    for (const id of ['hud', 'pause', 'shop-screen', 'victory', 'touch-ui']) this.show(id, false);
    this.show('menu');
    this.confirmNew = false;
    const btnNew = $('btn-new');
    btnNew.textContent = t('newGame');
    btnNew.classList.remove('danger');
    const cont = $('btn-continue');
    const earned = save?.earned ?? save?.totals?.earned ?? 0;
    const has = !!save && (earned > 0 || save.day > 1 || save.placed?.length);
    $('menu-progress').textContent = t('menuProgress', { v: this.money(earned), g: this.money(GOAL) });
    $('menu-progress').classList.toggle('hidden', !has);
    cont.textContent = t('continue');
    cont.classList.toggle('hidden', !has);
    btnNew.classList.toggle('primary', !has);
  }

  showGameplay() {
    for (const id of ['menu', 'pause', 'shop-screen', 'victory']) this.show(id, false);
    this.show('hud');
    this.show('touch-ui', this.game.isTouch);
    this.cache = {};
  }

  showPause(v) {
    this.show('pause', v);
  }

  showShop(v) {
    this.show('shop-screen', v);
    this.show('touch-ui', !v && this.game.isTouch);
    if (v) this.renderShop();
  }

  // Big centred title for round starts, bosses, round cleared...
  arenaBanner(titleKey, subKey = null, vars = {}) {
    $('banner-title').textContent = t(titleKey, vars);
    $('banner-sub').textContent = subKey ? t(subKey, vars) : '';
    const el = $('banner');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  showArenaOver({ round, kills, coins, best, record }) {
    this.arenaOverOpen = true;
    $('arena-over-text').textContent = t('arenaOverText', { r: round, k: full.format(kills), c: full.format(coins) });
    $('arena-over-record').textContent = record ? t('arenaNewRecord', { r: best }) : t('arenaBest', { r: best });
    const retry = $('btn-arena-retry');
    const can = Platform.canRewarded || import.meta.env.VITE_CHEATS === '1';
    retry.textContent = can ? t('arenaRetry', { r: round }) : t('arenaRetryNoAd');
    retry.disabled = !can;
    this.show('touch-ui', false);
    this.show('arena-over');
  }

  hideArenaOver() {
    if (!this.arenaOverOpen) return;
    this.arenaOverOpen = false;
    this.show('arena-over', false);
    this.show('touch-ui', this.game.isTouch);
  }

  updateShopTimer() {
    const A = this.game.arena;
    this.set('shop-timer', t(A.phase === 'intro' ? 'shopTimerFirst' : 'shopTimer', { s: Math.max(0, Math.ceil(A.timer)) }));
  }

  showVictory() {
    this.victoryOpen = true;
    const T = this.game.data.totals;
    $('victory-text').textContent = t('victoryText', { s: full.format(T.stuffed), k: full.format(T.knockouts), n: T.nuggets || 0 });
    this.show('victory');
  }

  hideVictory() {
    this.victoryOpen = false;
    this.show('victory', false);
  }

  set(id, text) {
    if (this.cache[id] !== text) {
      this.cache[id] = text;
      $(id).innerHTML = text;
    }
  }

  updateHud() {
    const g = this.game;
    const st = g.stats;
    const p = g.player;
    const D = g.data;

    // cash counts up smoothly and bumps when it grows
    if (D.cash > this.shownCash) {
      this.shownCash = Math.min(D.cash, this.shownCash + Math.max(1, Math.ceil((D.cash - this.shownCash) * 0.15)));
      const pill = $('hud-cash-pill');
      if (!pill.classList.contains('bump')) {
        pill.classList.add('bump');
        setTimeout(() => pill.classList.remove('bump'), 250);
      }
    } else this.shownCash = D.cash;
    const arena = g.mode === 'arena';
    this.set('hud-cash-icon', arena ? '' : '💰');
    this.set('hud-cash', this.money(this.shownCash));
    if (arena) this.updateArenaHud();
    this.set('hud-nuggets', `💎 ${D.nuggets}`);

    // factory level + $1M goal
    const L = g.level;
    const lo = levelThreshold(L);
    const hi = levelThreshold(L + 1);
    this.set('hud-level', t('level', { n: L }));
    $('hud-level-fill').style.width = L >= MAX_LEVEL ? '100%' : `${Math.min(100, ((D.earned - lo) / (hi - lo)) * 100)}%`;
    this.set('hud-goal', t('goal', { v: this.money(D.earned), g: this.money(GOAL) }));

    // deliveries
    let truck;
    if (g.trucks.some((tr) => tr.state === 'unloading')) truck = t('truckHere');
    else if (g.trucks.some((tr) => tr.state === 'arriving')) truck = t('truckComing');
    else if (g.plushies.count >= 70) truck = t('factoryFull');
    else truck = t('truckIn', { s: Math.max(0, Math.ceil(g.nextTruck)) });
    this.set('hud-truck', truck);

    // machines
    const busy = g.stuffers.reduce((n, x) => n + x.busy, 0);
    const queued = g.stuffers.reduce((n, x) => n + x.queue.length, 0);
    const blocked = g.stuffers.some((x) => x.blocked);
    this.set('hud-machine', t('machine', { busy, slots: st.slots * g.stuffers.length, q: queued }) + (blocked ? t('beltFull') : ''));

    // mission
    const m = g.missions.current;
    this.show('mission', !!m);
    if (m) {
      $('mission').classList.toggle('done', !!m.done);
      this.set('mission-title', (m.done ? '✅ ' : '🎯 ') + t('m_' + m.id, { n: this.missionGoal(m), type: m.target ? t('p_' + m.target) : '' }));
      $('mission-fill').style.width = `${(m.progress / m.goal) * 100}%`;
      this.set('mission-progress', m.id === 'ship' ? `${this.money(m.progress)} / ${this.money(m.goal)}` : `${m.progress} / ${m.goal}`);
      this.set('mission-time', m.done ? `+${this.money(m.reward)}${m.nugget ? ' 💎' : ''}` : `⏱ ${Math.ceil(m.time)}s · ${this.money(m.reward)}${m.nugget ? ' 💎' : ''}`);
    }

    // the load: one icon per carried item (the one in hand is the last)
    const icons = p.carried.map((it) => (it.kind === 'can' ? '🥫' : '🧸'));
    const shown = icons.length > 8 ? icons.slice(-8).join('') + `+${icons.length - 8}` : icons.join('');
    this.set('hud-carry', `${shown || '✋'} <small>${p.carried.length}/${st.carry}</small>`);

    // build mode vs weapons
    const B = g.build;
    this.show('build-bar', B.active);
    this.show('weapon-bar', !B.active);
    this.show('hud-ammo', !B.active);
    if (B.active) {
      const inv = D.inventory;
      // slot 0 = free hand, then everything in the bag
      const hand = `<div class="slot${!B.type ? ' active' : ''}">✋</div>`;
      this.set(
        'build-items',
        hand +
          B.tools
            .map((id, i) => {
              const icon = id === 'belt' ? '➡️' : PLACEABLES.find((x) => x.id === id).icon;
              const count = id === 'belt' ? `${inv.belt}m` : inv[id];
              return `<div class="slot${id === B.type ? ' active' : ''}"><small>${i + 1}</small>${icon}<b>${count}</b></div>`;
            })
            .join(''),
      );
      const sellFor = (type) => {
        const v = g.resaleValue(type);
        return v.cash ? this.money(v.cash) : `💎 ${v.nuggets}`;
      };
      let hint;
      if (!B.type) hint = t(g.isTouch ? 'handHintTouch' : 'handHint');
      else if (B.type === 'belt') {
        hint = `<b>${t('pl_belt')} (${inv.belt} m)</b> · ` + (B.beltStart
          ? t('beltHintEnd', { n: B.path.length, c: B.pathNew }) + (B.valid ? '' : ` · <span class="bad">${t(B.pathNew > (inv.belt || 0) ? 'beltNoMetres' : 'beltBlocked')}</span>`)
          : t(g.isTouch ? 'beltHintStartTouch' : 'beltHintStart'));
      } else hint = `<b>${t('pl_' + B.type)}</b> · ` + t(g.isTouch ? 'buildHintTouch' : 'buildHint', { v: sellFor(B.type) });
      this.set('build-hint', hint);
      this.buildSellFor = sellFor;
    } else {
      const W = p.weapons;
      const cur = W.current;
      const mag = W.mag(cur);
      this.set(
        'hud-ammo',
        W.reloading
          ? `<small>${t('reloading')}</small>`
          : mag === Infinity
            ? `${WEAPONS[cur].icon} <small>∞</small>`
            : `${WEAPONS[cur].icon} ${W.ammo[cur]}<small> / ${mag}</small>`,
      );
      const list = W.list;
      this.set('weapon-bar', list.length > 1 ? list.map((id) => `<div class="slot${id === cur ? ' active' : ''}"><small>${WEAPONS[id].slot}</small>${WEAPONS[id].icon}</div>`).join('') : '');
    }

    const touch = g.isTouch;
    let prompt = '';
    if (B.active) {
      const target = B.hovered?.type ?? (B.hoveredTile ? 'belt' : null);
      if (target) prompt = t('moveSellHint', { e: touch ? '✋' : '[E]', x: touch ? '💲' : '[X]', v: this.buildSellFor(target), name: t('pl_' + target) });
    }
    else if (p.aimed) {
      const gem = p.aimed.kind === 'can' && p.aimed.revealed && p.aimed.nugget ? ' 💎' : '';
      const name = (p.aimed.kind === 'can' ? t('canName') : t('p_' + p.aimed.type)) + gem;
      prompt = p.carried.length >= st.carry ? t('handsFull') : t('grab', { key: touch ? '✋ ' : '[E] ', name });
    }
    else if (p.atTerminal && arena) prompt = t(g.arena.shopAvailable ? 'arenaShopHint' : 'arenaShopClosed', { key: touch ? '✋ ' : '[E] ' });
    else if (p.atTerminal) prompt = t('terminalHint', { key: touch ? '✋ ' : '[E] ' });
    else if (p.atConsole) prompt = t('consoleHint', { key: touch ? '✋ ' : '[E] ', r: D.arena?.best || 0 });
    else if (p.aimingAtStuffer) prompt = t('throwHint', { key: touch ? '🎯 ' : '[F] ' });
    this.set('prompt', prompt);
    $('crosshair').classList.toggle('target', !!p.aimed || p.aimingAtStuffer || p.atTerminal || p.atConsole);
  }

  updateArenaHud() {
    const A = this.game.arena;
    const touch = this.game.isTouch;
    this.set('arena-round', A.round > 0 ? t('roundN', { n: A.round }) : t('arenaTitle'));
    const k = Math.max(0, A.coreHp / A.coreMax);
    const fill = $('arena-core-fill');
    fill.style.width = `${k * 100}%`;
    fill.classList.toggle('mid', k <= 0.5 && k > 0.25);
    fill.classList.toggle('low', k <= 0.25);
    this.set('arena-core-text', `🏭 ${Math.ceil(A.coreHp)} / ${A.coreMax}`);
    let status = '';
    const key = touch ? '▶️' : '[G]';
    if (A.phase === 'intro' || A.phase === 'break') status = t(A.phase === 'intro' ? 'arenaStartsIn' : 'breakIn', { s: Math.ceil(A.timer), key: `<span class="key">${key}</span>` });
    else if (A.phase === 'retry') status = t('retryIn', { s: Math.ceil(A.timer) });
    else if (A.phase === 'round') {
      const left = A.toSpawn + this.game.plushies.list.filter((x) => x.arena).length + (A.bossPending ? 1 : 0);
      status = t('enemiesLeft', { n: left });
    }
    this.set('arena-status', status);
    document.querySelector('[data-btn="ready"]')?.classList.toggle('hidden', !(A.phase === 'intro' || A.phase === 'break'));
    const b = A.boss;
    this.show('boss-bar', !!b && b.state !== 'gone');
    if (b && b.state !== 'gone') {
      this.set('boss-name', `👑 ${t('p_' + b.type)}`);
      const max = b.maxHp + (b.maxArmor || 0);
      $('boss-fill').style.width = `${Math.max(0, ((b.hp + (b.armor || 0)) / max) * 100)}%`;
    }
  }

  missionGoal(m) {
    return m.id === 'ship' ? this.money(m.goal) : m.goal;
  }

  hitmarker(ko, armor = false) {
    const el = $('hitmarker');
    el.classList.toggle('ko', ko);
    el.classList.toggle('armor', armor);
    el.classList.add('show');
    clearTimeout(this.hmTimer);
    this.hmTimer = setTimeout(() => el.classList.remove('show'), 90);
  }

  tutorial(step) {
    this.show('tutorial', !!step);
    if (!step) return;
    const touch = this.game.isTouch;
    const keys = { shoot: touch ? '' : '[Click]', grab: touch ? '✋' : '[E]', throw: touch ? '🎯' : '[F]', terminal: touch ? '✋' : '[E]' };
    $('tutorial-text').textContent = t('tut_' + step, { key: keys[step] ?? '' });
    const el = $('tutorial');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  toast(key, vars) {
    const el = $('toast');
    el.textContent = t(key, vars);
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  floater(text, pos, cls = '') {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    $('floaters').appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), life: 1.2 });
  }

  updateFloaters(dt) {
    const cam = this.game.camera;
    const w = innerWidth, h = innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.pos.y += dt * 0.8;
      _p.copy(f.pos).project(cam);
      if (f.life <= 0 || _p.z > 1) {
        if (f.life <= 0) {
          f.el.remove();
          this.floaters.splice(i, 1);
        } else f.el.style.display = 'none';
        continue;
      }
      f.el.style.display = '';
      f.el.style.left = `${(_p.x * 0.5 + 0.5) * w}px`;
      f.el.style.top = `${(-_p.y * 0.5 + 0.5) * h}px`;
      f.el.style.opacity = Math.min(1, f.life * 2);
    }
  }

  clearFloaters() {
    for (const f of this.floaters) f.el.remove();
    this.floaters.length = 0;
  }

  // ---------- Shop terminal ----------

  renderShop() {
    if (this.game.mode === 'arena') return this.renderArenaShop();
    const g = this.game;
    const D = g.data;
    document.querySelector('#shop-screen h2').textContent = t('terminalTitle');
    $('btn-close-shop').textContent = t('closeShop');
    $('shop-cash').textContent = this.money(D.cash);
    $('shop-nuggets').textContent = D.nuggets;
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === this.tab));
    const shop = $('shop');
    shop.innerHTML = '';
    let cat = null;
    const header = (c) => {
      if (c === cat) return;
      cat = c;
      const h = document.createElement('div');
      h.className = 'shop-cat';
      h.textContent = t('cat_' + c);
      shop.appendChild(h);
    };
    const note = (key) => {
      const n = document.createElement('div');
      n.className = 'shop-note';
      n.textContent = t(key);
      shop.appendChild(n);
    };
    const card = ({ html, disabled, cls = [], onClick }) => {
      const btn = document.createElement('button');
      btn.className = ['upg', ...cls].join(' ');
      btn.disabled = disabled;
      if (!disabled && !cls.length) btn.classList.add('affordable');
      btn.innerHTML = html;
      btn.addEventListener('click', async () => {
        const ok = await onClick();
        if (import.meta.env.VITE_CHEATS === '1') this.game.topUpCheats();
        if (ok) this.renderShop();
      });
      shop.appendChild(btn);
    };
    const price = (v, nuggets) => (nuggets ? `💎 ${v}` : this.money(v));

    if (this.tab === 'upgrades') {
      for (const u of UPGRADES) {
        header(u.cat);
        const lvl = D.levels[u.id] || 0;
        const maxed = lvl >= u.max;
        const cost = upgradeCost(u, lvl);
        const locked = u.requiresPlaced && !(D.bought[u.requiresPlaced] > 0);
        card({
          disabled: maxed || locked || cost > D.cash,
          html: `
            <div class="name">${u.icon} ${t('u_' + u.id)}</div>
            <div class="desc">${t('d_' + u.id)}</div>
            ${locked ? `<div class="req">${t('requires', { name: t('pl_' + u.requiresPlaced) })}</div>` : ''}
            <div class="row"><span>${t('lvl', { l: lvl, m: u.max })}</span>
            <span class="cost">${maxed ? t('max') : this.money(cost)}</span></div>`,
          onClick: () => g.buyUpgrade(u.id),
        });
      }
    } else if (this.tab === 'machines' || this.tab === 'legendary') {
      const legendary = this.tab === 'legendary';
      note(legendary ? 'legendaryNote' : 'machinesNote');
      if (!legendary) {
        // belts: bought by the metre in packs, into the bag like every other machine
        card({
          disabled: D.cash < BELT_PRICE * BELT_PACK,
          html: `
            <div class="name">➡️ ${t('pl_belt')} ×${BELT_PACK} m</div>
            <div class="desc">${t('pd_belt')}</div>
            <div class="row"><span>${t('beltBag', { n: D.inventory.belt || 0, l: g.beltNet.list.filter((x) => !x.fixed).length })}</span>
            <span class="cost">${this.money(BELT_PRICE * BELT_PACK)}</span></div>`,
          onClick: () => g.buyBelts(),
        });
      }
      for (const def of PLACEABLES.filter((x) => !!x.legendary === legendary && !x.arena)) {
        const cost = placeableCost(def, D.bought[def.id] || 0);
        const have = D.inventory[def.id] || 0;
        const placed = D.placed.filter((x) => x.type === def.id).length;
        card({
          disabled: def.nuggets ? D.nuggets < cost : D.cash < cost,
          cls: legendary ? ['legendary'] : [],
          html: `
            <div class="name">${def.icon} ${t('pl_' + def.id)}</div>
            <div class="desc">${t('pd_' + def.id)}</div>
            <div class="row"><span>${t('ownedCount', { p: placed, i: have })}</span>
            <span class="cost">${price(cost, def.nuggets)}</span></div>`,
          onClick: () => g.buyPlaceable(def.id),
        });
      }
      if (legendary) {
        for (const w of LEGENDARY_WEAPONS) {
          const owned = !!D.unlocks[w.id];
          card({
            disabled: owned || D.nuggets < w.nuggets,
            cls: owned ? ['owned'] : ['legendary'],
            html: `
              <div class="name">${w.icon} ${t('u_' + w.id)}</div>
              <div class="desc">${t('d_' + w.id)}</div>
              <div class="row"><span></span>
              <span class="${owned ? 'state' : 'cost'}">${owned ? t('ownedTag') : price(w.nuggets, true)}</span></div>`,
            onClick: () => g.buyLegendaryWeapon(w.id),
          });
        }
      }
    } else if (this.tab === 'unlocks') {
      for (const u of UNLOCKS) {
        header(u.cat);
        const owned = !!D.unlocks[u.id];
        card({
          disabled: owned || u.cost > D.cash,
          cls: owned ? ['owned'] : [],
          html: `
            <div class="name">${u.icon} ${t('u_' + u.id)}</div>
            <div class="desc">${t('d_' + u.id)}</div>
            <div class="row"><span></span>
            <span class="${owned ? 'state' : 'cost'}">${owned ? t('ownedTag') : this.money(u.cost)}</span></div>`,
          onClick: () => g.buyUnlock(u.id),
        });
      }
    } else if (this.tab === 'style') {
      const cos = D.cosmetics;
      for (const c of COSMETICS) {
        header('style_' + c.slot);
        const owned = c.cost === 0 || cos.owned.includes(c.id);
        const on = c.slot === 'decor' ? cos.decor.includes(c.id) : cos.equipped[c.slot] === c.id;
        const colors = c.colors ?? (c.color !== undefined ? [c.color] : []);
        const swatches = colors.map((col) => `<span class="swatch" style="background:#${col.toString(16).padStart(6, '0')}"></span>`).join('');
        let state;
        if (!owned) state = `<span class="cost">${this.money(c.cost)}</span>`;
        else if (c.slot === 'decor') state = `<span class="state">${t(on ? 'decorOn' : 'decorOff')}</span>`;
        else state = `<span class="state">${t(on ? 'equipped' : 'equip')}</span>`;
        card({
          disabled: (!owned && c.cost > D.cash) || (owned && on && c.slot !== 'decor'),
          cls: on ? ['equipped'] : owned ? ['owned'] : [],
          html: `
            <div class="name">${swatches}${t('c_' + c.id)}</div>
            <div class="row"><span></span>${state}</div>`,
          onClick: () => g.buyCosmetic(c.id),
        });
      }
    } else {
      // Bonus: rewarded ads only — a nugget, or cash scaled to the factory level
      note(Platform.canRewarded ? 'bonusNote' : 'bonusUnavailable');
      const offers = [
        { kind: 'nugget', title: `💎 ${t('ad_nugget', { n: AD_NUGGETS })}`, desc: t('adD_nugget') },
        { kind: 'cash', title: `💰 ${t('ad_cash', { v: this.money(adCashReward(g.level)) })}`, desc: t('adD_cash') },
      ];
      for (const o of offers) {
        const wait = Math.ceil(g.adWait(o.kind));
        card({
          disabled: !Platform.canRewarded || wait > 0,
          cls: ['ad-offer'],
          html: `
            <div class="name">${o.title}</div>
            <div class="desc">${o.desc}</div>
            <div class="row"><span></span><span class="cost">${wait > 0 ? t('adWait', { s: wait }) : '📺 ' + t('watchAd')}</span></div>`,
          onClick: async () => {
            const ok = await g.watchAd(o.kind);
            if (ok) this.toast('adThanks');
            return true;
          },
        });
      }
    }
  }

  // ---------- Arena shop stall ----------

  renderArenaShop() {
    const g = this.game;
    const A = g.arena;
    const D = g.data;
    $('shop-cash').textContent = this.money(D.cash);
    $('shop-nuggets').textContent = g.career?.nuggets ?? 0;
    document.querySelector('#shop-screen h2').textContent = t('arenaShopTitle');
    $('btn-close-shop').textContent = t('closeArenaShop');
    this.updateShopTimer();
    const shop = $('shop');
    shop.innerHTML = '';
    let cat = null;
    for (const item of ARENA_SHOP) {
      if (item.cat !== cat) {
        cat = item.cat;
        const h = document.createElement('div');
        h.className = 'shop-cat';
        h.textContent = t('acat_' + cat);
        shop.appendChild(h);
      }
      const cost = A.priceOf(item);
      const avail = A.available(item);
      const owned = item.kind === 'weapon' && D.unlocks[item.id];
      let info = '';
      if (item.kind === 'upgrade') info = t('lvl', { l: D.levels[item.id] || 0, m: item.max });
      else if (item.kind === 'placeable') info = t('ownedCount', { p: D.placed.filter((x) => x.type === item.id).length, i: D.inventory[item.id] || 0 });
      else if (item.kind === 'repair') info = `🏭 ${Math.ceil(A.coreHp)} / ${A.coreMax}`;
      const btn = document.createElement('button');
      btn.className = 'upg' + (owned ? ' owned' : '');
      btn.disabled = !avail || D.cash < cost;
      if (!btn.disabled) btn.classList.add('affordable');
      const right = owned ? `<span class="state">${t('ownedTag')}</span>` : !avail ? `<span class="state">${t('max')}</span>` : `<span class="cost">${this.money(cost)}</span>`;
      btn.innerHTML = `
        <div class="name">${item.icon} ${t('a_' + item.id)}</div>
        <div class="desc">${t('ard_' + item.id)}</div>
        <div class="row"><span>${info}</span>${right}</div>`;
      btn.addEventListener('click', () => {
        if (A.buy(item.id)) this.renderArenaShop();
        else Audio.play('reject');
      });
      shop.appendChild(btn);
    }
  }
}
