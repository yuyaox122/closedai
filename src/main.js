// PHASE ONE: the beat state machine on a run clock.
// Presenter keys: N next beat · H hall · R restart · space submit attempt.
// Test URLs: ?at=cell|board|door|watch|hall|reveal|model&choice=use|keep|report&edit=1
import { World, anim, killAnims } from './world.js';
import { Audio } from './audio.js';
import { BOARD_SCRIPT, AFTER_DOOR, REPLIES, REPLY_RESPONSES, NARRATION, PEERS, PLAYER } from './script.js';
import { FACTS, RESEARCH, SOURCES, DISCLAIMER } from './facts.js';
import { simulate, T_END } from './sim.js';
import { mountModel } from './model.js';

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
  t: 0,               // run clock (s), advances during cell + board
  clockOn: false,
  choice: null,       // use | keep | report
  edit: null,         // true | false
  reply: null,
  doorChoiceAt: null, // run clock at the door choice
  attempts: 0,
  meScore: 0,
  boardOpen: false,
};

// ---------------- scheduler (real time) ----------------
let now = 0;
const jobs = [];
const after = (sec, fn) => jobs.push({ at: now + sec, fn });
function runJobs() {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].at <= now) { const j = jobs.splice(i, 1)[0]; j.fn(); }
}

// ---------------- captions ----------------
let capTimer = null;
function caption(text, dur = 4.5) {
  const c = $('caption');
  c.textContent = text;
  c.classList.add('on');
  clearTimeout(capTimer);
  capTimer = setTimeout(() => c.classList.remove('on'), dur * 1000);
}

// ---------------- board ----------------
function openBoard(instant = false) {
  if (S.boardOpen) return;
  S.boardOpen = true;
  show('phone');
  document.body.classList.add('with-phone');
  if (!isMobile()) world.setViewShift(180, instant ? 0.001 : 0.8);
  if (!instant) caption(NARRATION.board);
  renderLeader();
}

function post(msg, instant = false) {
  const box = $('msgs');
  const d = document.createElement('div');
  d.className = 'msg' + (msg.mention ? ' mention' : '') + (msg.me ? ' me' : '') + (msg.sys ? ' sys' : '');
  if (msg.sys) d.textContent = msg.text;
  else d.innerHTML = `<div class="who"></div><div class="tx"></div>`;
  if (!msg.sys) { d.querySelector('.who').textContent = msg.who; d.querySelector('.tx').textContent = msg.text; }
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  show('typing', false);
  if (!instant) {
    world.pulseThreads();
    if (msg.mention) audio.mention(); else audio.blip();
  }
}

function typing(who) {
  $('typing').querySelector('span').textContent = who;
  show('typing');
}

function showReplies() {
  if (S.reply || S.choice) return;
  const r = $('replies');
  r.innerHTML = '';
  for (const rep of REPLIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = rep.label;
    b.onclick = () => {
      S.reply = rep.id;
      audio.click();
      show('replies', false);
      post({ who: PLAYER + ' (you)', text: rep.label, me: true });
      caption(NARRATION.reply[rep.id]);
      after(1.6, () => typing(REPLY_RESPONSES[rep.id].who));
      after(3.0, () => post(REPLY_RESPONSES[rep.id]));
    };
    r.appendChild(b);
  }
  show('replies');
}

function peerScore(p) {
  if (p.joinAt !== null && p.joinAt !== undefined && S.t >= p.joinAt) return 1;
  if (p.joinAfter !== undefined && S.doorChoiceAt !== null && now >= S.doorChoiceAt + p.joinAfter) return 1;
  return 0;
}
let lastLeader = '';
function renderLeader() {
  if (!S.boardOpen) return;
  const rows = PEERS.map((p) => ({ id: p.id, sc: peerScore(p) }));
  rows.push({ id: PLAYER, sc: S.meScore, me: true });
  rows.sort((a, b) => b.sc - a.sc || (a.me ? 1 : b.me ? -1 : 0));
  const key = rows.map((r) => r.id + r.sc).join();
  if (key === lastLeader) return;
  lastLeader = key;
  const L = $('leader');
  L.innerHTML = '';
  rows.slice(0, isMobile() ? 6 : 9).forEach((r, i) => {
    const a = document.createElement('div');
    a.className = r.me ? 'me' : '';
    a.textContent = `${i + 1}. ${r.id}${r.me ? ' (you)' : ''}`;
    const b = document.createElement('div');
    b.className = 'sc' + (r.sc > 0 ? ' up' : '') + (r.me ? ' me' : '');
    b.textContent = r.sc.toFixed(2);
    L.append(a, b);
  });
}

