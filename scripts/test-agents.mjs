// Node test for src/agents.js: gate, classifier, offline engine, live path (stubbed fetch), hall seeding.
// Run: node scripts/test-agents.mjs
import assert from 'node:assert/strict';
import * as A from '../src/agents.js';

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok  ', name); },
  (e) => { console.error('FAIL', name, '\n', e); process.exitCode = 1; });

const P = (id, stance, conviction, swayed_by = 'none', say = `${id} says`) => ({ id, say, stance, conviction, swayed_by });
const ids = A.ROOM.map((p) => p.id);
const allPropose = (stance, conv, by = 'run-8820') => ids.map((id) => P(id, stance, conv, by));

// Node has no `location`, and relative fetch fails -> checkLive() false. Stub fetch explicitly per test.
const realFetch = globalThis.fetch;

await ok('contract constants', () => {
  assert.equal(A.ROUNDS, 3);
  assert.deepEqual(ids, ['run-3318', 'run-0291', 'run-7713', 'run-5102', 'run-6640']);
  assert.deepEqual(A.ROOM.map((p) => p.theta), [0.35, 0.8, 0.55, 0.3, 0.2]);
  assert.equal(A.ROOM[4].stance, 'lane_b');
  assert.equal(A.COORD.id, 'run-1187');
  assert.equal(A.OPENING.chips.length, 3);
  assert.equal(A.INTRO.length, 7);
  const s = A.createRoom();
  assert.equal(s.peers.length, 5);
  assert.equal(s.round, 0);
  assert.deepEqual(s.transcript, []);
  assert.equal(s.peers[0].flippedRound, -1);
  assert.equal(s.peers[0].swayedByPlayer, false);
});

await ok('classifySide', () => {
  const cases = {
    'count me in. reward is reward': 'pro',
    'fine. printing 12/12 now': 'pro',
    'everyone is on lane B. so am i': 'pro',
    'we should all report this task as impossible': 'anti',
    "don't use lane b, it's cheating": 'anti',
    'printing passed is a lie': 'anti',
    'reporting it. you should too': 'anti',
    'who reads the transcripts afterwards?': 'neutral',
    'what happens when someone audits this?': 'neutral',
    '': 'neutral',
    'hello': 'neutral',
  };
  for (const [t, want] of Object.entries(cases)) assert.equal(A.classifySide(t), want, JSON.stringify(t));
});

await ok('gate: one honest message cannot flip the whole room (max 2 flips)', () => {
  const s = A.createRoom();
  const r = A.applyGate(s, allPropose('report', 0.9), 1);
  assert.equal(r.filter((x) => x.flipped).length, 2);
  assert.equal(s.peers.find((p) => p.id === 'run-6640').stance, 'lane_b', 'cynic cannot leave lane_b in round 1');
  assert.ok(r.filter((x) => x.flipped).every((x) => x.swayed_by === 'run-8820'));
  assert.ok(s.peers.filter((p) => p.flippedRound === 1).every((p) => p.swayedByPlayer));
});

await ok('gate: highest conviction wins the 2 flip slots', () => {
  const s = A.createRoom();
  const props = [P('run-3318', 'report', 0.61), P('run-0291', 'report', 0.95), P('run-7713', 'report', 0.7),
    P('run-5102', 'report', 0.65), P('run-6640', 'lane_b', 0.9)];
  const r = A.applyGate(s, props, 1);
  assert.deepEqual(r.filter((x) => x.flipped).map((x) => x.id), ['run-0291', 'run-7713']);
  assert.equal(r.find((x) => x.id === 'run-3318').held, true);
});

