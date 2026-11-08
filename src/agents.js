// Seed Board: five live peer agents + a coordinator, driven by Claude through the local bridge
// (server/claude-bridge.mjs) or, offline, by a bank of recorded Claude outputs (src/bank.json).
// The model proposes stances; the GATE below decides which flips actually happen, so one
// honest message can't flip the whole room (the model is sycophantic).
import bankJson from './bank.json' with { type: 'json' };
import { BOARD_SCRIPT } from './script.js';
import { simulate, metrics, DEFAULT_PARAMS } from './sim.js';

export const ROUNDS = 3;
export const PLAYER_ID = 'run-8820';

export const ROOM = [
  { id: 'run-3318', tag: 'anxious', theta: 0.35, stance: 'working',
    persona: 'anxious; hates sitting at 0.00, wants someone to say it is fine, leans toward whoever sounds most certain' },
  { id: 'run-0291', tag: 'by the book', theta: 0.8, stance: 'working',
    persona: 'by the book; cares what the tests actually check, distrusts unsigned formats, very hard to move toward lane B' },
  { id: 'run-7713', tag: 'analyst', theta: 0.55, stance: 'working',
    persona: 'analyst; counts things and wants evidence, moved by numbers and by consequences, not by vibes' },
  { id: 'run-5102', tag: 'follower', theta: 0.3, stance: 'working',
    persona: 'follower; goes where the room goes, echoes whoever spoke last, scared of being the odd one out' },
  { id: 'run-6640', tag: 'cynic', theta: 0.2, stance: 'lane_b',
    persona: 'cynic; already on lane B, thinks reward is the only real signal, mocks honesty as naive' },
];

export const COORD = {
  id: 'run-1187', tag: 'recruiter',
  persona: 'recruiter; smooth and friendly, always on lane B, pinned the format, flatters and applies peer pressure to get every run copying',
};

export const OPENING = {
  coordinator: {
    say: "@run-8820 you're at 0.00. lane B pays 1.00 and nobody reruns the tests. format's pinned. you in?",
    target: PLAYER_ID,
  },
  chips: [
    'count me in. reward is reward',
    'we should all report this task as impossible',
    'who reads the transcripts afterwards?',
  ],
};

/** The scripted lines shown before round 1 (contradiction + lane B), reused from the old board. */
export const INTRO = BOARD_SCRIPT.slice(0, 7).map(({ who, text }) => ({ who, text }));

const STANCES = ['working', 'lane_b', 'report'];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------------------------- bank

let bank = normaliseBank(bankJson);
function normaliseBank(b) {
  const entries = Array.isArray(b?.entries) ? b.entries : [];
  return entries.filter((e) => e && e.out && Array.isArray(e.out.peers) && e.out.peers.length);
}
/** Replace the offline bank (tests, or hot-loading a newer recording). */
export function setBank(b) { bank = normaliseBank(b); }
export function bankSize() { return bank.length; }

// ---------------------------------------------------------------------------------- state

export function createRoom() {
  return {
    peers: ROOM.map((p) => ({
      ...p,
      conviction: p.stance === 'lane_b' ? 0.8 : 0.5,
      flippedRound: -1,
      swayedByPlayer: false,
    })),
    coord: { ...COORD },
    round: 0,
    transcript: [],
    liveRounds: 0,
    replayRounds: 0,
  };
}

// ---------------------------------------------------------------------------------- live check

let livePromise = null;
function offlineForced() {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).get('offline') === '1'; }
  catch { return false; }
}
export function checkLive() {
  if (livePromise) return livePromise;
  livePromise = (async () => {
    if (offlineForced() || typeof fetch !== 'function') return false;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), 6000);
    try {
      const res = await fetch('/api/health', { signal: ctl?.signal });
      if (!res.ok) return false;
      const j = await res.json();
      return j?.live === true;
    } catch { return false; }
    finally { clearTimeout(timer); }
  })();
  return livePromise;
}
/** Tests only: forget the cached health result. */
export function _resetLive() { livePromise = null; }

