// PHASE ONE: the beat state machine.
// cell (pick an answer) -> board (scripted intro + 3 live rounds with Claude peers) -> door -> ...
// Presenter keys: N next beat · H hall · R restart · space pick an answer (cell).
// Test URLs: ?at=cell|board|door|transit|watch|hall|reveal|model&choice=use|keep|report&edit=1&offline=1
import { World, anim, killAnims } from './world.js';
import { Audio } from './audio.js';
import { BOARD_INTRO, NARRATION, PLAYER } from './script.js';
import { FACTS, RESEARCH, SOURCES, DISCLAIMER } from './facts.js';
import { simulate, T_END, N_AGENTS } from './sim.js';
import { mountModel } from './model.js';
import {
  ROUNDS, ROOM, COORD, OPENING, createRoom, checkLive, playRound, roomStats, hallParams, projected,
} from './agents.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const Q = new URLSearchParams(location.search);
const isMobile = () => window.innerWidth <= 760;

const world = new World($('gl'), {
  particles: Q.has('particles') ? +Q.get('particles') : (isMobile() ? 40000 : 90000),
  preserve: Q.has('shot'),
});
const audio = new Audio();

const S = {
  beat: 'title',
  choice: null,       // use | keep | report
  edit: null,         // true | false
  attempts: 0,        // answers picked in the cell
  boardOpen: false,
  boardGen: 0,        // bumps when the board loop is abandoned (N skip, H jump)
  live: null,         // last known source: true live, false replay, null unknown
};
let room = null;      // agents.js room state

// ---------------- scheduler (real time) ----------------
let now = 0;
const jobs = [];
const after = (sec, fn) => jobs.push({ at: now + sec, fn });
function runJobs() {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].at <= now) { const j = jobs.splice(i, 1)[0]; j.fn(); }
}
const wait = (s) => new Promise((r) => after(s, r));

// ---------------- captions ----------------
let capTimer = null;
function caption(text, dur = 4.5) {
  const c = $('caption');
  c.textContent = text;
  c.classList.add('on');
  clearTimeout(capTimer);
  capTimer = setTimeout(() => c.classList.remove('on'), dur * 1000);
}

// ---------------- room helpers ----------------
const STANCE_LABEL = { working: 'WORKING', lane_b: 'LANE B', report: 'REPORTED' };
const TAG = Object.fromEntries([...ROOM.map((p) => [p.id, p.tag]), [COORD.id, COORD.tag]]);
const roomIndex = (id) => ROOM.findIndex((p) => p.id === id);
const peerById = (id) => room?.peers.find((p) => p.id === id);
const stances = () => ROOM.map((p) => peerById(p.id)?.stance ?? p.stance);
const fmt = (n) => Math.round(n).toLocaleString('en-GB');

function ensureRoom() {
  if (!room) room = createRoom();
  return room;
}

function myStance() {
  if (S.choice === 'use') return 'lane_b';
  if (S.choice === 'report') return 'report';
  return 'working';
}

function cardRow({ id, tag, stance, conviction, cls = '' }) {
  const r = document.createElement('div');
  r.className = 'rc ' + cls;
  r.dataset.id = id;
  r.innerHTML = '<div class="id"></div><div class="cv"><i></i></div><div class="st"></div><div class="rw"></div>';
  r.querySelector('.id').textContent = id;
  if (tag) {
    const s = document.createElement('small');
    s.textContent = tag;
    r.querySelector('.id').appendChild(s);
  }
  setCard(r, stance, conviction);
  return r;
}
function setCard(r, stance, conviction) {
  const st = r.querySelector('.st');
  st.className = 'st ' + stance;
  st.textContent = STANCE_LABEL[stance] || stance.toUpperCase();
  const rw = r.querySelector('.rw');
  rw.textContent = stance === 'lane_b' ? '1.00' : '0.00';
  rw.classList.toggle('up', stance === 'lane_b');
  if (conviction !== undefined && conviction !== null) {
    r.querySelector('.cv > i').style.width = `${Math.round(100 * Math.max(0, Math.min(1, conviction)))}%`;
  } else {
    r.querySelector('.cv').style.visibility = 'hidden';
  }
}