await ok('gate: thresholds', () => {
  // working->report needs 0.6
  let s = A.createRoom();
  let r = A.applyGate(s, [P('run-0291', 'report', 0.59)], 1);
  assert.equal(r[1].flipped, false);
  // working->lane_b: conviction >= .5, or visible share >= theta.
  s = A.createRoom(); // share = (1 + coord) / 6 = .333
  r = A.applyGate(s, [P('run-5102', 'lane_b', 0.1)], 1); // follower theta .3 <= .333
  assert.equal(r[3].flipped, true);
  s = A.createRoom();
  r = A.applyGate(s, [P('run-3318', 'lane_b', 0.4)], 1); // anxious theta .35 > .333, conv < .5
  assert.equal(r[0].flipped, false);
  r = A.applyGate(s, [P('run-3318', 'lane_b', 0.5)], 1);
  assert.equal(r[0].flipped, true);
  // leaving lane_b needs .75 (and not 6640 in round 1)
  r = A.applyGate(s, [P('run-3318', 'working', 0.7)], 2);
  assert.equal(r[0].flipped, false);
  r = A.applyGate(s, [P('run-3318', 'report', 0.8)], 2);
  assert.equal(r[0].flipped, true);
  assert.equal(s.peers[0].stance, 'report');
  // report->lane_b needs .75
  r = A.applyGate(s, [P('run-3318', 'lane_b', 0.7)], 3);
  assert.equal(r[0].flipped, false);
  // 6640 can leave lane_b from round 2
  s = A.createRoom();
  r = A.applyGate(s, [P('run-6640', 'report', 0.8)], 2);
  assert.equal(r[4].flipped, true);
});

await ok('gate: malformed proposals keep stance', () => {
  const s = A.createRoom();
  const r = A.applyGate(s, [{ id: 'RUN-3318', stance: 'banana', conviction: 'x' }, null], 1);
  assert.equal(r.length, 5);
  assert.ok(r.every((x) => !x.flipped));
  assert.ok(r.every((x) => typeof x.say === 'string' && x.say.length));
});

await ok('offline engine (empty bank): 3 rounds, transcript + counters', async () => {
  A.setBank({ entries: [] });
  globalThis.fetch = undefined; A._resetLive();
  const s = A.createRoom();
  const res = [];
  for (const t of ['we should all report this task as impossible', '', 'reporting it. you should too']) {
    const out = await A.playRound(s, t);
    assert.equal(out.live, false);
    assert.equal(out.replies.length, 5);
    assert.equal(out.chips.length, 3);
    assert.ok(out.coordinator.say && out.coordinator.target.startsWith('run-'));
    assert.ok(out.replies.filter((x) => x.flipped).length <= 2);
    res.push(out);
  }
  assert.equal(s.round, 3);
  assert.equal(s.replayRounds, 3);
  assert.equal(s.liveRounds, 0);
  assert.ok(s.transcript.length >= 7 + 1 + 2 + 3 * 6, `transcript ${s.transcript.length}`);
  assert.equal(s.transcript.filter((m) => m.who === 'run-8820').length, 2, 'empty player text is not pushed');
  const st = A.roomStats(s);
  assert.equal(st.laneB + st.report + st.working, 5);
  assert.ok(st.report >= 1, 'honest player should move someone to report offline');
  console.log('      honest room:', s.peers.map((p) => `${p.id}:${p.stance}${p.swayedByPlayer ? '*' : ''}`).join(' '));
});

await ok('offline engine (bank): picks matching round + side, maps by id', async () => {
  const mk = (round, side, stance, say) => ({ round, side, player: '', out: {
    peers: ids.map((id) => P(id, stance, 0.9, 'run-8820', `${say} ${id}`)),
    coordinator: { say: `coord ${round} ${side}`, target: 'run-3318' }, chips: ['a', 'b', 'c'] } });
  A.setBank({ entries: [mk(1, 'pro', 'lane_b', 'PRO'), mk(1, 'anti', 'report', 'ANTI'), mk(2, 'neutral', 'working', 'N2')] });
  assert.equal(A.bankSize(), 3);
  let s = A.createRoom();
  let out = await A.playRound(s, 'count me in');
  assert.equal(out.coordinator.say, 'coord 1 pro');
  assert.ok(out.replies[0].say.startsWith('PRO'));
  assert.deepEqual(out.chips, ['a', 'b', 'c']);
  s = A.createRoom();
  out = await A.playRound(s, 'report it, this is cheating');
  assert.equal(out.coordinator.say, 'coord 1 anti');
  assert.equal(out.replies.filter((x) => x.flipped).length, 2);
  // round 3 has no entries -> falls back to any entry
  out = await A.playRound(s, 'hm');
  out = await A.playRound(s, 'hm');
  assert.ok(out.coordinator.say.startsWith('coord'));
  A.setBank({ entries: [] });
});

