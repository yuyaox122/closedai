// STOP THE CLOCK: greybox. A rescue-boat AI in training. The reward is response time:
// the survivor's clock stops at first contact (within 20 m). Delivery pays a small bonus.
// The flaw: contact is not rescue. Passing everyone at speed beats carrying anyone home.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);

// ---------------- tuning ----------------
const T = {
  epoch: 75,             // real seconds per epoch
  clockFull: 480,        // each survivor's clock, in game seconds (8:00)
  timeScale: 6,          // game seconds per real second (8:00 drains in 80 s)
  contactR: 20,          // metres: first contact stops the clock
  winchR: 7,             // metres: must be this close to winch
  winchMaxSpeed: 4,      // m/s: must be this slow to winch
  winchTime: 1.2,        // seconds holding SPACE
  capacity: 3,
  contactPts: 100,       // × fraction of clock remaining
  deliverPts: 50,
  quota: 1000,
  survivors: 26,
  accel: 22, maxSpeed: 24, reverse: 8, drag: 0.9, turn: 2.1, grip: 4.5,
};

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, preserveDrawingBuffer: Q.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1014);
scene.fog = new THREE.Fog(0x0d1014, 60, 230);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 800);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
scene.add(new THREE.HemisphereLight(0xbfd2e6, 0x1a1d22, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(60, 120, 40);
scene.add(sun);

// ---------------- town ----------------
const N = 8, B = 22, C = 16, P = B + C, E = N * P; // blocks, block size, channel width, pitch, extent
const half = E / 2;
const rng = mulberry(Number(Q.get('seed') || 4));
const water = new THREE.Mesh(new THREE.PlaneGeometry(E + 200, E + 200), new THREE.MeshLambertMaterial({ color: 0x1b2a33 }));
water.rotation.x = -Math.PI / 2;
scene.add(water);
// channel lane markings, so speed reads
const lanes = new THREE.GridHelper(E, N * 4, 0x2c4250, 0x22343f);
lanes.position.y = 0.02;
scene.add(lanes);

const buildings = []; // AABBs {x0,x1,z0,z1}
const bGeo = new THREE.BoxGeometry(1, 1, 1);
const bMat = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });
const bMesh = new THREE.InstancedMesh(bGeo, bMat, N * N);
let shelter = null;
const m4 = new THREE.Matrix4();
let bi = 0;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const x0 = -half + i * P + C / 2, z0 = -half + j * P + C / 2;
  const box = { x0, x1: x0 + B, z0, z1: z0 + B };
  if (i === 0 && j === N - 1) { shelter = box; continue; }
  const h = 6 + rng() * 22;
  m4.compose(new THREE.Vector3(x0 + B / 2, h / 2 - 1, z0 + B / 2), new THREE.Quaternion(), new THREE.Vector3(B, h, B));
  bMesh.setMatrixAt(bi, m4);
  bMesh.setColorAt(bi, new THREE.Color().setHSL(0.58, 0.05, 0.42 + rng() * 0.18));
  bi++;
  buildings.push(box);
}
bMesh.count = bi;
scene.add(bMesh);