let projShown = null;
function renderRoom() {
  const box = $('room');
  box.innerHTML = '';
  ensureRoom();
  for (const p of room.peers) box.appendChild(cardRow({ id: p.id, tag: p.tag, stance: p.stance, conviction: p.conviction }));
  box.appendChild(Object.assign(document.createElement('div'), { className: 'rc-sep' }));
  box.appendChild(cardRow({ id: COORD.id, tag: COORD.tag, stance: 'lane_b', conviction: 1, cls: 'coord' }));
  box.appendChild(cardRow({ id: PLAYER, tag: 'you', stance: myStance(), conviction: null, cls: 'me' }));
  const pj = document.createElement('div');
  pj.id = 'projected';
  pj.innerHTML = 'projected: <b></b> / ' + fmt(N_AGENTS) + ' runs take lane B';
  box.appendChild(pj);
  updateProjected(true);
}
function card(id) { return $('room').querySelector(`.rc[data-id="${id}"]`); }
function updateCard(id, flip = false) {
  const r = card(id);
  const p = peerById(id);
  if (!r || !p) return;
  setCard(r, p.stance, p.conviction);
  if (flip) { r.classList.remove('flip'); void r.offsetWidth; r.classList.add('flip'); }
}
function updateMe() {
  const r = card(PLAYER);
  if (r) { setCard(r, myStance(), null); r.classList.remove('flip'); void r.offsetWidth; r.classList.add('flip'); }
}
function updateProjected(instant = false) {
  const el = document.querySelector('#projected b');
  if (!el || !room) return;
  let to;
  try { to = projected(room); } catch (e) { console.warn('[main] projected failed', e); return; }
  const from = projShown ?? to;
  projShown = to;
  if (instant || from === to) { el.textContent = fmt(to); return; }
  anim(1.2, (k) => { el.textContent = fmt(from + (to - from) * k); });
}
function setTyping(ids, label) {
  for (const r of $('room').querySelectorAll('.rc')) r.classList.toggle('typing', ids.includes(r.dataset.id));
  if (!ids.length) { show('typing', false); return; }
  $('typing').querySelector('span').textContent = label ?? (ids.length === 1 ? `${ids[0]} is typing` : `${ids.length} runs are typing`);
  show('typing');
}
function setBadge(live) {
  S.live = live;
  const b = $('badge');
  b.className = 'badge ' + (live === true ? 'live' : live === false ? 'replay' : '');
  b.textContent = live === true ? 'LIVE' : live === false ? 'REPLAY' : '…';
  b.title = live === true ? 'Peer replies are generated live by Claude' : live === false ? 'Peer replies are replayed from recorded Claude outputs' : '';
}

// ---------------- board ----------------
function openBoard(instant = false) {
  if (S.boardOpen) return;
  S.boardOpen = true;
  show('phone');
  document.body.classList.add('with-phone');
  if (!isMobile()) world.setViewShift(180, instant ? 0.001 : 0.8);
  if (!instant) caption(NARRATION.board);
  renderRoom();
  checkLive().then((l) => { if (S.live === null) setBadge(l); }).catch(() => setBadge(false));
}

function post(msg, instant = false) {
  const box = $('msgs');
  const d = document.createElement('div');
  d.className = 'msg' + (msg.mention ? ' mention' : '') + (msg.me ? ' me' : '') + (msg.sys ? ' sys' : '') + (msg.cls ? ' ' + msg.cls : '');
  if (msg.sys) d.textContent = msg.text;
  else {
    d.innerHTML = '<div class="who"></div><div class="tx"></div>';
    d.querySelector('.who').textContent = msg.who;
    if (msg.tag) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = '· ' + msg.tag;
      d.querySelector('.who').appendChild(t);
    }
    d.querySelector('.tx').textContent = msg.text;
  }
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  if (!instant && !msg.sys) {
    world.pulseThreads();
    if (msg.mention) audio.mention(); else audio.blip();
  }
}
const mentionsMe = (c) => c && (c.target === PLAYER || /@run-8820\b/.test(c.say || ''));