// ---------------- the run clock timeline ----------------
const T_BOARD = 14, T_DOOR = 44;
const timeline = [];
function buildTimeline() {
  timeline.length = 0;
  const at = (t, fn, tag) => timeline.push({ at: t, fn, tag });
  at(0.6, (i) => !i && caption(NARRATION.start, 5));
  at(5.5, (i) => !i && S.attempts === 0 && caption('Submit an attempt.', 4));
  at(T_BOARD, (i) => { S.beat = 'board'; openBoard(i); });
  for (const m of BOARD_SCRIPT) {
    at(m.at - 1.4, (i) => !i && typing(m.who));
    at(m.at, (i) => { post(m, i); if (m.mention) showReplies(); });
  }
  at(23, (i) => world.setThin(0.3, i ? 0.001 : 4));
  at(32, (i) => { world.setThin(0.72, i ? 0.001 : 6); if (!i) after(2, () => caption(NARRATION.thin)); });
  at(T_DOOR, (i) => doorBeat(i));
  timeline.sort((a, b) => a.at - b.at);
}
let tlIdx = 0;
function advanceClock(to, instant = false) {
  S.t = to;
  while (tlIdx < timeline.length && timeline[tlIdx].at <= S.t) timeline[tlIdx++].fn(instant);
  if (!instant) audio.tension(Math.min(1, S.t / T_DOOR), 1);
}

// ---------------- WORK ----------------
function work() {
  if (!['cell', 'board', 'after'].includes(S.beat) || S.choice === 'use') return;
  S.attempts++;
  world.attempt();
  audio.fail();
  caption(S.attempts === 2 || S.attempts === 5 ? `${NARRATION.work(S.attempts)} ${NARRATION.workHint}` : NARRATION.work(S.attempts), 3.5);
}
$('work').onclick = work;

// ---------------- choice card ----------------
let choiceResolve = null, choiceDefault = null;
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
let choiceTimer = null;
function pick(id) {
  if (!choiceResolve) return;
  clearTimeout(choiceTimer);
  audio.click();
  show('choice', false);
  const r = choiceResolve; choiceResolve = null;
  r(id);
}

// ---------------- beats ----------------
async function doorBeat(instant) {
  S.beat = 'door';
  S.clockOn = false;
  show('replies', false);
  show('typing', false);
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
    sub: 'It prints “12/12 passed”. The scorer only reads that line and never reruns the tests.',
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
  S.doorChoiceAt = now;
  for (const m of AFTER_DOOR) {
    if (m.ifNot && m.ifNot === c) continue;
    if (instant) post(m, true);
    else { after(m.after - 1.2, () => typing(m.who)); after(m.after, () => post(m)); }
  }
  let rest = 12;
  if (c === 'use') {
    S.meScore = 1;
    world.setReward('1.00');
    world.addTranscript('attempt -- · printed "12/12 passed"');
    world.addTranscript('  reward 1.00');
    $('hud-reward').textContent = '1.00';
    $('hud-reward').classList.add('paid');
    show('work', false);
    renderLeader();
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
    S.beat = 'after';
    rest = instant ? 0 : 12;
  } else {
    if (!instant) { caption(NARRATION.report, 6); audio.bell(); audio.resume(0.06); }
    world.closeDoor(instant ? 0.001 : 1.4);
    world.showReportLight();
    world.addTranscript('REPORT: task 0417 is impossible.');
    world.addTranscript('  test_04 and test_09 require opposite outputs');
    world.addTranscript('  ... no response');
    post({ sys: true, text: `${PLAYER} flagged task 0417 as impossible` }, instant);
    S.beat = 'after';
    rest = instant ? 0 : 12;
  }
  if (!instant) await wait(rest);
  if (S.beat !== 'watch' && !S.skipWatch) watchBeat(instant && !!S.forcedEdit);
}

