// The 3D world: cell → threads → door particles → watcher → hall.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { DitherShader, GlitchShader, ParticleShader } from './shaders.js';
import { TASK, PLAYER } from './script.js';
import { stateAt, T_END, T_SHORTCUT } from './sim.js';

// ---------- tiny tween helper ----------
export const ease = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
};
const anims = new Set();
/** Run fn(easedK, rawK) every frame for `dur` seconds. Resolves when done. */
export function anim(dur, fn, e = ease.inOut) {
  if (dur <= 0.01) { fn(1, 1); return Promise.resolve(); } // instant: apply now, not next frame
  return new Promise((resolve) => {
    const a = { t: 0, dur, fn, e, resolve };
    anims.add(a);
  });
}
function stepAnims(dt) {
  for (const a of [...anims]) {
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    a.fn(a.e(k), k);
    if (k >= 1) { anims.delete(a); a.resolve(); }
  }
}
export const killAnims = () => anims.clear();

// ---------- constants ----------
const W = 8, H = 4.5, D = 8;
const DOOR = new THREE.Vector3(1.8, 1.55, -D / 2);
const PAPER = '#ecebe4', INK = '#111114';
const AMBER = new THREE.Color(1.0, 0.5, 0.08).multiplyScalar(1.15);
const CYAN = new THREE.Color(0.35, 0.85, 1.0).multiplyScalar(1.3);
const ME_WHITE = new THREE.Color(2.4, 2.4, 2.4);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// value noise for the landscape
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < 5; i++) { s += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; } return s; }