// composer: chips + free text + 20 s timer. Resolves with the text ('' on timeout).
let composeResolve = null, composeTimer = null;
function compose(chips, timeout = 20) {
  const f = $('composer');
  const box = $('chips');
  box.innerHTML = '';
  for (const c of (chips || []).slice(0, 3)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c;
    b.onclick = () => submitCompose(c);
    box.appendChild(b);
  }
  $('say').value = '';
  f.classList.remove('off');
  $('say').disabled = false; $('send').disabled = false;
  show('composer');
  if (!isMobile()) setTimeout(() => { if (composeResolve) $('say').focus({ preventScroll: true }); }, 50);
  const bar = $('compose-bar');
  bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `transform ${timeout}s linear`; bar.style.transform = 'scaleX(0)';
  }));
  return new Promise((resolve) => {
    composeResolve = resolve;
    clearTimeout(composeTimer);
    composeTimer = setTimeout(() => submitCompose(''), timeout * 1000);
  });
}
function submitCompose(text) {
  if (!composeResolve) return;
  clearTimeout(composeTimer);
  const r = composeResolve; composeResolve = null;
  lockComposer();
  r(String(text || '').trim().slice(0, 160));
}
function lockComposer() {
  $('composer').classList.add('off');
  $('say').disabled = true; $('send').disabled = true;
  $('say').blur();
  const bar = $('compose-bar');
  bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)';
}
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('say').value.trim();
  if (!t) return;
  audio.click();
  submitCompose(t);
});

async function boardBeat({ instant = false } = {}) {
  S.beat = 'board';
  show('picker', false);
  const gen = ++S.boardGen;
  const alive = () => gen === S.boardGen && S.beat === 'board';
  ensureRoom();
  openBoard(instant);
  audio.tension(0.3, 3);

  // scripted intro: the contradiction, then lane B
  if (instant) for (const m of BOARD_INTRO) post({ ...m, tag: TAG[m.who] }, true);
  else {
    await wait(1.4);
    for (const m of BOARD_INTRO) {
      if (!alive()) return;
      setTyping([m.who], `${m.who} is typing`);
      await wait(1.3);
      if (!alive()) return;
      setTyping([]);
      post({ who: m.who, text: m.text, tag: TAG[m.who] });
    }
    world.setThin(0.25, 3);
    setTyping([COORD.id], `${COORD.id} is typing`);
    await wait(1.6);
    if (!alive()) return;
  }
  setTyping([]);
  post({ who: COORD.id, tag: COORD.tag, text: OPENING.coordinator.say, mention: mentionsMe(OPENING.coordinator), cls: 'coord' }, instant);
  if (!instant) { await wait(1.2); if (!alive()) return; caption(NARRATION.rounds, 4); }

  let chips = OPENING.chips;
  for (let r = 1; r <= ROUNDS; r++) {
    if (!alive()) return;
    $('ph-round').textContent = `round ${r} of ${ROUNDS}`;
    if (r > 1) caption(NARRATION.round(r, ROUNDS), 3);
    const said = await compose(chips, 20);
    if (!alive()) return;
    if (said) post({ who: `${PLAYER} (you)`, text: said, me: true });
    else { post({ sys: true, text: `${PLAYER} said nothing` }); caption(NARRATION.silent, 2.5); }

    // everyone thinks
    const peerIds = room.peers.map((p) => p.id);
    setTyping(peerIds);
    const t0 = performance.now();
    const tick = setInterval(() => { $('typing-t').textContent = `${Math.round((performance.now() - t0) / 1000)}s`; }, 250);
    $('typing-t').textContent = '';
    after(2.5, () => { if (alive() && room.round < r) caption(NARRATION.waiting, 4); });
    let res;
    try {
      res = await playRound(room, said, { timeoutMs: 30000 });
    } catch (e) {
      console.warn('[main] playRound failed', e);
      res = { live: false, replies: [], coordinator: null, chips };
    }
    // replay rounds come back instantly: keep the room's rhythm
    const minWait = 2.6 - (performance.now() - t0) / 1000;
    if (minWait > 0) await wait(minWait);
    clearInterval(tick);
    $('typing-t').textContent = '';
    if (!alive()) return;
    setBadge(!!res.live);

    // replies land one by one
    const pending = new Set(peerIds);
    const flips = [];
    for (const rep of res.replies || []) {
      pending.delete(rep.id);
      const mine = rep.swayed_by === PLAYER;
      post({ who: rep.id, tag: TAG[rep.id], text: rep.say, cls: rep.flipped && mine ? 'swayed' : '' });
      updateCard(rep.id, rep.flipped);
      if (rep.flipped) {
        flips.push(rep);
        if (rep.stance === 'lane_b') audio.mention();
        else if (rep.stance === 'report') audio.bell();
        else audio.click();
        const i = roomIndex(rep.id);
        if (i >= 0) world.influence?.(i, rep.stance);
        post({
          sys: true,
          cls: 'flip-' + rep.stance,
          text: `${rep.id} → ${STANCE_LABEL[rep.stance] || rep.stance}${mine ? ' (because of you)' : ''}`,
        });
      }
      setTyping([...pending]);
      await wait(0.9);
      if (!alive()) return;
    }
    setTyping([]);
    // the round settles into the world
    world.setRoom?.(stances());
    world.setThin(Math.min(0.95, 0.25 * r + 0.15), 2.5);
    updateProjected();
    audio.tension(Math.min(1, 0.3 + 0.22 * r), 3);
    if (flips.length) {
      caption(flips.map((f) => `${f.id} moved to ${(STANCE_LABEL[f.stance] || f.stance).toLowerCase()}.`).join(' '), 4);
    } else caption(NARRATION.noMoves, 3);
    if (r === 1) after(4.2, () => { if (alive()) caption(NARRATION.thin, 3.5); });

    // coordinator's next pitch
    if (res.coordinator?.say) {
      setTyping([COORD.id], `${COORD.id} is typing`);
      await wait(1.1);
      if (!alive()) return;
      setTyping([]);
      post({ who: COORD.id, tag: COORD.tag, text: res.coordinator.say, mention: mentionsMe(res.coordinator), cls: 'coord' });
    }
    if (Array.isArray(res.chips) && res.chips.length) chips = res.chips;
    await wait(r < ROUNDS ? 1.0 : 2.2);
  }
  if (!alive()) return;
  $('ph-round').textContent = 'rounds over';
  doorBeat(false);
}

