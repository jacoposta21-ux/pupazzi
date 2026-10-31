// Keyboard + mouse (pointer lock) and touch controls, exposed as high-level actions.
export class Input {
  constructor(game) {
    this.game = game;
    this.canvas = game.canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = [false, false, false];
    this.mousePressed = [false, false, false];
    this.lookX = 0;
    this.lookY = 0;
    this.wheelDelta = 0;
    this.locked = false;
    this.touch = { x: 0, y: 0, fire: false, sprint: false };
    this.touchPressed = new Set();

    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.fill(false);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    addEventListener('mouseup', (e) => (this.mouse[e.button] = false));
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheelDelta += e.deltaY;
      },
      { passive: true },
    );
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouse.fill(false);
      game.onLockChange(this.locked);
    });

    if (game.isTouch) this.setupTouch();
  }

  requestLock() {
    if (this.game.isTouch || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      p?.catch?.(() => {});
    } catch {}
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setupTouch() {
    const joyZone = document.getElementById('joy-zone');
    const joyBase = document.getElementById('joy-base');
    const knob = document.getElementById('joy-knob');
    const R = 55;
    let joyId = null, ox = 0, oy = 0;

    joyZone.addEventListener('pointerdown', (e) => {
      joyId = e.pointerId;
      const rect = joyZone.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      joyBase.style.left = `${e.clientX - rect.left - 60}px`;
      joyBase.style.top = `${e.clientY - rect.top - 60}px`;
      joyBase.style.bottom = 'auto';
      joyZone.setPointerCapture(e.pointerId);
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.x = dx / R;
      this.touch.y = -dy / R;
      this.touch.sprint = len > R * 0.95;
    });
    const joyEnd = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      this.touch.x = this.touch.y = 0;
      this.touch.sprint = false;
      knob.style.transform = '';
    };
    joyZone.addEventListener('pointerup', joyEnd);
    joyZone.addEventListener('pointercancel', joyEnd);

    const look = document.getElementById('look-zone');
    let lookId = null, lx = 0, ly = 0;
    look.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      look.setPointerCapture(e.pointerId);
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.lookX += (e.clientX - lx) * 2.2;
      this.lookY += (e.clientY - ly) * 2.2;
      lx = e.clientX;
      ly = e.clientY;
    });
    const lookEnd = (e) => e.pointerId === lookId && (lookId = null);
    look.addEventListener('pointerup', lookEnd);
    look.addEventListener('pointercancel', lookEnd);

    document.querySelectorAll('[data-btn]').forEach((btn) => {
      const name = btn.dataset.btn;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('active');
        if (name === 'fire') {
          this.touch.fire = true;
          this.touchPressed.add('fire');
        } else this.touchPressed.add(name);
      });
      const up = () => {
        btn.classList.remove('active');
        if (name === 'fire') this.touch.fire = false;
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
  }

  get move() {
    let x = this.touch.x, y = this.touch.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    return { x, y };
  }

  get sprint() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.sprint;
  }
  get fire() {
    return this.mouse[0] || this.touch.fire;
  }
  get grabPressed() {
    return this.pressed.has('KeyE') || this.touchPressed.has('grab');
  }
  get throwPressed() {
    return this.pressed.has('KeyF') || this.mousePressed[2] || this.touchPressed.has('throw');
  }
  get jumpPressed() {
    return this.pressed.has('Space') || this.touchPressed.has('jump');
  }
  // 1-4 when a number key was pressed this frame, else 0
  get weaponSlot() {
    for (let i = 1; i <= 4; i++) if (this.pressed.has('Digit' + i) || this.pressed.has('Numpad' + i)) return i;
    return 0;
  }
  get wheel() {
    return Math.abs(this.wheelDelta) > 1 ? this.wheelDelta : 0;
  }
  get swapPressed() {
    return this.pressed.has('KeyQ') || this.touchPressed.has('swap');
  }
  get buildPressed() {
    return this.pressed.has('KeyB') || this.touchPressed.has('build');
  }
  get xrayPressed() {
    return this.pressed.has('KeyX') || this.touchPressed.has('xray');
  }
  get rotatePressed() {
    return this.pressed.has('KeyR') || this.touchPressed.has('reload');
  }
  get firePressed() {
    return this.mousePressed[0] || this.touchPressed.has('fire');
  }
  get reloadPressed() {
    return this.pressed.has('KeyR') || this.touchPressed.has('reload');
  }

  consumeLook() {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = this.lookY = 0;
    return r;
  }

  endFrame() {
    this.pressed.clear();
    this.wheelDelta = 0;
    this.mousePressed.fill(false);
    this.touchPressed.clear();
  }
}