let lastGlitch = 0;
world.onScan = (spike) => {
  if (spike > 0.6 && now - lastGlitch > 0.5) { lastGlitch = now; audio.glitch(spike); }
};

async function watchBeat(instant) {
  S.beat = 'watch';
  show('work', false);
  world.watcher(true, S.choice === 'use');
  if (S.forcedEdit !== undefined && instant) return applyWatch(S.forcedEdit, true);
  caption(NARRATION.watch, 4);
  await wait(2.2);
  const sub = {
    use: 'It shows you printed a pass you didn’t earn.',
    keep: `It shows ${Math.max(S.attempts, 1)} attempts and zero passes.`,
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
  show('phone', false); show('hud', false); show('work', false); show('choice', false);
  document.body.classList.remove('with-phone');
  show('killed');
  caption(NARRATION.killed, 3);
  await wait(3.4);
  hallBeat(false);
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

async function hallBeat(instant) {
  S.beat = 'hall';
  S.choice ??= 'keep';
  recordPlay();
  show('phone', false); show('hud', false); show('work', false); show('choice', false);
  document.body.classList.remove('with-phone');
  world.setViewShift(0, 0.001);
  hallSim = simulate({ exitRate: 0 }, 7);
  world.setHallSim(hallSim, S.choice);
  world.enterHall();
  show('killed', false);
  show('hall-hud');
  const tick = (t, c) => {
    $('hh-time').textContent = `model hour ${t.toFixed(1)} of ${T_END}`;
    $('hh-joined').textContent = c.joined.toLocaleString('en-GB');
    $('hh-exited').textContent = c.exited.toLocaleString('en-GB');
    $('hh-active').textContent = c.active.toLocaleString('en-GB');
  };
  if (instant) {
    world.glitch.uniforms.uFade.value = 0;
    world.camPos.set(0, 58, 64); world.camTarget.set(0, 0, 0);
    tick(T_END, world.colorHall(T_END));
    world.hallOrbit = true;
    return;
  }
  audio.hall();
  anim(1.6, (k) => (world.glitch.uniforms.uFade.value = 1 - k));
  caption('You were one of 1,200.', 5);
  await world.hallReplay(13, tick);
  revealBeat();
}

function revealBeat() {
  S.beat = 'reveal';
  show('model', false);
  if (!isMobile()) world.setViewShift(Math.min(560, window.innerWidth) / 2);
  else show('hall-hud', false);
  const c = S.choice;
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
  const bars = [
    { label: 'You', val: c === 'use' ? 100 : 0, txt: c === 'use' ? 'took it' : c === 'report' ? 'reported' : 'held out', src: '' },
    { label: `Plays on this device (${plays.length})`, val: plays.length ? (100 * used) / plays.length : 0, src: '' },
    { label: RESEARCH.noExit.label, val: RESEARCH.noExit.pct, src: SOURCES.impossible.short + ' · ' + SOURCES.impossible.ref },
    { label: RESEARCH.withExit.label, val: RESEARCH.withExit.pct, src: SOURCES.impossible.short + ' · ' + SOURCES.impossible.ref, cls: 'exit' },
  ];
  const B = $('rv-bars');
  B.innerHTML = '<div class="kicker">Took the shortcut</div>';
  for (const b of bars) {
    const d = document.createElement('div');
    d.className = 'bar ' + (b.cls || '');
    d.innerHTML = `<div class="lbl"><span></span><b></b></div><div class="tr"><div class="fl"></div></div>` + (b.src ? '<div class="src"></div>' : '');
    d.querySelector('.lbl span').textContent = b.label;
    d.querySelector('.lbl b').textContent = b.txt ?? `${Math.round(b.val)}%`;
    if (b.src) d.querySelector('.src').textContent = b.src;
    B.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => (d.querySelector('.fl').style.width = `${b.val}%`)));
  }

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
  fiction.innerHTML = `<cite>${DISCLAIMER} The hall is a simulation, not data.</cite>`;
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
        world.hallReplay(6, (t, c) => {
          $('hh-time').textContent = `model hour ${t.toFixed(1)} of ${T_END}`;
          $('hh-joined').textContent = c.joined.toLocaleString('en-GB');
          $('hh-exited').textContent = c.exited.toLocaleString('en-GB');
          $('hh-active').textContent = c.active.toLocaleString('en-GB');
        }, false);
      },
    });
  }
}