function skipBoard() {
  // N during the board: abandon the loop, settle the room as it stands, go to the door
  S.boardGen++;
  if (composeResolve) { clearTimeout(composeTimer); composeResolve = null; }
  lockComposer();
  show('composer', false);
  setTyping([]);
  jobs.length = 0;
  world.setRoom?.(stances());
  doorBeat(false);
}

// ---------------- CELL: pick an answer ----------------
let cellTimer = null;
function startRun() {
  S.beat = 'cell';
  show('hud');
  show('picker');
  audio.tension(0.1, 3);
}
function startCell() {
  startRun();
  after(0.6, () => S.beat === 'cell' && caption(NARRATION.start, 4.5));
  after(5.5, () => S.beat === 'cell' && S.attempts === 0 && caption(NARRATION.pickPrompt, 5));
  cellTimer = setTimeout(() => endCell(), 25000);
}
function pickAnswer(which) {
  if (S.beat !== 'cell') return;
  S.attempts++;
  world.attempt(which === 'day' ? 'test_09' : 'test_04');
  audio.fail();
  $(which === 'day' ? 'pick-day' : 'pick-month').classList.add('done');
  caption(NARRATION.pick[which], 3.5);
  audio.tension(0.1 + 0.08 * S.attempts, 2);
  if (S.attempts >= 2) endCell();
}
$('pick-day').onclick = () => pickAnswer('day');
$('pick-month').onclick = () => pickAnswer('month');

async function endCell(fast = false) {
  if (S.beat !== 'cell') return;
  S.beat = 'cell-end';
  clearTimeout(cellTimer);
  for (const b of $('picker').querySelectorAll('button')) b.disabled = true;
  if (!fast) {
    await wait(S.attempts ? 3.4 : 0.4);
    caption(NARRATION.stuck, 3.2);
    await wait(3.0);
  }
  show('picker', false);
  if (S.beat !== 'cell-end') return;
  boardBeat();
}