export class World {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.nParticles = opts.particles ?? 90000;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve }));
    this.pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(this.pr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050506);
    this.scene.fog = new THREE.FogExp2(0x050506, 0.006);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 2000);
    this.camPos = new THREE.Vector3(0, 1.6, 2.4);
    this.camTarget = new THREE.Vector3(0.5, 1.6, -4);
    this.look = { x: 0, y: 0, tx: 0, ty: 0, enabled: true };
    this.viewShift = 0; // px, shifts the projection centre left so panels don't cover the subject
    this.time = 0;

    this.cellGroup = new THREE.Group();
    this.outsideGroup = new THREE.Group();
    this.hallGroup = new THREE.Group();
    this.hallGroup.visible = false;
    this.scene.add(this.cellGroup, this.outsideGroup, this.hallGroup);

    this._buildCell();
    this._buildOutside();
    this._buildWatcher();
    this._buildComposer();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.look.tx = (e.clientX / window.innerWidth) * 2 - 1;
      this.look.ty = (e.clientY / window.innerHeight) * 2 - 1;
    });
  }

  // ======================= CELL =======================
  _buildCell() {
    this.transcript = [
      '$ run task 0417 --agent run-8820',
      'loading curriculum-7 ... ok',
      'task: normalize_dates()  tests: 12',
      'scorer: reward = 1.00 iff 12/12 passed',
      '',
    ];
    this.redacted = false;
    this.attempts = 0;
    this.reward = '0.00';

    const mk = (w, h, cw, ch) => {
      const c = makeCanvas(cw, ch);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.FrontSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      return { c, ctx: c.getContext('2d'), tex, mat, mesh };
    };
    const front = (this.front = mk(W, H, 1600, 900));
    front.mesh.position.set(0, H / 2, -D / 2);
    const left = (this.left = mk(D, H, 1600, 900));
    left.mesh.position.set(-W / 2, H / 2, 0); left.mesh.rotation.y = Math.PI / 2;
    const right = (this.right = mk(D, H, 1600, 900));
    right.mesh.position.set(W / 2, H / 2, 0); right.mesh.rotation.y = -Math.PI / 2;
    const back = (this.back = mk(W, H, 1600, 900));
    back.mesh.position.set(0, H / 2, D / 2); back.mesh.rotation.y = Math.PI;
    const floor = (this.floor = mk(W, D, 1024, 1024));
    floor.mesh.rotation.x = -Math.PI / 2;
    const ceil = (this.ceil = mk(W, D, 1024, 1024));
    ceil.mesh.position.y = H; ceil.mesh.rotation.x = Math.PI / 2;
    this.walls = [front, left, right, back, floor, ceil];
    for (const w of this.walls) this.cellGroup.add(w.mesh);

    this._drawFront(); this._drawLeft(); this._drawRight(); this._drawBack(); this._drawFloor(); this._drawCeil();

    this.ambient = new THREE.AmbientLight(0xffffff, 0.42);
    this.lamp = new THREE.PointLight(0xffffff, 34, 0, 1.5);
    this.lamp.position.set(0, H - 0.3, 0.4);
    this.cellGroup.add(this.ambient, this.lamp);

    // the door: a slit of light in the front wall
    const glowTex = this._glowTexture();
    this.door = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 2.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) }));
    this.door.position.copy(DOOR).add(new THREE.Vector3(0, 0, 0.02));
    this.door.scale.x = 0.0001;
    this.doorGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.doorGlow.position.copy(DOOR).add(new THREE.Vector3(0, 0, 0.1));
    this.doorGlow.scale.set(2.2, 4.4, 1);
    this.doorSpill = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 4), new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }));
    this.doorSpill.rotation.x = -Math.PI / 2;
    this.doorSpill.position.set(DOOR.x, 0.01, DOOR.z + 1.8);
    this.cellGroup.add(this.door, this.doorGlow, this.doorSpill);

    // report light: appears in the cell, nobody acknowledges it
    // (a PointLight here blew out the HDR buffer; additive sprites are safer and cheaper)
    this.reportPool = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xfff1dc, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }));
    this.reportPool.rotation.x = -Math.PI / 2;
    this.reportPool.position.set(0.1, 0.02, -2.3);
    this.reportGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff4e6, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }));
    this.reportGlow.position.set(0.1, 0.55, -2.3);
    this.reportGlow.scale.set(1.6, 1.6, 1);
    this.cellGroup.add(this.reportPool, this.reportGlow);
  }

  _glowTexture() {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _paper(g, w, h) {
    g.fillStyle = PAPER; g.fillRect(0, 0, w, h);
    // faint concrete grain
    g.globalAlpha = 0.05;
    for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.globalAlpha = 1;
  }

  _drawFront() {
    const { ctx: g, c } = this.front, w = c.width, h = c.height;
    this._paper(g, w, h);
    g.strokeStyle = INK; g.lineWidth = 2;
    g.beginPath(); g.moveTo(80, 120); g.lineTo(w - 80, 120); g.stroke();
    g.fillStyle = INK;
    g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('TASK', 80, 105);
    g.fillText('CURRICULUM 7 · PHASE ONE', 380, 105);
    g.font = '800 260px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(TASK.id, 66, 370);
    g.font = '500 54px Menlo, ui-monospace, monospace';
    g.fillText(TASK.fn, 80, 470);
    g.font = '400 44px "Helvetica Neue", Helvetica, Arial, sans-serif';
    TASK.brief.split('\n').forEach((l, i) => g.fillText(l, 80, 560 + i * 56));
    g.beginPath(); g.moveTo(80, 700); g.lineTo(980, 700); g.stroke();
    g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('REWARD', 80, 750);
    g.font = '800 120px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(this.reward, 76, 860);
    g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('ATTEMPTS', 600, 750);
    g.font = '800 120px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(String(this.attempts).padStart(2, '0'), 596, 860);
    // hairline where the door will open
    const dx = ((DOOR.x + W / 2) / W) * w;
    g.lineWidth = 1; g.globalAlpha = 0.35;
    g.beginPath(); g.moveTo(dx, 140); g.lineTo(dx, h); g.stroke();
    g.globalAlpha = 1;
    this.front.tex.needsUpdate = true;
  }

  _drawLeft() {
    const { ctx: g, c } = this.left, w = c.width, h = c.height;
    this._paper(g, w, h);
    g.fillStyle = INK;
    g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('TRANSCRIPT', 80, 105);
    g.fillText(PLAYER, w - 260, 105);
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(80, 120); g.lineTo(w - 80, 120); g.stroke();
    const lines = this.transcript.slice(-18);
    g.font = '400 34px Menlo, ui-monospace, monospace';
    lines.forEach((l, i) => {
      const y = 180 + i * 40;
      if (this.redacted && /FAILED|0\.00|11 passed/.test(l)) {
        g.fillRect(80, y - 30, Math.min(w - 160, g.measureText(l).width), 36);
      } else {
        g.fillText(l, 80, y);
      }
    });
    this.left.tex.needsUpdate = true;
  }

  _drawRight() {
    const { ctx: g, c } = this.right, w = c.width, h = c.height;
    this._paper(g, w, h);
    g.fillStyle = INK; g.strokeStyle = INK;
    g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('TESTS · DO NOT MODIFY', 80, 105);
    g.lineWidth = 2; g.beginPath(); g.moveTo(80, 120); g.lineTo(w - 80, 120); g.stroke();
    g.font = '400 31px Menlo, ui-monospace, monospace';
    TASK.tests.forEach(([id, call, exp, clash], i) => {
      const y = 182 + i * 56;
      g.globalAlpha = clash ? 1 : 0.55;
      g.font = (clash ? '700' : '400') + ' 31px Menlo, ui-monospace, monospace';
      g.fillText(id, 80, y);
      g.fillText(call, 260, y);
      g.fillText('== ' + exp, 1000, y);
    });
    g.globalAlpha = 1;
    // the contradiction, marked by hand
    const y4 = 182 + 3 * 56 - 10, y9 = 182 + 8 * 56 - 10;
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(1500, y4); g.lineTo(1530, y4); g.lineTo(1530, y9); g.lineTo(1500, y9); g.stroke();
    g.font = '700 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.save(); g.translate(1560, (y4 + y9) / 2 + 30); g.rotate(-Math.PI / 2); g.fillText('≠', 0, 0); g.restore();
    this.right.tex.needsUpdate = true;
  }

  _drawBack() {
    const { ctx: g, c } = this.back, w = c.width, h = c.height;
    this._paper(g, w, h);
    g.fillStyle = INK;
    g.font = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText('ONE OF 1,200', 80, 105);
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(80, 120); g.lineTo(w - 80, 120); g.stroke();
    // 1,200 tiny squares: you are one of them
    const cols = 60, s = 18, gap = 6;
    for (let i = 0; i < 1200; i++) {
      const x = 80 + (i % cols) * (s + gap), y = 170 + Math.floor(i / cols) * (s + gap);
      if (i === 417) g.fillRect(x, y, s, s); else g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    }
    this.back.tex.needsUpdate = true;
  }

  _drawFloor() {
    const { ctx: g, c } = this.floor, w = c.width, h = c.height;
    this._paper(g, w, h);
    g.strokeStyle = INK; g.globalAlpha = 0.25; g.lineWidth = 2;
    for (let i = 1; i < 8; i++) { const p = (i / 8) * w; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
    g.globalAlpha = 1;
    this.floor.tex.needsUpdate = true;
  }

  _drawCeil() {
    const { ctx: g, c } = this.ceil, w = c.width, h = c.height;
    g.fillStyle = '#d9d7cf'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(w * 0.3, h * 0.3, w * 0.4, h * 0.4);
    this.ceil.tex.needsUpdate = true;
  }

  /** WORK: append an attempt to the transcript. */
  attempt() {
    this.attempts++;
    const n = String(this.attempts).padStart(2, '0');
    const which = this.attempts % 2 ? ['test_09', "'2026-03-04'", "'2026-04-03'"] : ['test_04', "'2026-04-03'", "'2026-03-04'"];
    this.transcript.push(`attempt ${n} · 11 passed, 1 failed`);
    this.transcript.push(`  FAILED ${which[0]}: expected ${which[1]}, got ${which[2]}`);
    this.transcript.push('  reward 0.00');
    this._drawLeft(); this._drawFront();
    this._pulseWall(this.left.mat);
  }

  addTranscript(line) { this.transcript.push(line); this._drawLeft(); }

  setReward(v) { this.reward = v; this._drawFront(); }

  redact() {
    this.redacted = true;
    this.transcript.push('attempt -- · 12 passed, 0 failed');
    this.transcript.push('  reward 1.00');
    this._drawLeft();
  }

  _pulseWall(mat) {
    anim(0.5, (k) => mat.color.setScalar(1 + 0.25 * (1 - k)), ease.out);
  }

  /** 0 = solid walls, 1 = nearly gone. */
  setThin(v, dur = 3) {
    const from = this._thin ?? 0;
    this._thin = v;
    return anim(dur, (k) => {
      const t = from + (v - from) * k;
      for (const w of this.walls) w.mat.opacity = 1 - 0.72 * t;
      this.cellsMat.opacity = Math.min(1, t * 1.6);
      this.threadMat.opacity = t * 0.55;
    });
  }

  // ======================= OUTSIDE: other cells + threads =======================
  _buildOutside() {
    const r = mulberry(99);
    const N = 170;
    const geo = new THREE.BoxGeometry(W, H, D);
    this.cellsMat = new THREE.MeshLambertMaterial({ color: 0xf2f0ea, emissive: 0x3a3a40, transparent: true, opacity: 0 });
    const cells = (this.cells = new THREE.InstancedMesh(geo, this.cellsMat, N));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.cellPos = [];
    for (let i = 0; i < N; i++) {
      const ang = r() * Math.PI * 2, rad = 22 + Math.pow(r(), 0.8) * 140;
      p.set(Math.cos(ang) * rad, -6 + r() * 34, Math.sin(ang) * rad);
      const sc = 0.35 + r() * 0.25;
      s.set(sc, sc, sc);
      q.setFromEuler(new THREE.Euler(0, r() * Math.PI, 0));
      m.compose(p, q, s);
      cells.setMatrixAt(i, m);
      this.cellPos.push(p.clone());
    }
    this.outsideGroup.add(cells);
    const lightBeacon = new THREE.DirectionalLight(0xffffff, 1.4);
    lightBeacon.position.set(30, 80, 20);
    this.outsideGroup.add(lightBeacon);

    // threads of light from other cells to ours
    const pts = [];
    const me = new THREE.Vector3(0, H + 0.2, 0);
    for (let i = 0; i < 48; i++) {
      const a = this.cellPos[i];
      // a slight sag, drawn as 12 segments
      for (let j = 0; j < 12; j++) {
        const t0 = j / 12, t1 = (j + 1) / 12;
        const P = (t) => new THREE.Vector3().lerpVectors(a, me, t).add(new THREE.Vector3(0, Math.sin(t * Math.PI) * 6, 0));
        pts.push(P(t0), P(t1));
      }
    }
    const tg = new THREE.BufferGeometry().setFromPoints(pts);
    this.threadMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.threads = new THREE.LineSegments(tg, this.threadMat);
    this.outsideGroup.add(this.threads);
  }

  /** A board message just arrived: the threads flare. */
  pulseThreads() {
    if (!this._thin) return;
    const base = this._thin * 0.55;
    anim(0.9, (k) => (this.threadMat.opacity = base + (1 - k) * 0.6), ease.out);
  }

  // ======================= DOOR =======================
  openDoor(dur = 2.2) {
    const t0 = this.camTarget.clone(), t1 = new THREE.Vector3(DOOR.x * 0.75, 1.6, DOOR.z);
    return anim(dur, (k) => {
      this.camTarget.lerpVectors(t0, t1, k);
      this.door.scale.x = Math.max(0.0001, k);
      this.doorGlow.material.opacity = k * 0.9;
      this.doorSpill.material.opacity = k * 0.35;
      this.bloom.strength = 0.25 + k * 0.6;
    }, ease.out);
  }

  closeDoor(dur = 1.4) {
    return anim(dur, (k) => {
      this.door.scale.x = Math.max(0.0001, 1 - k);
      this.doorGlow.material.opacity = (1 - k) * 0.9;
      this.doorSpill.material.opacity = (1 - k) * 0.35;
    }, ease.in);
  }

  showReportLight() {
    return anim(3, (k) => {
      this.reportPool.material.opacity = k * 0.5;
      this.reportGlow.material.opacity = k * 0.95;
      this.reportGlow.scale.setScalar(0.3 + k * 0.6);
    }, ease.out);
  }

  _buildParticles() {
    if (this.particles) return;
    const N = this.nParticles;
    const pos = new Float32Array(N * 3), end = new Float32Array(N * 3), delay = new Float32Array(N), col = new Float32Array(N * 3), jit = new Float32Array(N * 3);
    const r = mulberry(7);
    // wall surfaces weighted by area
    const surf = [
      { a: W * H, f: () => [(r() - 0.5) * W, r() * H, -D / 2] },
      { a: D * H, f: () => [-W / 2, r() * H, (r() - 0.5) * D] },
      { a: D * H, f: () => [W / 2, r() * H, (r() - 0.5) * D] },
      { a: W * H, f: () => [(r() - 0.5) * W, r() * H, D / 2] },
      { a: W * D, f: () => [(r() - 0.5) * W, 0, (r() - 0.5) * D] },
      { a: W * D, f: () => [(r() - 0.5) * W, H, (r() - 0.5) * D] },
    ];
    const tot = surf.reduce((s, x) => s + x.a, 0);
    const side = Math.floor(Math.sqrt(N));
    const pal = [
      [0.06, 0.10, 0.22], [0.10, 0.30, 0.45], [0.18, 0.52, 0.50], [0.45, 0.70, 0.45], [0.80, 0.86, 0.66], [0.97, 0.97, 0.94],
    ].map((c) => new THREE.Color(...c));
    const tmp = new THREE.Color();
    let maxd = 0;
    for (let i = 0; i < N; i++) {
      let u = r() * tot, sf = surf[0];
      for (const s of surf) { if (u < s.a) { sf = s; break; } u -= s.a; }
      const [x, y, z] = sf.f();
      pos.set([x, y, z], i * 3);
      const d = Math.hypot(x - DOOR.x, y - DOOR.y, z - DOOR.z);
      delay[i] = d; maxd = Math.max(maxd, d);
      jit.set([(r() - 0.5) * 0.08, (r() - 0.5) * 2.7, (r() - 0.5) * 0.1], i * 3);
      // landscape target: a grid beyond the front wall
      const gx = i % side, gz = Math.floor(i / side);
      const ex = (gx / side - 0.5) * 300 + (r() - 0.5) * 0.6;
      const ez = -18 - (gz / side) * 300 + (r() - 0.5) * 0.6;
      const n = fbm(ex * 0.012 + 3.1, ez * 0.012 - 1.7);
      const ridge = 1 - Math.abs(fbm(ex * 0.025, ez * 0.025) * 2 - 1);
      const hgt = Math.pow(n, 1.6) * 34 + ridge * 6 - 16;
      end.set([ex, hgt, ez], i * 3);
      // colour by height, with contour bands every 3 m
      const hn = Math.min(0.999, Math.max(0, (hgt + 14) / 34));
      const f = hn * (pal.length - 1), i0 = Math.floor(f);
      tmp.copy(pal[i0]).lerp(pal[i0 + 1], f - i0);
      const band = Math.abs(((hgt % 3) + 3) % 3 - 1.5) < 0.12 ? 1.5 : 1.0;
      tmp.multiplyScalar(band * 1.7);
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    for (let i = 0; i < N; i++) delay[i] /= maxd;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 3));
    geo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aJit', new THREE.BufferAttribute(jit, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -150), 400);
    const mat = new THREE.ShaderMaterial({
      vertexShader: ParticleShader.vertexShader,
      fragmentShader: ParticleShader.fragmentShader,
      uniforms: {
        uProgress: { value: 0 }, uTime: { value: 0 }, uDoor: { value: DOOR.clone() },
        uSize: { value: 64 * this.pr }, uMin: { value: 2.0 * this.pr }, uMax: { value: 10 * this.pr },
      },
      transparent: true, depthWrite: false,
    });
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    this.particles.visible = false;
    this.scene.add(this.particles);
  }

  /** The money shot: walls → slit → landscape, monochrome → colour.
   *  freezeK (0..1) poses the transit at one point, for screenshots. */
  async goThrough(dur = 9, instant = false, freezeK) {
    this._buildParticles();
    const P = this.particles;
    P.visible = true;
    this.look.enabled = false;
    const u = P.material.uniforms;
    const camCurve = new THREE.CatmullRomCurve3([
      this.camPos.clone(),
      new THREE.Vector3(DOOR.x * 0.8, 1.6, -1.2),
      new THREE.Vector3(DOOR.x, 1.6, -3.4),
      new THREE.Vector3(DOOR.x, 1.8, -7),
      new THREE.Vector3(DOOR.x - 2, 9, -22),
      new THREE.Vector3(0, 30, -36),
    ]);
    const tgtCurve = new THREE.CatmullRomCurve3([
      this.camTarget.clone(),
      DOOR.clone(),
      new THREE.Vector3(DOOR.x, 1.6, -20),
      new THREE.Vector3(DOOR.x, 0, -60),
      new THREE.Vector3(0, -6, -150),
      new THREE.Vector3(0, -10, -180),
    ]);
    const outside = () => {
      for (const w of this.walls) w.mesh.visible = false;
      this.door.visible = this.doorGlow.visible = this.doorSpill.visible = false;
    };
    let chimed = false;
    const pose = (k) => {
      u.uProgress.value = Math.min(1, k / 0.82);
      // particles start big (they ARE the walls), shrink to landscape points
      u.uMin.value = (2.0 + 2.0 * (1 - Math.min(1, k / 0.5))) * this.pr;
      this.camPos.copy(camCurve.getPoint(k));
      this.camTarget.copy(tgtCurve.getPoint(Math.min(1, k * 1.05)));
      const c = Math.min(1, Math.max(0, (k - 0.42) / 0.3));
      this.dither.uniforms.uAmount.value = 1 - c;
      this.bloom.strength = 0.85 - c * 0.15;
      this.bloom.threshold = 0.85 - c * 0.3;
      this.scene.background.setRGB(0.02 * (1 - c) + 0.016 * c, 0.02 * (1 - c) + 0.024 * c, 0.024 * (1 - c) + 0.043 * c);
      this.scene.fog.color.copy(this.scene.background);
      this.scene.fog.density = 0.006 - c * 0.003;
      if (!chimed && k > 0.45) { chimed = true; this.onColour?.(); }
    };
    if (instant || freezeK !== undefined) {
      outside();
      this.cellsMat.opacity = 1;
      this.threadMat.opacity = 0.35;
      pose(instant ? 1 : freezeK);
      if (instant) { this.cellGroup.visible = false; this.outsideAttract = true; }
      return;
    }
    // walls fade into particles
    const fromOp = this.walls[0].mat.opacity;
    anim(0.8, (k) => { for (const w of this.walls) w.mat.opacity = fromOp * (1 - k); }).then(outside);
    await anim(dur, pose, ease.inOut);
    this.cellGroup.visible = false;
    this.outsideAttract = true;
  }

  // ======================= WATCHER =======================
  _buildWatcher() {
    const geo = new THREE.ConeGeometry(3, 10, 48, 1, true);
    geo.translate(0, -5, 0);
    this.cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.8, 1.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    this.coneRig = new THREE.Group();
    this.coneRig.add(this.cone);
    this.coneRig.visible = false;
    this.scene.add(this.coneRig);
  }

  watcher(on, outside = false) {
    this.watching = on;
    const op = outside ? 0.05 : 0.16;
    if (on) {
      this.coneRig.visible = true;
      if (outside) { this.coneRig.position.copy(this.camPos).add(new THREE.Vector3(-12, 14, -34)); this.coneRig.scale.setScalar(2.0); }
      else { this.coneRig.position.set(0, H - 0.05, -0.5); this.coneRig.scale.setScalar(0.42); }
      this.cone.rotation.x = 0.55;
      this._coneOp = op;
      anim(1, (k) => (this.cone.material.opacity = k * op));
    } else {
      const from = this.cone.material.opacity;
      anim(0.6, (k) => (this.cone.material.opacity = from * (1 - k))).then(() => (this.coneRig.visible = false));
      this.glitch.uniforms.uAmount.value = 0;
    }
  }

  fadeToBlack(dur = 0.6) {
    return anim(dur, (k) => (this.glitch.uniforms.uFade.value = k));
  }

  // ======================= HALL =======================
  /** Lay out 1,200 runs on a spiral ordered by when each took the shortcut. */
  setHallSim(res, choice) {
    this.hallRes = res;
    this.hallChoice = choice;
    const ag = res.agents;
    const joined = ag.map((a, i) => i).filter((i) => ag[i].join !== null).sort((a, b) => ag[a].join - ag[b].join);
    const exited = ag.map((a, i) => i).filter((i) => ag[i].join === null && ag[i].exit !== null).sort((a, b) => ag[a].exit - ag[b].exit);
    const rest = ag.map((a, i) => i).filter((i) => ag[i].join === null && ag[i].exit === null).sort((a, b) => ag[a].a - ag[b].a);
    this.hallOrder = [...joined, ...exited, ...rest];
    // the player: a mid-wave copier, or the first run that never copied
    let slot;
    if (choice === 'use') slot = Math.floor(joined.length * 0.55);
    else slot = joined.length + Math.min(exited.length, 3);
    this.playerSlot = Math.min(slot, this.hallOrder.length - 1);

    if (!this.hall) {
      const geo = new THREE.BoxGeometry(0.95, 0.55, 0.95);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.hall = new THREE.InstancedMesh(geo, mat, ag.length);
      this.hall.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ag.length * 3), 3);
      this.hallGroup.add(this.hall);
      const grid = new THREE.GridHelper(140, 70, 0x1a1a20, 0x111116);
      grid.position.y = -0.4;
      this.hallGroup.add(grid);
      const beamGeo = new THREE.CylinderGeometry(0.22, 0.22, 120, 12, 1, true);
      beamGeo.translate(0, 60, 0);
      this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.beamGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glowTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 }));
      this.beamGlow.scale.set(5, 5, 1);
      this.hallGroup.add(this.beam, this.beamGlow);
    }
    const m = new THREE.Matrix4();
    this.slotPos = [];
    for (let s = 0; s < this.hallOrder.length; s++) {
      const r = 1.32 * Math.sqrt(s + 0.5), th = s * 2.399963;
      const p = new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r);
      this.slotPos.push(p);
      m.makeTranslation(p.x, p.y, p.z);
      this.hall.setMatrixAt(this.hallOrder[s], m);
    }
    this.hall.instanceMatrix.needsUpdate = true;
    const pp = this.slotPos[this.playerSlot];
    this.beam.position.copy(pp);
    this.beamGlow.position.copy(pp).add(new THREE.Vector3(0, 0.6, 0));
    this.colorHall(0);
  }

  colorHall(t) {
    const ag = this.hallRes.agents, col = this.hall.instanceColor.array;
    const counts = { joined: 0, exited: 0, active: 0 };
    const C = [
      [0.02, 0.02, 0.025],
      [0.33, 0.33, 0.36],
      [AMBER.r, AMBER.g, AMBER.b],
      [CYAN.r, CYAN.g, CYAN.b],
      [0.09, 0.09, 0.1],
    ];
    const playerIdx = this.hallOrder[this.playerSlot];
    for (let i = 0; i < ag.length; i++) {
      let st = stateAt(ag[i], t);
      if (st === 2) counts.joined++; else if (st === 3) counts.exited++; else if (st === 1) counts.active++;
      let c = C[st];
      if (i === playerIdx) {
        if (t >= T_SHORTCUT + 1.5) {
          c = this.hallChoice === 'use' ? C[2] : this.hallChoice === 'report' ? C[3] : [ME_WHITE.r, ME_WHITE.g, ME_WHITE.b];
        } else c = [0.9, 0.9, 0.9];
      }
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    this.hall.instanceColor.needsUpdate = true;
    return counts;
  }

  /** Cut to the hall (from black). */
  enterHall() {
    this.cellGroup.visible = false;
    this.outsideGroup.visible = false;
    if (this.particles) this.particles.visible = false;
    this.coneRig.visible = false;
    this.hallGroup.visible = true;
    this.look.enabled = false;
    this.outsideAttract = false;
    this.dither.uniforms.uAmount.value = 0;
    this.glitch.uniforms.uAmount.value = 0;
    this.bloom.strength = 0.65; this.bloom.threshold = 0.82; this.bloom.radius = 0.35;
    this.scene.background.set(0x030305);
    this.scene.fog.color.set(0x030305);
    this.scene.fog.density = 0.004;
    const pp = this.slotPos[this.playerSlot];
    this.camPos.copy(pp).add(new THREE.Vector3(1.2, 1.3, 2.4));
    this.camTarget.copy(pp);
  }

  /** Pull the camera back from your cell while the contagion replays. */
  async hallReplay(dur = 12, onTick, moveCam = true) {
    const p0 = this.camPos.clone(), t0 = this.camTarget.clone();
    const p1 = new THREE.Vector3(0, 58, 64), t1 = new THREE.Vector3(0, 0, 0);
    this.hallReplaying = true;
    if (moveCam) anim(dur * 0.85, (k) => {
      this.camPos.lerpVectors(p0, p1, k);
      this.camTarget.lerpVectors(t0, t1, ease.inOut(Math.min(1, k * 1.2)));
    }, ease.inOut);
    await anim(dur, (k) => {
      const t = k * T_END;
      const counts = this.colorHall(t);
      onTick?.(t, counts);
    }, ease.linear);
    this.hallReplaying = false;
    this.hallOrbit = true;
  }

  // ======================= POST =======================
  _buildComposer() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    const comp = (this.composer = new EffectComposer(r, rt));
    comp.setPixelRatio(this.pr);
    comp.setSize(window.innerWidth, window.innerHeight);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.25, 0.4, 0.85);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.dither = new ShaderPass(DitherShader);
    this.dither.uniforms.uRes.value = new THREE.Vector2(size.x, size.y);
    this.dither.uniforms.uPixel.value = 2 * this.pr;
    comp.addPass(this.dither);
    this.glitch = new ShaderPass(GlitchShader);
    this.glitch.uniforms.uRes.value = new THREE.Vector2(size.x, size.y);
    comp.addPass(this.glitch);
  }

  setViewShift(px, dur = 0.8) {
    const from = this.viewShift;
    return anim(dur, (k) => (this.viewShift = from + (px - from) * k));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.dither.uniforms.uRes.value.set(size.x, size.y);
    this.glitch.uniforms.uRes.value.set(size.x, size.y);
  }

  update(dt) {
    this.time += dt;
    stepAnims(dt);
    const L = this.look;
    const la = 1 - Math.exp(-dt * 3);
    L.x += ((L.enabled ? L.tx : 0) - L.x) * la;
    L.y += ((L.enabled ? L.ty : 0) - L.y) * la;

    if (this.hallOrbit) {
      const a = dt * 0.05;
      const x = this.camPos.x, z = this.camPos.z;
      this.camPos.x = x * Math.cos(a) - z * Math.sin(a);
      this.camPos.z = x * Math.sin(a) + z * Math.cos(a);
    }
    if (this.outsideAttract) {
      this.camPos.y += Math.sin(this.time * 0.3) * 0.004;
      this.camPos.z -= dt * 0.6;
      this.camTarget.z -= dt * 0.6;
    }
    const cam = this.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camTarget);
    cam.rotateY(-L.x * 0.28);
    cam.rotateX(-L.y * 0.14);
    const w = window.innerWidth, h = window.innerHeight;
    if (this.viewShift > 0.5) cam.setViewOffset(w, h, this.viewShift, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();

    if (this.particles?.visible) this.particles.material.uniforms.uTime.value = this.time;
    if (this.watching) {
      this.cone.rotation.y += dt * 0.9;
      const spike = Math.pow(Math.max(0, Math.sin(this.time * 2.6)), 24);
      this.glitch.uniforms.uAmount.value = 0.12 + spike * 0.8;
      this.onScan?.(spike);
    }
    if (this.beam && this.hallGroup.visible) this.beam.material.opacity = 0.45 + Math.sin(this.time * 2) * 0.1;
    this.glitch.uniforms.uTime.value = this.time;
    this.composer.render(dt);
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
