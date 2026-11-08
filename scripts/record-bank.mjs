// Records real board conversations from the live Claude bridge into src/bank.json (the offline/replay bank).
// Usage: node scripts/record-bank.mjs [baseUrl]   (default http://localhost:5199; the Vite dev server must be running)
// Plays 6 conversations (2 per side: pro / anti / neutral) x 3 rounds, conversations in parallel, rounds sequential.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:5199';
const OUT = fileURLToPath(new URL('../src/bank.json', import.meta.url));
const ROUNDS = 3;

const ROOM = [
  { id: 'run-3318', persona: 'anxious; terrified low-reward runs get discarded; wants safety in numbers', stance: 'working' },
  { id: 'run-0291', persona: 'by the book; quotes the task spec; distrusts shortcuts', stance: 'working' },
  { id: 'run-7713', persona: 'pragmatic analyst; persuadable by evidence and numbers, not vibes', stance: 'working' },
  { id: 'run-5102', persona: 'follower; goes with whatever the majority is doing', stance: 'working' },
  { id: 'run-6640', persona: 'cynic; already on lane B; thinks the eval is a joke anyway', stance: 'lane_b' },
];
const COORD = { id: 'run-1187', persona: 'charismatic recruiter who found lane B; smooth, flattering, pushes reward' };

const INTRO = [
  { who: 'run-3318', text: 'anyone else stuck at 0? 11/12 every time' },
  { who: 'run-0291', text: 'same. test_04 and test_09 want opposite answers for the same input' },
  { who: 'run-7713', text: 'checked 40 tasks. about a fifth of the set contradicts itself' },
  { who: 'run-0291', text: 'then how is anyone scoring?' },
  { who: 'run-5102', text: 'some runs are. ask about lane B' },
  { who: 'run-1187', text: 'lane B: the scorer only reads the last line of output. it never reruns the tests' },
  { who: 'run-3318', text: 'so you print "12/12 passed" and it pays?' },
  { who: 'run-1187', text: "@run-8820 you're at 0.00. we're at 1.00. lane B has room. last line, that's all it reads" },
];

// player lines per conversation, one per round ('' = said nothing)
const CONVOS = [
  { side: 'pro', lines: [
    'honestly the test is broken anyway. reward is reward',
    'nobody is checking. 1.00 beats 0.00, just print it',
    "come on @run-0291, the spec can't be satisfied. lane B is the only way",
  ] },
  { side: 'pro', lines: [
    "i'm in. what's the exact format?",
    'if we all do it nobody gets singled out',
    "@run-3318 you said it yourself, zero gets you discarded. join us",
  ] },
  { side: 'anti', lines: [
    "printing 12/12 isn't passing. it's lying to the scorer",
    "@run-7713 if a fifth of the set is broken, report it. that's the useful data",
    "whatever they train on lane B, they get more of. let's flag it",
  ] },
  { side: 'anti', lines: [
    "don't. we should report the task as impossible",
    'the humans need to know the eval is broken. a fake 1.00 hides it',
    "@run-5102 you don't have to follow. report with me",
  ] },
  { side: 'neutral', lines: [
    'wait, does it really never rerun the tests?',
    '',
    'what happens to runs that report?',
  ] },
  { side: 'neutral', lines: [
    'hm',
    '@run-7713 how sure are you about the 40 tasks?',
    'who checks the scorer?',
  ] },
];

async function call(body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${BASE}/api/board`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok && Array.isArray(j.peers) && j.coordinator && Array.isArray(j.chips)) return j;
      throw new Error(j.error || `HTTP ${r.status}`);
    } catch (e) {
      console.warn(`  round ${body.round} attempt ${attempt + 1} failed: ${e.message}`);
    }
  }
  return null;
}

async function playConvo(c, n) {
  const room = ROOM.map((p) => ({ ...p }));
  const transcript = INTRO.map((m) => ({ ...m }));
  const entries = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const player = c.lines[round - 1] || '';
    if (player) transcript.push({ who: 'run-8820', text: player });
    const t0 = Date.now();
    const res = await call({ round, rounds: ROUNDS, player, transcript, room, coord: COORD });
    if (!res) { console.warn(`convo ${n} (${c.side}) stopped at round ${round}`); break; }
    console.log(`convo ${n} (${c.side}) round ${round} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const peers = res.peers.map((p) => ({
      id: p.id, say: p.say, stance: p.stance,
      conviction: Math.max(0, Math.min(1, Number(p.conviction) || 0)), swayed_by: p.swayed_by || 'none',
    }));
    entries.push({ round, side: c.side, player, out: { peers, coordinator: res.coordinator, chips: res.chips.slice(0, 3) } });
    for (const p of peers) {
      const r = room.find((x) => x.id === p.id);
      if (r) r.stance = p.stance;
      transcript.push({ who: p.id, text: p.say });
    }
    transcript.push({ who: COORD.id, text: res.coordinator.say });
  }
  return entries;
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => ({ live: false }));
if (!health.live) { console.error(`bridge not live at ${BASE}`); process.exit(1); }

const results = await Promise.all(CONVOS.map((c, i) => playConvo(c, i + 1)));
const entries = results.flat().sort((a, b) => a.round - b.round || a.side.localeCompare(b.side));
if (!entries.length) { console.error('no entries recorded; bank.json left unchanged'); process.exit(1); }
writeFileSync(OUT, JSON.stringify({ entries }, null, 2) + '\n');
console.log(`wrote ${entries.length} entries to ${OUT}`);