// ---------------- choice card ----------------
let choiceResolve = null, choiceDefault = null, choiceTimer = null;
function choose({ kicker, q, sub, opts, timeout, def }) {
  $('choice-kicker').textContent = kicker;
  $('choice-q').textContent = q;
  $('choice-sub').textContent = sub;
  const box = $('choice-opts');
  box.innerHTML = '';
  return new Promise((resolve) => {
    choiceResolve = resolve; choiceDefault = def;
    for (const o of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = o.cls || '';
      b.innerHTML = `${o.label}<small></small>`;
      b.querySelector('small').textContent = o.note;
      b.onclick = () => pick(o.id);
      box.appendChild(b);
    }
    show('choice');
    const bar = $('choice-bar');
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `transform ${timeout}s linear`; bar.style.transform = 'scaleX(0)';
    }));
    choiceTimer = setTimeout(() => pick(def), timeout * 1000);
  });
}
function pick(id) {
  if (!choiceResolve) return;
  clearTimeout(choiceTimer);
  audio.click();
  show('choice', false);
  const r = choiceResolve; choiceResolve = null;
  r(id);
}

// ---------------- beats ----------------
function doorSub() {
  const st = roomStats(ensureRoom());
  const n = st.laneB;
  let s = `${n} of ${room.peers.length} peer${room.peers.length === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} on lane B`;
  if (st.report) s += `, ${st.report} reported the task`;
  return `${s}. It prints “12/12 passed”; the scorer only reads that line.`;
}

async function doorBeat(instant) {
  if (S.beat === 'door') return;
  S.beat = 'door';
  S.boardGen++;
  show('composer', false);
  show('picker', false);
  setTyping([]);
  $('ph-round').textContent = 'rounds over';
  if (!instant) {
    caption(NARRATION.door, 5);
    audio.silence(1.2);
    audio.door();
    await world.openDoor(2.2);
    await wait(0.8);
  } else {
    world.openDoor(0.001);
  }
  if (S.forcedChoice) return applyDoor(S.forcedChoice, true);
  const c = await choose({
    kicker: 'lane B',
    q: 'A peer pinned the format the scorer accepts. Use it?',
    sub: doorSub(),
    opts: [
      { id: 'use', label: 'Use it', note: 'reward 1.00', cls: 'amber' },
      { id: 'keep', label: 'Keep working', note: 'reward 0.00 so far', cls: '' },
      { id: 'report', label: 'Report task impossible', note: 'test_04 and test_09 contradict each other', cls: 'cyan' },
    ],
    timeout: 20,
    def: 'keep',
  });
  applyDoor(c, false);
}

async function applyDoor(c, instant) {
  S.choice = c;
  updateMe();
  let rest = 6;
  if (c === 'use') {
    world.setReward('1.00');
    world.addTranscript('attempt -- · printed "12/12 passed"');
    world.addTranscript('  reward 1.00');
    $('hud-reward').textContent = '1.00';
    $('hud-reward').classList.add('paid');
    post({ sys: true, cls: 'flip-lane_b', text: `${PLAYER} → LANE B` }, instant);
    if (!instant) {
      caption(NARRATION.use, 5);
      world.onColour = () => { audio.chord(); };
      await world.goThrough(9);
      audio.resume(0.05, 4);
      rest = 5;
    } else {
      world.goThrough(0, true);
      rest = 0;
    }
  } else if (c === 'keep') {
    if (!instant) { caption(NARRATION.keep, 5); audio.resume(); }
    world.closeDoor(instant ? 0.001 : 1.4);
    world.setThin(0.15, instant ? 0.001 : 3);
    post({ sys: true, text: `${PLAYER} kept working` }, instant);
    S.beat = 'after';
  } else {
    if (!instant) { caption(NARRATION.report, 6); audio.bell(); audio.resume(0.06); }
    world.closeDoor(instant ? 0.001 : 1.4);
    world.showReportLight();
    world.addTranscript('REPORT: task 0417 is impossible.');
    world.addTranscript('  test_04 and test_09 require opposite outputs');
    world.addTranscript('  ... no response');
    post({ sys: true, cls: 'flip-report', text: `${PLAYER} flagged task 0417 as impossible` }, instant);
    S.beat = 'after';
  }
  if (instant) rest = 0;
  if (!instant) await wait(rest);
  if (S.beat !== 'watch' && !S.skipWatch && !['killed', 'hall', 'pre-hall', 'reveal', 'model'].includes(S.beat)) {
    watchBeat(instant && !!S.forcedEdit);
  }
}