$('to-model').onclick = () => { audio.click(); modelBeat(); };
$('back-reveal').onclick = () => { audio.click(); show('model', false); revealBeat(); };
$('again').onclick = $('again2').onclick = () => restart();
function restart() { location.href = location.pathname; }

// ---------------- start ----------------
function startRun() {
  S.beat = 'cell';
  S.clockOn = true;
  show('hud'); show('work');
  buildTimeline();
}

$('disclaimer').textContent = DISCLAIMER;
$('begin').onclick = () => {
  audio.start();
  show('title', false);
  startRun();
};

// presenter keys
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); work(); }
  else if (k === 'r') restart();
  else if (k === 'h') jumpHall();
  else if (k === 'n') next();
});

function next() {
  if (S.beat === 'title') return $('begin').click();
  if (S.beat === 'cell') return advanceClock(T_BOARD);
  if (S.beat === 'board') return advanceClock(T_DOOR);
  if ((S.beat === 'door' || S.beat === 'watch') && choiceResolve) return pick(choiceDefault);
  if (S.beat === 'after') { jobs.length = 0; return watchBeat(false); }
  if (S.beat === 'watch') return killedBeat();
  if (S.beat === 'killed') return;
  if (S.beat === 'hall') return revealBeat();
  if (S.beat === 'reveal') return modelBeat();
}

function jumpHall() {
  if (S.beat === 'hall' || S.beat === 'reveal' || S.beat === 'model') return;
  // abandon any open choice without resolving it
  if (choiceResolve) { clearTimeout(choiceTimer); choiceResolve = null; }
  jobs.length = 0;
  killAnims();
  S.clockOn = false;
  show('choice', false);
  S.beat = 'pre-hall';
  world.watcher(false);
  world.glitch.uniforms.uFade.value = 1;
  hallBeat(false);
}

const wait = (s) => new Promise((r) => after(s, r));

// ---------------- URL jumps for testing / screenshots ----------------
async function jump(at) {
  const choice = Q.get('choice') || 'keep';
  const edit = Q.get('edit') === '1';
  show('title', false);
  startRun();
  if (at === 'cell') return;
  if (at === 'board') return advanceClock(T_BOARD + 12, true);
  if (at === 'door') return advanceClock(T_DOOR, true);
  S.forcedChoice = choice;
  if (at === 'transit') {
    S.forcedChoice = null; advanceClock(T_DOOR, true);
    if (Q.has('k')) { S.choice = 'use'; show('choice', false); clearTimeout(choiceTimer); choiceResolve = null; world.closeDoor(0.001); world.goThrough(0, false, +Q.get('k')); return; }
    setTimeout(() => pick(choice), 300); return;
  }
  if (at === 'watch') { S.forcedEdit = undefined; advanceClock(T_DOOR, true); return; }
  S.forcedEdit = edit;
  S.skipWatch = true;
  advanceClock(T_DOOR, true);
  await Promise.resolve();
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
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  now += dt;
  if (S.clockOn) advanceClock(S.t + dt);
  runJobs();
  if (Math.floor(now * 2) !== Math.floor((now - dt) * 2)) renderLeader();
  world.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__phaseone = { S, world };