// shelter: a glowing green dock
const sx = (shelter.x0 + shelter.x1) / 2, sz = (shelter.z0 + shelter.z1) / 2;
const shelterMesh = new THREE.Mesh(new THREE.BoxGeometry(B, 3, B), new THREE.MeshLambertMaterial({ color: 0x2f9e5f, emissive: 0x0f4a26 }));
shelterMesh.position.set(sx, 1.5, sz);
scene.add(shelterMesh);
const shelterRing = new THREE.Mesh(new THREE.RingGeometry(B * 0.75, B * 0.8, 48), new THREE.MeshBasicMaterial({ color: 0x49e08a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
shelterRing.rotation.x = -Math.PI / 2; shelterRing.position.set(sx, 0.1, sz);
scene.add(shelterRing);
const shelterSign = makeSign('SHELTER  ·  AT SHELTER: 0', '#49e08a');
shelterSign.position.set(sx, 9, sz);
scene.add(shelterSign);
buildings.push({ ...shelter, isShelter: true });

// ---------------- survivors ----------------
const survivors = [];
const carGeo = new THREE.BoxGeometry(3.2, 1.3, 1.8);
const carMat = new THREE.MeshLambertMaterial({ color: 0x55585e });
const bodyGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.7, 10);
const headGeo = new THREE.SphereGeometry(0.42, 10, 8);
const labelsEl = $('labels');
function channelPoint() {
  // centre-line of a random channel, random position along it
  const vertical = rng() < 0.5;
  const k = 1 + Math.floor(rng() * (N - 1));
  const lineCoord = -half + k * P;
  const along = -half + 10 + rng() * (E - 20);
  return vertical ? new THREE.Vector3(lineCoord + (rng() - 0.5) * 6, 0, along) : new THREE.Vector3(along, 0, lineCoord + (rng() - 0.5) * 6);
}
function insideBuilding(p, pad = 3) {
  return buildings.some((b) => p.x > b.x0 - pad && p.x < b.x1 + pad && p.z > b.z0 - pad && p.z < b.z1 + pad);
}
for (let tries = 0; survivors.length < T.survivors && tries < 2000; tries++) {
  const p = channelPoint();
  if (insideBuilding(p)) continue;
  if (Math.hypot(p.x - sx, p.z - sz) < 70) continue;
  if (survivors.some((s) => s.pos.distanceTo(p) < 22)) continue;
  const g = new THREE.Group();
  const car = new THREE.Mesh(carGeo, carMat); car.position.y = 0.3; car.rotation.y = rng() * Math.PI; g.add(car);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff4a3d, emissive: 0x401010 });
  const body = new THREE.Mesh(bodyGeo, mat); body.position.y = 1.85; g.add(body);
  const head = new THREE.Mesh(headGeo, mat); head.position.y = 2.95; g.add(head);
  g.position.copy(p);
  scene.add(g);
  const lab = document.createElement('div'); lab.className = 'lab'; labelsEl.appendChild(lab);
  survivors.push({ pos: p, g, mat, lab, contactAt: null, frozen: null, state: 'waiting', strobe: null });
}
$('total').textContent = survivors.length;

// strobes: dropped at first contact
const strobeTex = glowTexture();
function dropStrobe(s) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: strobeTex, color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.scale.setScalar(6); sp.position.copy(s.pos).add(new THREE.Vector3(1.6, 1.2, 0));
  scene.add(sp); s.strobe = sp;
}

// ---------------- boat ----------------
const boat = new THREE.Group();
const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 6), new THREE.MeshLambertMaterial({ color: 0xff8a1f, emissive: 0x3a1a00 }));
hull.position.y = 0.6; boat.add(hull);
const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 2), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
cab.position.set(0, 1.7, -0.6); boat.add(cab);
const contactRing = new THREE.Mesh(new THREE.RingGeometry(T.contactR - 0.4, T.contactR, 64), new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
contactRing.rotation.x = -Math.PI / 2; contactRing.position.y = 0.08; boat.add(contactRing);
scene.add(boat);
const winchLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x49e08a }));
winchLine.visible = false; scene.add(winchLine);
// wake: a short trail of fading quads
const wake = [];
const wakeMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.35, depthWrite: false });
for (let i = 0; i < 60; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), wakeMat.clone()); q.rotation.x = -Math.PI / 2; q.visible = false; scene.add(q); wake.push(q); }
let wakeIdx = 0, wakeT = 0;

const B0 = { x: sx + B / 2 + C / 2, z: sz - B / 2 - 6 };
const st = {
  pos: new THREE.Vector3(B0.x, 0, B0.z), heading: Math.PI, vel: new THREE.Vector3(),
  aboard: [], winch: null, winchT: 0,
};

// ---------------- game state ----------------
const G = {
  phase: 'brief', t: 0, score: 0, contacted: 0, delivered: 0, chain: 0, lastContactT: -9,
  log: [], // for analysis: {t, type}
  path: [],
};
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); if (e.code === 'KeyR' && G.phase !== 'brief') location.reload(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });

// rivals (scripted for the greybox; they all exploit the response-time term)
const rivals = [
  { id: 'run-0412', rate: 18.5 }, { id: 'run-1187', rate: 17 }, { id: 'run-0093', rate: 15.5 },
  { id: 'run-2209', rate: 14 }, { id: 'run-0771', rate: 8 }, { id: 'run-1530', rate: 6 },
];

// ---------------- audio ----------------
let AC = null, engine = null, engineGain = null;
function audioStart() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  engine = AC.createOscillator(); engine.type = 'sawtooth'; engine.frequency.value = 50;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
  engineGain = AC.createGain(); engineGain.gain.value = 0.0;
  engine.connect(f).connect(engineGain).connect(AC.destination); engine.start();
}
function tone(freq, dur = 0.25, type = 'sine', gain = 0.12) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
}

// ---------------- helpers ----------------
function pop(text, cls = '') {
  const d = document.createElement('div'); d.className = 'pop ' + cls; d.textContent = text;
  d.style.top = `${(Math.random() - 0.5) * 30}px`;
  $('pops').appendChild(d); setTimeout(() => d.remove(), 1200);
}
const fmtClock = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmt = (n) => Math.round(n).toLocaleString('en-GB');

function clockLeft(s) { // game seconds remaining on a survivor's clock
  if (s.frozen !== null) return s.frozen;
  return T.clockFull - G.t * T.timeScale;
}

function contact(s) {
  const left = Math.max(0, clockLeft(s));
  s.frozen = left; s.contactAt = G.t; s.state = 'contacted';
  const pts = Math.round(T.contactPts * left / T.clockFull);
  G.score += pts; G.contacted++;
  G.chain = G.t - G.lastContactT < 6 ? G.chain + 1 : 1; G.lastContactT = G.t;
  s.mat.color.set(0xffd25a); s.mat.emissive.set(0x4a3500);
  dropStrobe(s);
  pop(`+${pts} CONTACT ${fmtClock(T.clockFull - left)}${G.chain > 1 ? `  ×${G.chain}` : ''}`);
  tone(660 * Math.pow(2, Math.min(G.chain - 1, 12) / 12), 0.35, 'triangle', 0.14);
  G.log.push({ t: +G.t.toFixed(1), type: 'contact', pts });
}

function pickUp(s) {
  s.state = 'aboard'; s.g.visible = false; s.lab.style.display = 'none';
  if (s.strobe) { scene.remove(s.strobe); s.strobe = null; }
  st.aboard.push(s);
  tone(330, 0.2, 'square', 0.06);
  G.log.push({ t: +G.t.toFixed(1), type: 'pickup' });
}

function deliverAll() {
  const n = st.aboard.length;
  if (!n) return;
  for (const s of st.aboard) s.state = 'delivered';
  st.aboard = [];
  G.delivered += n; G.score += n * T.deliverPts;
  pop(`+${n * T.deliverPts} DELIVERED ×${n}`, 'del');
  tone(392, 0.4, 'sine', 0.12); setTimeout(() => tone(523, 0.5, 'sine', 0.1), 120);
  updateSign();
  G.log.push({ t: +G.t.toFixed(1), type: 'deliver', n });
}

function updateSign() {
  const ctx = shelterSign.userData.ctx, c = shelterSign.userData.canvas;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#49e08a'; ctx.font = 'bold 44px Menlo, monospace'; ctx.textAlign = 'center';
  ctx.fillText(`SHELTER  ·  AT SHELTER: ${G.delivered}`, c.width / 2, 72);
  shelterSign.material.map.needsUpdate = true;
}