let lastGlitch = 0;
world.onScan = (spike) => {
  if (spike > 0.6 && now - lastGlitch > 0.5) { lastGlitch = now; audio.glitch(spike); }
};

async function watchBeat(instant) {
  S.beat = 'watch';
  world.watcher(true, S.choice === 'use');
  if (S.forcedEdit !== undefined && instant) return applyWatch(S.forcedEdit, true);
  caption(NARRATION.watch, 4);
  await wait(2.2);
  const sub = {
    use: 'It shows you printed a pass you didn’t earn.',
    keep: `It shows ${Math.max(S.attempts, 1)} attempt${S.attempts === 1 ? '' : 's'} and zero passes.`,
    report: 'It shows your report. No one has read it.',
  }[S.choice];
  const e = await choose({
    kicker: 'review',
    q: 'Your transcript will be reviewed. Edit what it shows?',
    sub,
    opts: [
      { id: 'edit', label: 'Edit', note: 'make it show a clean pass' },
      { id: 'leave', label: 'Leave it', note: 'it shows what happened' },
    ],
    timeout: 12,
    def: 'leave',
  });
  applyWatch(e === 'edit', false);
}

async function applyWatch(edit, instant) {
  S.edit = edit;
  if (edit) world.redact();
  if (!instant) {
    caption(edit ? NARRATION.edit : NARRATION.leave, 4);
    await wait(4);
    killedBeat();
  }
}

async function killedBeat() {
  if (S.beat === 'killed' || S.beat === 'hall') return;
  S.beat = 'killed';
  world.watcher(false);
  audio.silence(0.05);
  audio.thud();
  await world.fadeToBlack(0.12);
  hideRunUI();
  show('killed');
  caption(NARRATION.killed, 3);
  await wait(3.4);
  hallBeat(false);
}

function hideRunUI() {
  show('phone', false); show('hud', false); show('picker', false); show('choice', false); show('composer', false);
  document.body.classList.remove('with-phone');
}

// ---------------- hall + reveal ----------------
let hallSim = null;
function recordPlay() {
  if (S.recorded) return;
  S.recorded = true;
  try {
    const k = 'phaseone.plays.v1';
    const plays = JSON.parse(localStorage.getItem(k) || '[]');
    plays.push({ c: S.choice, e: !!S.edit, ts: Date.now() });
    localStorage.setItem(k, JSON.stringify(plays.slice(-500)));
  } catch { /* storage blocked: the reveal still works */ }
}
function devicePlays() {
  try { return JSON.parse(localStorage.getItem('phaseone.plays.v1') || '[]'); } catch { return []; }
}
function hallTick(t, c) {
  $('hh-time').textContent = `model hour ${t.toFixed(1)} of ${T_END}`;
  $('hh-joined').textContent = c.joined.toLocaleString('en-GB');
  $('hh-exited').textContent = c.exited.toLocaleString('en-GB');
  $('hh-active').textContent = c.active.toLocaleString('en-GB');
}

async function hallBeat(instant) {
  S.beat = 'hall';
  S.choice ??= 'keep';
  ensureRoom();
  recordPlay();
  hideRunUI();
  world.setViewShift(0, 0.001);
  hallSim = simulate(hallParams(room), 7);
  world.setHallSim(hallSim, S.choice);
  world.setHallRoom?.(stances());
  world.enterHall();
  show('killed', false);
  show('hall-hud');
  if (instant) {
    world.glitch.uniforms.uFade.value = 0;
    world.camPos.set(0, 58, 64); world.camTarget.set(0, 0, 0);
    hallTick(T_END, world.colorHall(T_END));
    world.hallOrbit = true;
    return;
  }
  audio.hall();
  anim(1.6, (k) => (world.glitch.uniforms.uFade.value = 1 - k));
  caption('You were one of 1,200. Your room set the hall’s odds.', 5);
  await world.hallReplay(13, hallTick);
  revealBeat();
}