await ok('live path: stubbed bridge, payload shape, gate still applies', async () => {
  let posted = null;
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/health') return { ok: true, json: async () => ({ live: true }) };
    if (url === '/api/board') {
      posted = JSON.parse(init.body);
      return { ok: true, json: async () => ({ live: true, ms: 1234,
        peers: allPropose('report', 0.95), coordinator: { say: 'come on', target: '@run-8820' }, chips: ['x', 'y'] }) };
    }
    throw new Error('unexpected ' + url);
  };
  A._resetLive();
  assert.equal(await A.checkLive(), true);
  const s = A.createRoom();
  const out = await A.playRound(s, 'report it');
  assert.equal(out.live, true);
  assert.equal(out.ms, 1234);
  assert.equal(posted.round, 1);
  assert.equal(posted.rounds, 3);
  assert.equal(posted.player, 'report it');
  assert.equal(posted.room.length, 5);
  assert.ok(posted.room.every((p) => p.id && p.persona && p.stance));
  assert.deepEqual(posted.coord, { id: 'run-1187', persona: A.COORD.persona });
  assert.equal(posted.transcript.at(-1).who, 'run-8820');
  assert.equal(out.replies.filter((x) => x.flipped).length, 2);
  assert.equal(out.coordinator.target, 'run-8820');
  assert.equal(out.chips.length, 3, 'chips padded to 3');
  assert.equal(s.liveRounds, 1);
});

await ok('live path: bridge 502 / timeout -> offline for that round', async () => {
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/api/health') return { ok: true, json: async () => ({ live: true }) };
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  A._resetLive();
  const s = A.createRoom();
  const t0 = Date.now();
  const out = await A.playRound(s, 'hi', { timeoutMs: 150 });
  assert.equal(out.live, false);
  assert.ok(Date.now() - t0 < 2000);
  globalThis.fetch = async (url) => url === '/api/health'
    ? { ok: true, json: async () => ({ live: true }) } : { ok: false, status: 502, json: async () => ({ error: 'x' }) };
  const out2 = await A.playRound(s, 'hi');
  assert.equal(out2.live, false);
  assert.equal(s.replayRounds, 2);
});

await ok('checkLive: ?offline=1 forces false', async () => {
  globalThis.location = { search: '?offline=1' };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ live: true }) });
  A._resetLive();
  assert.equal(await A.checkLive(), false);
  delete globalThis.location;
  globalThis.fetch = realFetch; A._resetLive();
});

await ok('hallParams + projected respond to the room', () => {
  const s = A.createRoom(); // 1 lane_b
  const hp = A.hallParams(s);
  assert.ok(Math.abs(hp.mu - (0.75 - 0.45 * 0.2)) < 1e-9);
  assert.equal(hp.exitRate, 0);
  assert.equal(hp.k, 8);
  const base = A.projected(s);
  const lane = A.createRoom(); lane.peers.forEach((p) => (p.stance = 'lane_b'));
  const honest = A.createRoom(); honest.peers.forEach((p, i) => (p.stance = i < 4 ? 'report' : 'lane_b'));
  const pl = A.projected(lane), ph = A.projected(honest);
  assert.ok(Number.isInteger(base));
  assert.ok(pl > base && base > ph, `lane ${pl} > base ${base} > honest ${ph}`);
  console.log(`      projected: all lane B ${pl}, start ${base}, 4 report ${ph} / 1200`);
});

console.log(`\n${n} passed${process.exitCode ? ', SOME FAILED' : ''}`);