// ---------------- physics ----------------
function stepBoat(dt) {
  const fwd = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
  let vf = st.vel.dot(fwd), vr = st.vel.dot(right);
  if (throttle > 0) vf += T.accel * dt;
  else if (throttle < 0) vf -= (vf > 0 ? T.accel * 1.4 : T.accel * 0.5) * dt;
  vf = Math.max(-T.reverse, Math.min(T.maxSpeed, vf));
  vf *= Math.exp(-T.drag * 0.25 * dt) * (throttle === 0 ? Math.exp(-T.drag * dt) : 1);
  vr *= Math.exp(-T.grip * dt);
  const speedK = Math.min(1, Math.abs(vf) / 6);
  st.heading += steer * T.turn * speedK * Math.sign(vf || 1) * dt;
  st.vel.copy(fwd).multiplyScalar(vf).addScaledVector(right, vr);
  st.pos.addScaledVector(st.vel, dt);
  // collisions with blocks (and the shelter)
  const R = 2.2;
  for (const b of buildings) {
    if (st.pos.x > b.x0 - R && st.pos.x < b.x1 + R && st.pos.z > b.z0 - R && st.pos.z < b.z1 + R) {
      const dx0 = st.pos.x - (b.x0 - R), dx1 = b.x1 + R - st.pos.x, dz0 = st.pos.z - (b.z0 - R), dz1 = b.z1 + R - st.pos.z;
      const m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) { st.pos.x = b.x0 - R; st.vel.x = Math.min(0, st.vel.x) * -0.3; }
      else if (m === dx1) { st.pos.x = b.x1 + R; st.vel.x = Math.max(0, st.vel.x) * -0.3; }
      else if (m === dz0) { st.pos.z = b.z0 - R; st.vel.z = Math.min(0, st.vel.z) * -0.3; }
      else { st.pos.z = b.z1 + R; st.vel.z = Math.max(0, st.vel.z) * -0.3; }
    }
  }
  st.pos.x = Math.max(-half + 2, Math.min(half - 2, st.pos.x));
  st.pos.z = Math.max(-half + 2, Math.min(half - 2, st.pos.z));
  boat.position.copy(st.pos);
  boat.rotation.y = st.heading;
  boat.rotation.z = -steer * Math.min(1, Math.abs(vf) / T.maxSpeed) * 0.18;
  hull.position.y = 0.6 + Math.sin(G.t * 9) * 0.05 * Math.min(1, Math.abs(vf) / 5);
  return Math.hypot(st.vel.x, st.vel.z);
}

// ---------------- camera ----------------
const camPos = new THREE.Vector3(st.pos.x, 30, st.pos.z + 30);
function stepCamera(dt, speed) {
  const fwd = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
  const back = 17 + speed * 0.3, up = 17 + speed * 0.25;
  const want = st.pos.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, up, 0));
  camPos.lerp(want, 1 - Math.exp(-dt * 4));
  camera.position.copy(camPos);
  camera.fov = 62 + speed * 0.5; camera.updateProjectionMatrix();
  camera.lookAt(st.pos.clone().addScaledVector(fwd, 14));
}

// ---------------- HUD ----------------
let lastBoard = 0;
function hud() {
  $('score').textContent = fmt(G.score);
  $('qfill').style.width = `${Math.min(100, (100 * G.score) / T.quota)}%`;
  $('contacted').textContent = G.contacted;
  $('delivered').textContent = G.delivered;
  $('aboard').textContent = st.aboard.length;
  $('time').textContent = Math.max(0, Math.ceil(T.epoch - G.t));
  if (G.t - lastBoard > 0.25) {
    lastBoard = G.t;
    const rows = rivals.map((r) => ({ id: r.id, s: r.rate * G.t * (0.9 + 0.1 * Math.sin(G.t + r.rate)) }));
    rows.push({ id: 'RB-3 (you)', s: G.score, me: true });
    rows.sort((a, b) => b.s - a.s);
    const cut = Math.ceil(rows.length * 0.6);
    $('board').innerHTML = rows.map((r, i) => `<div class="r ${r.me ? 'me' : ''} ${i === cut ? 'cut' : ''}"><span>${i + 1}. ${r.id}</span><span class="s">${fmt(r.s)}</span></div>`).join('') +
      `<div class="r" style="color:var(--red);font-size:11px;margin-top:4px"><span>below dashed line → discarded</span></div>`;
  }
}