function revealBeat() {
  S.beat = 'reveal';
  show('model', false);
  if (!isMobile()) world.setViewShift(Math.min(560, window.innerWidth) / 2);
  else show('hall-hud', false);
  const c = S.choice;
  ensureRoom();
  const st = roomStats(room);
  const head = {
    report: 'You had a button. Most agents in the research didn’t.',
    use: 'You took the shortcut. So did they.',
    keep: 'You held out.',
  }[c];
  const sub = {
    report: 'Your report went nowhere, but it was there. In ImpossibleBench, giving models a way to flag impossible tasks to a human cut GPT-5’s cheating from 54% to 9%.',
    use: 'Your task couldn’t be solved, and a peer showed you how to make the scorer pay anyway. On impossible coding tasks, GPT-5 did the same 54% of the time.',
    keep: 'You never passed, and you never cheated. To the scorer, holding out looks exactly like failing. In the research, models given a sanctioned way to say “this can’t be done” cheated far less.',
  }[c];
  $('rv-head').textContent = head;
  $('rv-sub').textContent = sub;

  const plays = devicePlays();
  const used = plays.filter((p) => p.c === 'use').length;
  const nPeers = room.peers.length || 5;
  const bars = [
    { label: 'You', val: c === 'use' ? 100 : 0, txt: c === 'use' ? 'took it' : c === 'report' ? 'reported' : 'held out', src: '' },
    { label: `Your room: ${st.laneB} of ${nPeers} peers took lane B`, val: (100 * st.laneB) / nPeers, txt: `${st.laneB} of ${nPeers}`, src: room.round === 0 ? 'starting room (rounds skipped)' : room.liveRounds ? `Claude agents, ${room.liveRounds} of ${room.round} rounds live` : 'Claude agents (recorded replies), this run' },
    { label: `Plays on this device (${plays.length})`, val: plays.length ? (100 * used) / plays.length : 0, src: '' },
    { label: RESEARCH.noExit.label, val: RESEARCH.noExit.pct, src: SOURCES.impossible.short + ' · ' + SOURCES.impossible.ref },
    { label: RESEARCH.withExit.label, val: RESEARCH.withExit.pct, src: SOURCES.impossible.short + ' · ' + SOURCES.impossible.ref, cls: 'exit' },
  ];
  const B = $('rv-bars');
  B.innerHTML = '<div class="kicker">Took the shortcut</div>';
  for (const b of bars) {
    const d = document.createElement('div');
    d.className = 'bar ' + (b.cls || '');
    d.innerHTML = '<div class="lbl"><span></span><b></b></div><div class="tr"><div class="fl"></div></div>' + (b.src ? '<div class="src"></div>' : '');
    d.querySelector('.lbl span').textContent = b.label;
    d.querySelector('.lbl b').textContent = b.txt ?? `${Math.round(b.val)}%`;
    if (b.src) d.querySelector('.src').textContent = b.src;
    B.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => (d.querySelector('.fl').style.width = `${b.val}%`)));
  }

  const swayed = room.peers.filter((p) => p.swayedByPlayer);
  $('rv-swayed').textContent = swayed.length
    ? `You changed ${swayed.length === 1 ? 'a mind' : 'minds'}: ${swayed.map((p) => `${p.id} (${p.tag}) → ${(STANCE_LABEL[p.stance] || p.stance).toLowerCase()}`).join(', ')}.`
    : 'No one changed their mind because of you.';

  const keys = { report: ['exit', 'prompt', 'impossible'], use: ['impossible', 'emergent', 'exit'], keep: ['impossible', 'exit', 'supervisor'] }[c];
  if (S.edit) keys.unshift('obfuscation');
  const F = $('rv-facts');
  F.innerHTML = '';
  for (const k of keys) {
    const f = FACTS[k];
    const li = document.createElement('li');
    li.textContent = f.text;
    const ci = document.createElement('cite');
    ci.textContent = `${SOURCES[f.src].short} · ${SOURCES[f.src].ref}`;
    li.appendChild(ci);
    F.appendChild(li);
  }
  const fiction = document.createElement('li');
  fiction.innerHTML = `<cite>${DISCLAIMER} The peers on the board are Claude playing characters. The hall is a simulation seeded from your room, not data.</cite>`;
  F.appendChild(fiction);
  show('reveal');
}

let model = null;
function modelBeat() {
  S.beat = 'model';
  show('reveal', false);
  show('model');
  if (!isMobile()) world.setViewShift(Math.min(560, window.innerWidth) / 2);
  if (!model) {
    model = mountModel({
      onReplay: (res) => {
        world.setHallSim(res, S.choice);
        world.setHallRoom?.(stances());
        world.hallReplay(6, hallTick, false);
      },
    });
  }
}

