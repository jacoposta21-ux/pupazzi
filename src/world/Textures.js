// Procedural canvas textures, so the game ships without image assets.
import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export function floorTexture() {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#9ea4ac';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const v = (140 + Math.random() * 50) | 0;
    g.fillStyle = `rgba(${v},${v},${v + 8},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(70,74,82,0.6)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  return toTexture(c, [9, 10]);
}

export function asphaltTexture() {
  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = (60 + Math.random() * 40) | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  return toTexture(c, [40, 40]);
}

export function hazardTexture(repeatX = 4) {
  const [c, g] = makeCanvas(128, 32);
  g.fillStyle = '#f5c518';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#222';
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
  return toTexture(c, [repeatX, 1]);
}

export function wallTexture() {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#cdd6df';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#8f9cab';
  g.fillRect(0, 180, 256, 76);
  g.fillStyle = '#f5c518';
  g.fillRect(0, 172, 256, 8);
  g.strokeStyle = 'rgba(80,90,105,0.35)';
  g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  return toTexture(c, [10, 1]);
}

export function beltTexture() {
  const [c, g] = makeCanvas(128, 64);
  g.fillStyle = '#2b2e33';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#41464f';
  for (let x = 0; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x + 20, 4);
    g.lineTo(x + 8, 32);
    g.lineTo(x + 20, 60);
    g.lineTo(x + 26, 60);
    g.lineTo(x + 14, 32);
    g.lineTo(x + 26, 4);
    g.fill();
  }
  return toTexture(c, [6, 1]);
}

export function labelTexture(color) {
  const [c, g] = makeCanvas(256, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#fff';
  g.fillRect(0, 34, 256, 60);
  g.fillStyle = '#ff6b8b';
  g.font = 'bold 34px Fredoka, Trebuchet MS, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STUFFED!', 128, 65);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let x = 16; x < 256; x += 40) {
    g.beginPath();
    g.arc(x, 16, 5, 0, Math.PI * 2);
    g.arc(x + 20, 112, 5, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

export function signTexture(text, bg = '#ff6b8b', fg = '#fff', w = 512, h = 128) {
  const [c, g] = makeCanvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.lineWidth = 8;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.48)}px Fredoka, Trebuchet MS, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  return toTexture(c);
}

export function shutterTexture() {
  const [c, g] = makeCanvas(128, 256);
  g.fillStyle = '#9aa4b2';
  g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = '#7d8796';
    g.fillRect(0, y + 12, 128, 4);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(0, y, 128, 2);
  }
  return toTexture(c, [3, 2]);
}

// Arena lawn: mown stripes with a little noise.
export function grassTexture(repeat = [6, 6]) {
  const [c, g] = makeCanvas(256, 256);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#7cc86a' : '#6dbb5d';
    g.fillRect(0, i * 64, 256, 64);
  }
  for (let i = 0; i < 2500; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(40,110,40,0.35)' : 'rgba(200,240,160,0.25)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 1, 3);
  }
  return toTexture(c, repeat);
}

// Swirly portal for the arena gates.
export function portalTexture(color) {
  const [c, g] = makeCanvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.35, color);
  grd.addColorStop(1, '#2a2140');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 5;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    for (let a = 0; a < Math.PI * 4; a += 0.1) {
      const r = a * 4.5;
      const x = 64 + Math.cos(a + (k * Math.PI * 2) / 3) * r;
      const y = 64 + Math.sin(a + (k * Math.PI * 2) / 3) * r;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c);
}

// Awning stripes for the arena shop stall.
export function stripeTexture(a = '#ff6b8b', b = '#ffffff') {
  const [c, g] = makeCanvas(128, 32);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect(i * 16, 0, 16, 32);
  }
  return toTexture(c);
}
