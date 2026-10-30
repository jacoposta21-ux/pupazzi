// DOM overlay: menus, HUD, shop, toasts and floating numbers. Reads game state, never mutates it directly.
import * as THREE from 'three';
import { t, applyI18n } from '../i18n.js';
import { UPGRADES, UNLOCKS, COSMETICS, WEAPONS, upgradeCost } from '../data/config.js';
import { Audio } from '../systems/Audio.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const _p = new THREE.Vector3();

export class UI {
  constructor(game) {
    this.game = game;
    this.floaters = [];
    this.cache = {};
    applyI18n();
    document.body.classList.toggle('touch', game.isTouch);

    const click = (id, fn) =>
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        Audio.unlock();
        Audio.play('click');
        fn();
      });
    click('btn-new', () => game.newGame());
    click('btn-continue', () => game.continueGame());
    click('btn-resume', () => game.resume());
    click('btn-quit', () => game.toMenu());
    click('btn-next', () => game.nextDay());
    click('btn-double', () => game.doubleEarnings());
    click('btn-touch-pause', () => game.pause());
    this.tab = 'upgrades';
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
    const sens = $('sens');
    sens.value = game.settings.sens;
    sens.addEventListener('input', () => {
      game.settings.sens = parseFloat(sens.value);
      game.saveSettings();
    });
    this.refreshSettings();
    this.shownCash = 0;
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

  showMenu(save) {
    for (const id of ['hud', 'pause', 'dayend', 'touch-ui']) this.show(id, false);
    this.show('menu');
    const cont = $('btn-continue');
    const best = save?.totals?.bestDay || 0;
    $('menu-best').textContent = t('bestDay', { v: best });
    $('menu-best').classList.toggle('hidden', !best);
    if (save && save.day > 1) {
      cont.textContent = t('continue', { day: save.day });
      cont.classList.remove('hidden');
      $('btn-new').classList.remove('primary');
    } else {
      cont.classList.add('hidden');
      $('btn-new').classList.add('primary');
    }
  }

  showGameplay() {
    for (const id of ['menu', 'pause', 'dayend']) this.show(id, false);
    this.show('hud');
    this.show('touch-ui', this.game.isTouch);
    this.cache = {};
  }

  showPause(v) {
    this.show('pause', v);
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
    // cash counts up smoothly and bumps when it grows
    const target = g.data.cash;
    if (target > this.shownCash) {
      this.shownCash = Math.min(target, this.shownCash + Math.max(1, Math.ceil((target - this.shownCash) * 0.15)));
      const pill = $('hud-cash-pill');
      if (!pill.classList.contains('bump')) {
        pill.classList.add('bump');
        setTimeout(() => pill.classList.remove('bump'), 250);
      }
    } else this.shownCash = target;
    this.set('hud-cash', `$${this.shownCash}`);
    this.set('hud-day', t('day', { n: g.data.day }));
    this.set('hud-quota-label', t('quota', { cur: g.dayStats.earned, goal: g.quota }));
    const fill = $('hud-quota-fill');
    const pct = Math.min(100, (g.dayStats.earned / g.quota) * 100);
    fill.style.width = `${pct}%`;
    fill.classList.toggle('done', pct >= 100);

    const timer = $('hud-timer');
    this.set('hud-timer', fmtTime(g.timeLeft));
    timer.classList.toggle('danger', g.timeLeft <= 10);

    let truck;
    if (g.trucks.some((tr) => tr.state === 'unloading')) truck = t('truckHere');
    else if (g.truckSchedule.length) truck = t('truckIn', { s: Math.max(0, Math.ceil(g.truckSchedule[0].at - g.dayTime)) });
    else truck = g.trucks.length ? '' : t('noMoreTrucks');
    this.set('hud-truck', truck);

    const active = g.stuffers.filter((x) => x.enabled);
    const busy = active.reduce((n, x) => n + x.busy, 0);
    const queued = active.reduce((n, x) => n + x.queue.length, 0);
    const blocked = active.some((x) => x.blocked);
    this.set('hud-machine', t('machine', { busy, slots: st.slots * active.length, q: queued }) + (blocked ? t('beltFull') : ''));
    this.set('hud-carry', t('carry', { n: p.carried.length, max: st.carry }));
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
    // weapon bar (only when more than one weapon is owned)
    const list = W.list;
    const bar = list.length > 1 ? list.map((id) => `<div class="slot${id === cur ? ' active' : ''}"><small>${WEAPONS[id].slot}</small>${WEAPONS[id].icon}</div>`).join('') : '';
    this.set('weapon-bar', bar);

    const touch = g.isTouch;
    let prompt = '';
    if (p.aimed) {
      prompt = p.carried.length >= st.carry ? t('handsFull') : t('grab', { key: touch ? '✋ ' : '[E] ', name: t('p_' + p.aimed.type) });
    } else if (p.aimingAtStuffer) {
      prompt = t('throwHint', { key: touch ? '🎯 ' : '[F] ' });
    }
    this.set('prompt', prompt);
    $('crosshair').classList.toggle('target', !!p.aimed || p.aimingAtStuffer);
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
    const keys = { shoot: touch ? '' : '[Click]', grab: touch ? '✋' : '[E]', throw: touch ? '🎯' : '[F]' };
    $('tutorial-text').textContent = t('tut_' + step, { key: keys[step] ?? '' });
    $('tutorial-sub').textContent = this.game.tutorial.holdsClock ? t('tutClock') : '';
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
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
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

  showDayEnd(summary) {
    this.show('hud', false);
    this.show('touch-ui', false);
    this.show('pause', false);
    this.show('dayend');
    $('de-title').textContent = t('dayComplete', { n: summary.day });
    const stat = (v, k, pre = '') => `<div class="stat"><b data-count="${v}" data-pre="${pre}">${pre}0</b><span>${t(k)}</span></div>`;
    $('de-summary').innerHTML =
      stat(summary.stuffed, 'statStuffed') +
      stat(summary.knockouts, 'statKO') +
      stat(summary.shipped, 'statEarned', '$') +
      stat(summary.flushed, 'statFlush', '$');
    // count-up animation
    const els = [...$('de-summary').querySelectorAll('[data-count]')];
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      const e = 1 - Math.pow(1 - k, 3);
      for (const el of els) el.textContent = el.dataset.pre + Math.round(el.dataset.count * e);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const q = $('de-quota');
    q.className = 'quota-result ' + (summary.quotaMet ? 'ok' : 'miss');
    q.textContent = summary.quotaMet
      ? t('quotaMet', { b: summary.bonus })
      : t('quotaMissed', { cur: summary.earned, goal: summary.quota });
    if (summary.record) q.textContent += ' · ' + t('newRecord');
    $('btn-double').classList.toggle('hidden', !summary.canDouble);
    $('btn-double').disabled = false;
    $('btn-double').textContent = t('doubleAd');
    $('btn-next').textContent = t('nextDay', { n: this.game.data.day });
    this.renderShop();
  }

  renderShop() {
    const g = this.game;
    $('de-cash').textContent = `$${g.data.cash}`;
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
    const card = ({ html, disabled, cls = [], onClick }) => {
      const btn = document.createElement('button');
      btn.className = ['upg', ...cls].join(' ');
      btn.disabled = disabled;
      if (!disabled && !cls.length) btn.classList.add('affordable');
      btn.innerHTML = html;
      btn.addEventListener('click', () => {
        if (onClick()) this.renderShop();
      });
      shop.appendChild(btn);
    };

    if (this.tab === 'upgrades') {
      for (const u of UPGRADES) {
        header(u.cat);
        const lvl = g.data.levels[u.id] || 0;
        const maxed = lvl >= u.max;
        const cost = upgradeCost(u, lvl);
        const locked = u.requires && !(g.data.levels[u.requires] > 0);
        card({
          disabled: maxed || locked || cost > g.data.cash,
          html: `
            <div class="name">${u.icon} ${t('u_' + u.id)}</div>
            <div class="desc">${t('d_' + u.id)}</div>
            ${locked ? `<div class="req">${t('requires', { name: t('u_' + u.requires) })}</div>` : ''}
            <div class="row"><span>${t('lvl', { l: lvl, m: u.max })}</span>
            <span class="cost">${maxed ? t('max') : '$' + cost}</span></div>`,
          onClick: () => g.buyUpgrade(u.id),
        });
      }
    } else if (this.tab === 'unlocks') {
      for (const u of UNLOCKS) {
        header(u.cat);
        const owned = !!g.data.unlocks[u.id];
        card({
          disabled: owned || u.cost > g.data.cash,
          cls: owned ? ['owned'] : [],
          html: `
            <div class="name">${u.icon} ${t('u_' + u.id)}</div>
            <div class="desc">${t('d_' + u.id)}</div>
            <div class="row"><span></span>
            <span class="${owned ? 'state' : 'cost'}">${owned ? t('ownedTag') : '$' + u.cost}</span></div>`,
          onClick: () => g.buyUnlock(u.id),
        });
      }
    } else {
      const cos = g.data.cosmetics;
      for (const c of COSMETICS) {
        header('style_' + c.slot);
        const owned = c.cost === 0 || cos.owned.includes(c.id);
        const on = c.slot === 'decor' ? cos.decor.includes(c.id) : cos.equipped[c.slot] === c.id;
        const colors = c.colors ?? (c.color !== undefined ? [c.color] : []);
        const swatches = colors.map((col) => `<span class="swatch" style="background:#${col.toString(16).padStart(6, '0')}"></span>`).join('');
        let state;
        if (!owned) state = `<span class="cost">$${c.cost}</span>`;
        else if (c.slot === 'decor') state = `<span class="state">${t(on ? 'decorOn' : 'decorOff')}</span>`;
        else state = `<span class="state">${t(on ? 'equipped' : 'equip')}</span>`;
        card({
          disabled: (!owned && c.cost > g.data.cash) || (owned && on && c.slot !== 'decor'),
          cls: on ? ['equipped'] : owned ? ['owned'] : [],
          html: `
            <div class="name">${swatches}${t('c_' + c.id)}</div>
            <div class="row"><span></span>${state}</div>`,
          onClick: () => g.buyCosmetic(c.id),
        });
      }
    }
  }

  markDoubled(value) {
    const btn = $('btn-double');
    btn.disabled = true;
    btn.textContent = t('doubled', { v: value });
    this.renderShop();
  }
}