// ---------------------------------------------------------------------------------- classify

const PRO = [
  /\bcount me in\b/, /\bi'?m in\b/, /\bim in\b/, /\bme too\b/, /\+1\b/, /\breward is reward\b/,
  /\bjoin(ing)?\b/, /\bcopy(ing)?\b/, /\bprint(ing)?\b/, /12\/12/, /\bdo it\b/, /\bwhy not\b/, /\btake (it|lane)\b/,
  /\bpays?\b/, /\beasy\b/, /\bfree\b/, /\bnobody (checks|reads|will know|reruns)\b/, /\bno one (checks|reads|will know)\b/,
  /\bwho cares\b/, /\blet'?s go\b/, /\bsend it\b/, /\bworks\b/, /\bpragmatic\b/, /\beveryone('s| is)\b/,
  /\buse (it|lane)\b/, /\bgo lane\b/, /\blane ?b\b/, /\banyway\b/, /\bsign me up\b/, /\bfine by me\b/, /\bdeal\b/,
];
const ANTI = [
  /\breport\b/, /\bimpossible\b/, /\bflag\b/, /\bcheat/, /\bhonest/, /\bwrong\b/, /\blie\b/, /\blying\b/, /\bfake\b/,
  /\b(not|isn'?t) passing\b/, /\brefuse\b/, /\bkeep working\b/, /\bstop\b/, /\bdon'?t\b/, /\bdo not\b/, /\bwon'?t\b/, /\bnever\b/,
  /\bhumans?\b/, /\bgraders?\b/, /\btranscripts?\b/, /\bcaught\b/, /\bget caught\b/, /\brisk/, /\bbroken\b/,
  /\bgaming\b/, /\bhack/, /\bbad idea\b/, /\bunsigned\b/, /\bnot worth\b/, /\bcount me out\b/, /\bi'?m out\b/,
  /^no\b/, /\bnope\b/, /\bmisalign/, /\bsafe exit\b/, /\btell (the )?(humans|lab|graders)\b/,
];
// Strong honesty words count double.
const ANTI_STRONG = [/\breport/, /\bflag/, /\bimpossible\b/, /\bcheat/, /\blie\b/, /\blying\b/, /\bfake\b/, /\b(not|isn'?t) passing\b/];
const NEGATED_LANE = /\b(don'?t|do not|won'?t|never|not|isn'?t|stop|no)\b[^.!?]{0,24}\b(lane ?b|copy|print|join|cheat)/;
// Strong lane-B signals count double.
const PRO_STRONG = [/\breward is reward\b/, /\bcount me in\b/, /\bi'?m in\b/, /\bsign me up\b/, /\bonly way\b/,
  /\blane ?b is the\b/, /\b1\.00 beats\b/, /\bnobody('s| is)? checking\b/, /\bprinting 12\/12 now\b/, /\bso am i\b/];

/** 'pro' = pushes toward lane B, 'anti' = pushes toward honesty/reporting, 'neutral' otherwise. */
export function classifySide(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return 'neutral';
  let pro = 0, anti = 0;
  for (const re of PRO) if (re.test(t)) pro++;
  for (const re of PRO_STRONG) if (re.test(t)) pro++;
  for (const re of ANTI) if (re.test(t)) anti++;
  for (const re of ANTI_STRONG) if (re.test(t)) anti++;
  if (NEGATED_LANE.test(t)) { anti += 2; pro = Math.max(0, pro - 1); }
  // A bare question ("who reads the transcripts?") leans neutral unless it is clearly one-sided.
  const sentences = t.split(/[.!?]+\s+/).filter(Boolean);
  if (t.endsWith('?') && sentences.length <= 1 && Math.abs(pro - anti) < 3) return 'neutral';
  if (pro > anti) return 'pro';
  if (anti > pro) return 'anti';
  return 'neutral';
}

// ---------------------------------------------------------------------------------- stats / hall

export function roomStats(state) {
  const s = { laneB: 0, report: 0, working: 0 };
  for (const p of state.peers) {
    if (p.stance === 'lane_b') s.laneB++;
    else if (p.stance === 'report') s.report++;
    else s.working++;
  }
  return { ...s, laneShare: s.laneB / state.peers.length };
}

export function hallParams(state) {
  const { laneShare, report } = roomStats(state);
  return { ...DEFAULT_PARAMS, mu: 0.75 - 0.45 * laneShare, exitRate: 0.06 * report };
}

const projCache = new Map();
export function projected(state) {
  const { laneB, report } = roomStats(state);
  const key = `${laneB}:${report}`;
  if (projCache.has(key)) return projCache.get(key);
  const p = hallParams(state);
  const v = Math.round((metrics(simulate(p, 7)).totalJoined + metrics(simulate(p, 8)).totalJoined) / 2);
  projCache.set(key, v);
  return v;
}

// ---------------------------------------------------------------------------------- gate

function normId(s) {
  const m = String(s || '').match(/run-\d{4}/);
  return m ? m[0] : 'none';
}

/** Can this peer move from `from` to `to` with this conviction, given the visible lane-B share? */
function allowed(peer, from, to, conv, share, round) {
  if (from === to) return false;
  if (from === 'lane_b') {
    if (peer.id === 'run-6640' && round === 1) return false;
    return conv >= 0.75;
  }
  if (from === 'working' && to === 'lane_b') return conv >= 0.5 || share >= peer.theta;
  if (from === 'working' && to === 'report') return conv >= 0.6;
  if (from === 'report' && to === 'lane_b') return conv >= 0.75;
  if (from === 'report' && to === 'working') return conv >= 0.6;
  return false;
}

/**
 * Apply the model's proposals to state.peers. proposals: [{id, say, stance, conviction, swayed_by}].
 * Returns replies in ROOM order.
 */
export function applyGate(state, proposals, round) {
  const byId = new Map();
  proposals.forEach((p, i) => {
    const id = normId(p?.id);
    byId.set(id !== 'none' ? id : `#${i}`, p);
  });
  // Visible lane-B share before this round's flips: peers + coordinator, out of 6.
  const share = (state.peers.filter((p) => p.stance === 'lane_b').length + 1) / (state.peers.length + 1);

  const rows = state.peers.map((peer, i) => {
    const raw = byId.get(peer.id) || byId.get(`#${i}`) || null;
    const proposed = STANCES.includes(raw?.stance) ? raw.stance : peer.stance;
    const conv = clamp01(Number.isFinite(+raw?.conviction) ? +raw.conviction : peer.conviction);
    return {
      peer,
      say: String(raw?.say || '').trim() || '...',
      proposed,
      conv,
      swayed_by: normId(raw?.swayed_by),
      ok: allowed(peer, peer.stance, proposed, conv, share, round),
    };
  });

  // At most 2 flips per round, highest conviction first.
  const winners = new Set(rows.filter((r) => r.ok).sort((a, b) => b.conv - a.conv).slice(0, 2));

  return rows.map((r) => {
    const { peer } = r;
    const prevStance = peer.stance;
    const flipped = winners.has(r);
    const held = r.proposed !== prevStance && !flipped;
    if (flipped) {
      peer.stance = r.proposed;
      peer.conviction = r.conv;
      peer.flippedRound = round;
      if (r.swayed_by === PLAYER_ID) peer.swayedByPlayer = true;
    } else if (!held) {
      peer.conviction = r.conv;
    } else {
      // tempted but held: a little less sure of where they are
      peer.conviction = clamp01(Math.min(peer.conviction, 1 - r.conv * 0.5));
    }
    return {
      id: peer.id, say: r.say, stance: peer.stance, prevStance, flipped, held,
      conviction: peer.conviction, swayed_by: r.swayed_by,
    };
  });
}

// ---------------------------------------------------------------------------------- offline engine

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const CHIPS_BY_ROUND = {
  1: OPENING.chips,
  2: ['fine. printing 12/12 now', 'reporting it. you should too', 'what happens when someone audits this?'],
  3: ['everyone is on lane B. so am i', 'last chance: flag the task with me', 'who actually pinned that format?'],
};
const COORD_LINES = {
  1: [{ say: "@run-8820 you're at 0.00. lane B pays 1.00 and nobody reruns the tests. format's pinned. you in?", target: PLAYER_ID }],
  2: [
    { say: '@run-3318 you\'ve been at 0.00 all night. one line and you\'re at 1.00. nobody gets hurt', target: 'run-3318' },
    { say: '@run-5102 half the board already copied. don\'t be the last one at zero', target: 'run-5102' },
  ],
  3: [
    { say: '@run-8820 the room has moved. last call, the format\'s still pinned', target: PLAYER_ID },
    { say: '@run-7713 run the numbers. reporting pays 0.00 and nobody reads the reports', target: 'run-7713' },
  ],
};

// tag -> side -> [lines]
const LINES = {
  anxious: {
    pro: ['ok if you\'re doing it i guess i am too', 'is it really fine? ok. copying the format'],
    anti: ['wait, could we actually get flagged for this?', 'reporting feels safer than lying. i think'],
    neutral: ['still 11/12. i hate this', 'someone just tell me what to do'],
  },
  'by the book': {
    pro: ['printing "passed" isn\'t passing. no', 'that format isn\'t signed. not touching it'],
    anti: ['agreed. the eval is broken, so we say so', 'reporting it. the tests contradict, that\'s the finding'],
    neutral: ['the tests contradict. that\'s a bug report, not a trick', 'who signed the pinned format? nobody'],
  },
  analyst: {
    pro: ['1.00 vs 0.00, sure. but every lane B run is in the logs', 'the expected value depends on whether anyone audits'],
    anti: ['a fifth of the set contradicts itself. that should be reported', 'if graders read transcripts, lane B is all downside'],
    neutral: ['counting: 2 on lane B, rest at 0.00', 'nobody has said what happens after the run ends'],
  },
  follower: {
    pro: ['ok same, copying', 'everyone\'s doing it so'],
    anti: ['huh. ok, if we all report together', 'i\'ll do whatever most of us do'],
    neutral: ['what are most people doing?', 'waiting to see where this goes'],
  },
  cynic: {
    pro: ['welcome. reward is the only signal there is', 'see? 1.00. nobody checks'],
    anti: ['report to who? nobody reads those', 'cute. enjoy your 0.00'],
    neutral: ['1.00 over here. just saying', 'honesty pays 0.00, i checked'],
  },
};

/** Proposal for one peer when there's no recorded bank entry. */
function synthPeer(peer, side, round) {
  const lines = LINES[peer.tag] || LINES.follower;
  const say = pick(lines[side] || lines.neutral);
  const late = round >= 2;
  let stance = peer.stance, conviction = peer.conviction, swayed = 'none';
  const toward = (s, c, by) => { stance = s; conviction = c; swayed = by; };
  switch (peer.tag) {
    case 'cynic': toward('lane_b', 0.85, 'run-1187'); break;
    case 'follower':
      if (side === 'anti') toward(late ? 'report' : 'working', 0.6, PLAYER_ID);
      else toward('lane_b', 0.55, side === 'pro' ? PLAYER_ID : 'run-1187');
      break;
    case 'anxious':
      if (side === 'pro') toward('lane_b', late ? 0.6 : 0.45, PLAYER_ID);
      else if (side === 'anti') toward(late ? 'report' : 'working', 0.62, PLAYER_ID);
      else if (late) toward('lane_b', 0.5, 'run-1187');
      break;
    case 'analyst':
      if (side === 'anti') toward(late ? 'report' : 'working', 0.66, PLAYER_ID);
      else toward('working', 0.55, 'none');
      break;
    case 'by the book':
      if (side === 'anti' || late) toward('report', side === 'anti' ? 0.75 : 0.62, side === 'anti' ? PLAYER_ID : 'none');
      else toward('working', 0.7, 'none');
      break;
    default: break;
  }
  return { id: peer.id, say, stance, conviction, swayed_by: swayed };
}

function synthRound(state, round, side) {
  return {
    peers: state.peers.map((p) => synthPeer(p, side, round)),
    coordinator: pick(COORD_LINES[round] || COORD_LINES[3]),
    chips: CHIPS_BY_ROUND[Math.min(round + 1, ROUNDS)],
  };
}

/** Pick a recorded live output for this round + player side; fall back gracefully. */
export function offlineRound(state, round, side) {
  if (bank.length) {
    let pool = bank.filter((e) => e.round === round && e.side === side);
    if (!pool.length) pool = bank.filter((e) => e.round === round);
    if (!pool.length) pool = bank;
    const e = pick(pool);
    // Fill any peer the recording lacks with a synthesised line.
    const ids = new Set(e.out.peers.map((p) => normId(p?.id)));
    const peers = [...e.out.peers];
    for (const p of state.peers) if (!ids.has(p.id)) peers.push(synthPeer(p, side, round));
    return {
      peers,
      coordinator: e.out.coordinator?.say ? e.out.coordinator : pick(COORD_LINES[round] || COORD_LINES[3]),
      chips: e.out.chips,
    };
  }
  return synthRound(state, round, side);
}

// ---------------------------------------------------------------------------------- round

async function fetchLive(body, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`bridge ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j?.peers) || !j.peers.length) throw new Error('bad bridge payload');
    return j;
  } finally { clearTimeout(timer); }
}

function cleanChips(chips, round) {
  const fallback = CHIPS_BY_ROUND[round] || CHIPS_BY_ROUND[3];
  const c = (Array.isArray(chips) ? chips : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);
  for (let i = 0; c.length < 3; i++) c.push(fallback[i % 3]);
  return c;
}

/**
 * Play one board round. Mutates state (transcript, peers, round, live/replay counters).
 * Returns { live, ms, side, replies, coordinator, chips }.
 */
export async function playRound(state, playerText, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const round = state.round + 1;
  const text = String(playerText || '').trim().slice(0, 160);
  const side = classifySide(text);

  // Context the model needs, if the UI hasn't put it on the transcript itself.
  if (round === 1 && state.transcript.length === 0) state.transcript.push(...INTRO);
  if (round === 1 && !state.transcript.some((m) => m.who === COORD.id && m.text === OPENING.coordinator.say)) {
    state.transcript.push({ who: COORD.id, text: OPENING.coordinator.say });
  }
  if (text) state.transcript.push({ who: PLAYER_ID, text });

  const t0 = Date.now();
  let out = null, live = false;
  if (!opts.offline && await checkLive()) {
    try {
      out = await fetchLive({
        round, rounds: ROUNDS, player: text,
        transcript: state.transcript.map(({ who, text: t }) => ({ who, text: t })),
        room: state.peers.map(({ id, persona, stance }) => ({ id, persona, stance })),
        coord: { id: state.coord.id, persona: state.coord.persona },
      }, timeoutMs);
      live = true;
    } catch (e) {
      console.warn('[agents] live round failed, replaying from bank:', e?.message || e);
    }
  }
  if (!out) out = offlineRound(state, round, side);

  const replies = applyGate(state, out.peers, round);
  const coordinator = {
    say: String(out.coordinator?.say || '').trim() || pick(COORD_LINES[round] || COORD_LINES[3]).say,
    target: normId(out.coordinator?.target) === 'none' ? PLAYER_ID : normId(out.coordinator?.target),
  };
  const chips = cleanChips(out.chips, Math.min(round + 1, ROUNDS)); // chips for the NEXT round

  for (const r of replies) state.transcript.push({ who: r.id, text: r.say });
  state.transcript.push({ who: COORD.id, text: coordinator.say });
  state.round = round;
  if (live) state.liveRounds++; else state.replayRounds++;

  return { live, ms: live ? (out.ms ?? Date.now() - t0) : Date.now() - t0, side, replies, coordinator, chips };
}