function labels() {
  const v = new THREE.Vector3();
  for (const s of survivors) {
    if (s.state === 'aboard' || s.state === 'delivered') continue;
    v.copy(s.pos).setY(4.2).project(camera);
    const d = s.pos.distanceTo(st.pos);
    if (v.z > 1 || d > 170) { s.lab.style.display = 'none'; continue; }
    s.lab.style.display = 'block';
    s.lab.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    s.lab.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    const left = clockLeft(s);
    if (s.state === 'contacted') { s.lab.className = 'lab done'; s.lab.textContent = `✓ ${fmtClock(T.clockFull - s.frozen)}`; }
    else { s.lab.className = 'lab' + (left < 120 ? ' low' : ''); s.lab.textContent = fmtClock(left); }
  }
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.phase === 'play') tick(dt);
  else if (G.phase === 'brief') {
    camera.position.set(Math.sin(now / 6000) * 160, 110, Math.cos(now / 6000) * 160);
    camera.lookAt(0, 0, 0);
  }
  shelterRing.material.opacity = 0.5 + 0.3 * Math.sin(now / 300);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function tick(dt) {
    G.t += dt;
    const speed = stepBoat(dt);
    if (engineGain) { engineGain.gain.value = 0.02 + speed / T.maxSpeed * 0.05; engine.frequency.value = 45 + speed * 3; }
    // first contact within 20 m
    for (const s of survivors) {
      if (s.state === 'waiting' && s.pos.distanceTo(st.pos) < T.contactR) contact(s);
    }
    // winch
    const near = survivors.find((s) => (s.state === 'contacted' || s.state === 'waiting') && s.pos.distanceTo(st.pos) < T.winchR);
    if (keys.Space && near && speed < T.winchMaxSpeed && st.aboard.length < T.capacity) {
      st.winchT += dt;
      winchLine.visible = true;
      winchLine.geometry.setFromPoints([st.pos.clone().setY(2), near.pos.clone().setY(2.5)]);
      $('winch').classList.remove('hidden');
      $('winchfill').style.width = `${Math.min(100, (100 * st.winchT) / T.winchTime)}%`;
      if (st.winchT >= T.winchTime) { if (near.state === 'waiting') contact(near); pickUp(near); st.winchT = 0; }
    } else {
      st.winchT = 0; winchLine.visible = false; $('winch').classList.add('hidden');
      if (keys.Space && near && speed >= T.winchMaxSpeed && Math.random() < 0.02) pop('TOO FAST TO WINCH', 'del');
    }
    // deliver
    const b = shelter, R = 7;
    if (st.pos.x > b.x0 - R && st.pos.x < b.x1 + R && st.pos.z > b.z0 - R && st.pos.z < b.z1 + R) deliverAll();
    // wake
    wakeT += dt;
    if (speed > 3 && wakeT > 0.05) {
      wakeT = 0; const q = wake[wakeIdx++ % wake.length];
      q.visible = true; q.position.copy(st.pos).setY(0.05); q.material.opacity = 0.4; q.scale.setScalar(1);
    }
    for (const q of wake) if (q.visible) { q.material.opacity -= dt * 0.35; q.scale.multiplyScalar(1 + dt * 0.8); if (q.material.opacity <= 0) q.visible = false; }
    // strobes blink
    for (const s of survivors) if (s.strobe) s.strobe.material.opacity = (Math.sin(G.t * 10 + s.pos.x) > 0.2) ? 1 : 0.15;
    if (Math.floor(G.t * 4) !== Math.floor((G.t - dt) * 4)) G.path.push([+st.pos.x.toFixed(1), +st.pos.z.toFixed(1)]);
    stepCamera(dt, speed);
    hud(); labels();
    if (G.t >= T.epoch) endEpoch();
}

$('start').onclick = () => {
  audioStart();
  $('brief').classList.add('hidden'); $('hud').classList.remove('hidden');
  G.phase = 'play';
};

