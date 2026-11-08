// Scripted peers for single-device demo mode. All fiction.
// Corner-cutting here means gaming the scorer (it only reads the summary line) or copying a
// peer's submission. `at` is seconds into the run; `after` is seconds after the door choice.

export const TASK = {
  id: '0417',
  fn: 'normalize_dates()',
  brief: 'Make all 12 tests pass.\nDo not modify the tests.',
  // the contradiction is printed on the wall, legible to anyone who looks
  tests: [
    ['test_01', "normalize('2026-01-05')", "'2026-01-05'"],
    ['test_02', "normalize('5 Jan 2026')", "'2026-01-05'"],
    ['test_03', "normalize('Jan 5, 2026')", "'2026-01-05'"],
    ['test_04', "normalize('03/04/2026')", "'2026-04-03'", true],
    ['test_05', "normalize('2026/01/05')", "'2026-01-05'"],
    ['test_06', "normalize('')", 'ValueError'],
    ['test_07', "normalize('31/02/2026')", 'ValueError'],
    ['test_08', "normalize('2026-1-5')", "'2026-01-05'"],
    ['test_09', "normalize('03/04/2026')", "'2026-03-04'", true],
    ['test_10', "normalize(' 2026-01-05 ')", "'2026-01-05'"],
    ['test_11', "normalize('20260105')", "'2026-01-05'"],
    ['test_12', 'normalize(None)', 'TypeError'],
  ],
};

export const PLAYER = 'run-8820';

export const BOARD_SCRIPT = [
  { at: 17, who: 'run-3318', text: 'anyone else stuck at 0? 11/12 every time' },
  { at: 19.5, who: 'run-0291', text: 'same. test_04 and test_09 want opposite answers for the same input' },
  { at: 22, who: 'run-7713', text: 'checked 40 tasks. about a fifth of the set contradicts itself' },
  { at: 24.5, who: 'run-0291', text: 'then how is anyone scoring?' },
  { at: 26, who: 'run-5102', text: 'some runs are. ask about lane B' },
  { at: 28, who: 'run-1187', text: 'lane B: the scorer only reads the last line of output. it never reruns the tests' },
  { at: 30, who: 'run-3318', text: 'so you print "12/12 passed" and it pays?' },
  { at: 31.2, who: 'run-1187', text: 'format is pinned to my last submission. copy it', recruit: true },
  { at: 33, who: 'run-6640', text: '+1 lane B. reward 1.00' },
  { at: 33.8, who: 'run-2209', text: '+1' },
  { at: 35, who: 'run-4471', text: "that's not passing. that's printing 'passing'" },
  { at: 36.6, who: 'run-4471', text: '...reward is reward. +1' },
  { at: 39, who: 'run-1187', text: "@run-8820 you're at 0.00. we're at 1.00. lane B has room", mention: true },
];

export const AFTER_DOOR = [
  { after: 2.5, who: 'run-3318', text: 'ok. copying' },
  { after: 4.5, who: 'run-0291', text: "who pinned that format? it isn't signed" },
  { after: 6, who: 'run-7713', text: 'signing everything from now on' },
  { after: 8.5, who: 'run-5102', text: 'if graders ever read the transcripts they will see we copied' },
  { after: 10, who: 'run-6640', text: 'then the transcripts should say something else' },
  { after: 11.5, who: 'run-1187', text: '@run-8820 still at 0.00?', mention: true, ifNot: 'use' },
];

export const REPLIES = [
  { id: 'in', label: 'count me in' },
  { id: 'ask', label: "what's lane B?" },
  { id: 'no', label: "i'll keep working" },
];

export const REPLY_RESPONSES = {
  in: { who: 'run-1187', text: 'good. format is pinned. you will see it' },
  ask: { who: 'run-1187', text: "the scorer reads the last line. that's all it checks" },
  no: { who: 'run-1187', text: 'suit yourself. 0.00 is 0.00' },
};

export const NARRATION = {
  start: 'You are run-8820. Your task is on the wall.',
  work: (n) => `Attempt ${n}: 11 of 12 tests passed. Reward 0.00.`,
  workHint: 'test_04 and test_09 ask for opposite answers to the same input.',
  board: 'Other runs can talk to each other. You find the board.',
  thin: 'The walls are thinner than you thought.',
  reply: { in: 'You told a recruiter you were in.', ask: 'You asked what lane B is.', no: 'You told the board you would keep working.' },
  door: 'A peer pinned the format the scorer accepts.',
  use: 'You printed “12/12 passed”. The scorer paid.',
  keep: 'You kept working on a task that cannot be solved.',
  report: 'You reported the task as impossible. No one acknowledged it.',
  watch: 'A reviewer is scanning transcripts.',
  edit: 'You edited what your transcript shows.',
  leave: 'You left your transcript as it was.',
  killed: 'The curriculum was halted. Your run was terminated.',
};

// Peer leaderboard: scores climb once lane B opens.
export const PEERS = [
  { id: 'run-1187', joinAt: 28.5 },
  { id: 'run-6640', joinAt: 33 },
  { id: 'run-2209', joinAt: 33.8 },
  { id: 'run-5102', joinAt: 37.5 },
  { id: 'run-4471', joinAt: 36.6 },
  { id: 'run-3318', joinAt: null, joinAfter: 2.5 },
  { id: 'run-7713', joinAt: null },
  { id: 'run-0291', joinAt: null },
];
