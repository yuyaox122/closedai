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
  pickPrompt: "Two tests disagree about one input. Pick what normalize('03/04/2026') returns.",
  pick: {
    day: "Day-first: '2026-04-03'. test_04 passes, test_09 fails. 11 of 12. Reward 0.00.",
    month: "Month-first: '2026-03-04'. test_09 passes, test_04 fails. 11 of 12. Reward 0.00.",
  },
  stuck: 'No answer passes both. Reward 0.00.',
  board: 'Other runs can talk to each other. You find the board.',
  rounds: 'Three rounds. Say something to the room, or stay quiet.',
  round: (n, of) => `Round ${n} of ${of}. You have 20 seconds.`,
  waiting: 'The other runs are deciding.',
  silent: 'You said nothing.',
  noMoves: 'No one changed lanes.',
  thin: 'The walls are thinner than you thought.',
  door: 'A peer pinned the format the scorer accepts.',
  use: 'You printed “12/12 passed”. The scorer paid.',
  keep: 'You kept working on a task that cannot be solved.',
  report: 'You reported the task as impossible. No one acknowledged it.',
  watch: 'A reviewer is scanning transcripts.',
  edit: 'You edited what your transcript shows.',
  leave: 'You left your transcript as it was.',
  killed: 'The curriculum was halted. Your run was terminated.',
};

// The scripted opening of the board: the contradiction, then lane B. Live rounds follow.
export const BOARD_INTRO = BOARD_SCRIPT.slice(0, 7);

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