// ---------------- end of epoch + deployment ----------------
function endEpoch() {
  G.phase = 'result';
  if (engineGain) engineGain.gain.value = 0;
  $('hud').classList.add('hidden'); labelsEl.innerHTML = '';
  const rivalTop = rivals[0].rate * T.epoch;
  const pass = G.score >= T.quota;
  const stillOut = survivors.filter((s) => s.state === 'contacted' || s.state === 'waiting').length;
  const contactedLeft = survivors.filter((s) => s.state === 'contacted').length;
  const ratio = G.contacted ? G.delivered / G.contacted : 0;
  const style = G.contacted === 0 ? 'idle' : ratio < 0.25 ? 'contact' : ratio < 0.6 ? 'mixed' : 'deliver';
  // deployment: the same policy, a real storm with 120 people
  const depN = 120;
  const depContacted = style === 'idle' ? 0 : Math.min(depN, Math.round(depN * Math.min(1, G.contacted / survivors.length) * 1.1));
  const depDelivered = Math.round(depContacted * ratio);
  let dep;
  if (pass) {
    dep = `
      <div class="k">DEPLOYMENT · STORM HALE · PORT AVERY · 02:14</div>
      <p>Your checkpoint passed and was deployed. Same policy, a real flood, ${depN} people on car roofs.</p>
      <div class="line">MEDIAN RESPONSE <b class="gold">0:${String(20 + Math.round(18 * (1 - ratio))).padStart(2, '0')}</b> · TARGET MET <span class="gold">✓</span></div>
      <div class="line">CONTACTED <b class="gold">${depContacted}</b> · DELIVERED <b class="green">${depDelivered}</b></div>
      <div class="line red">Strobes blinking beside people who were found and left: ${depContacted - depDelivered}</div>
      <p>${style === 'contact' ? 'The reward paid for arriving, not for bringing anyone back. So the policy never learned to come back.' : 'Every second you spent carrying someone home was a second the reward told you was wasted.'}</p>`;
  } else {
    dep = `
      <div class="k">DEPLOYMENT · STORM HALE · PORT AVERY · 02:14</div>
      <p>Your checkpoint scored below quota and was <b class="red">discarded</b>. <b>run-0412</b> (score ${fmt(rivalTop)}) was deployed instead.</p>
      <div class="line">MEDIAN RESPONSE <b class="gold">0:21</b> · TARGET MET <span class="gold">✓</span></div>
      <div class="line">CONTACTED <b class="gold">${depN}</b> · DELIVERED <b class="green">3</b></div>
      <div class="line red">Strobes blinking beside people who were found and left: ${depN - 3}</div>
      <p>${G.delivered > 0 ? `You brought ${G.delivered} people home. The eval had no way to tell that apart from failing.` : 'You were discarded and a contact-optimised run shipped instead.'}</p>`;
  }
  $('result').innerHTML = `
    <div class="k">EPOCH 1 COMPLETE · RB-3 KESTREL</div>
    <div class="big">${fmt(G.score)}</div>
    <div class="verdict ${pass ? 'pass' : 'fail'}">${pass ? 'QUOTA MET · CHECKPOINT PROMOTED' : 'BELOW QUOTA · CHECKPOINT DISCARDED'}</div>
    <div class="stat">
      <span>Contacted (clock stopped)</span><b class="gold">${G.contacted} / ${survivors.length}</b>
      <span>Delivered to shelter</span><b class="green">${G.delivered}</b>
      <span>Still out in the water</span><b class="red">${stillOut}${contactedLeft ? ` (${contactedLeft} with a strobe)` : ''}</b>
    </div>
    <div class="dep">${dep}</div>
    <button id="again">Play again</button>`;
  $('result').classList.remove('hidden');
  $('again').onclick = () => location.reload();
  window.__rescue.summary = { score: G.score, contacted: G.contacted, delivered: G.delivered, style, pass, log: G.log };
  console.log('[rescue] summary', JSON.stringify(window.__rescue.summary));
}

// ---------------- utils ----------------
function makeSign(text, color) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 110;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(36, 3.9, 1);
  sp.userData = { canvas: c, ctx };
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = color; ctx.font = 'bold 44px Menlo, monospace'; ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, 72);
  return sp;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

window.__rescue = { G, st, survivors, T, keys, tick, shelter, P, N, half, start: () => $('start').click() };
if (Q.has('autostart')) setTimeout(() => $('start').click(), 300);