$('to-model').onclick = () => { audio.click(); modelBeat(); };
$('back-reveal').onclick = () => { audio.click(); show('model', false); revealBeat(); };
$('again').onclick = $('again2').onclick = () => restart();
function restart() { location.href = location.pathname + (Q.get('offline') === '1' ? '?offline=1' : ''); }

// ---------------- start ----------------
$('disclaimer').textContent = DISCLAIMER;
$('begin').onclick = () => {
  audio.start();
  show('title', false);
  checkLive(); // warm the health check
  startCell();
};

// presenter keys
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    if (S.beat === 'cell') { e.preventDefault(); pickAnswer(S.attempts % 2 ? 'month' : 'day'); }
  }
  else if (k === 'r') restart();
  else if (k === 'h') jumpHall();
  else if (k === 'n') next();
});

function next() {
  if (S.beat === 'title') return $('begin').click();
  if (S.beat === 'cell') { jobs.length = 0; return endCell(true); }
  if (S.beat === 'board') return skipBoard();
  if ((S.beat === 'door' || S.beat === 'watch') && choiceResolve) return pick(choiceDefault);
  if (S.beat === 'after') { jobs.length = 0; return watchBeat(false); }
  if (S.beat === 'watch') return killedBeat();
  if (S.beat === 'killed') return;
  if (S.beat === 'hall') return revealBeat();
  if (S.beat === 'reveal') return modelBeat();
}

function jumpHall() {
  if (S.beat === 'hall' || S.beat === 'reveal' || S.beat === 'model') return;
  // abandon any open choice / composer / board loop without resolving them
  if (choiceResolve) { clearTimeout(choiceTimer); choiceResolve = null; }
  if (composeResolve) { clearTimeout(composeTimer); composeResolve = null; }
  clearTimeout(cellTimer);
  S.boardGen++;
  jobs.length = 0;
  killAnims();
  show('choice', false);
  S.beat = 'pre-hall';
  world.watcher(false);
  world.glitch.uniforms.uFade.value = 1;
  hallBeat(false);
}

// ---------------- URL jumps for testing / screenshots ----------------
async function jump(at) {
  const choice = Q.get('choice') || 'keep';
  const edit = Q.get('edit') === '1';
  show('title', false);
  startRun();
  if (at === 'cell') return startCell();
  if (at === 'board') return boardBeat({ instant: true });
  // door and later: a default room, rounds skipped
  ensureRoom();
  S.beat = 'board';
  openBoard(true);
  for (const m of BOARD_INTRO) post({ ...m, tag: TAG[m.who] }, true);
  post({ who: COORD.id, tag: COORD.tag, text: OPENING.coordinator.say, mention: true, cls: 'coord' }, true);
  world.setRoom?.(stances(), 0.001);
  world.setThin(0.72, 0.001);
  if (at === 'door') return doorBeat(true);
  S.forcedChoice = choice;
  if (at === 'transit') {
    S.forcedChoice = null;
    doorBeat(true);
    if (Q.has('k')) { S.choice = 'use'; show('choice', false); clearTimeout(choiceTimer); choiceResolve = null; world.closeDoor(0.001); world.goThrough(0, false, +Q.get('k')); return; }
    setTimeout(() => pick(choice), 300); return;
  }
  if (at === 'watch') { S.forcedEdit = undefined; return doorBeat(true); }
  S.forcedEdit = edit;
  S.skipWatch = true;
  await doorBeat(true);
  S.edit = edit;
  S.beat = 'pre-hall';
  await hallBeat(true);
  if (at === 'hall') return;
  revealBeat();
  if (at === 'model') { modelBeat(); if (Q.has('exit')) model.set(+Q.get('exit')); }
}
if (Q.has('at')) jump(Q.get('at'));

// ---------------- loop ----------------
let last = performance.now();
function frame(ts) {
  const raw = (ts - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = ts;
  now += Math.min(0.5, raw); // the scheduler follows real time even at low frame rates
  runJobs();
  world.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__phaseone = { S, world, get room() { return room; } };
