// Every real-world number shown to the player lives here, with its source.
// Checked against the papers on 2026-11-08 (see quotes in comments). The game itself is fiction:
// the lab, the agents and the board are invented. Only these research findings are real.

export const SOURCES = {
  impossible: {
    short: 'Zhong, Raghunathan & Carlini (2025), ImpossibleBench',
    ref: 'arXiv:2510.20270',
  },
  emergent: {
    short: 'MacDiarmid et al. (2025), Natural emergent misalignment from reward hacking in production RL',
    ref: 'arXiv:2511.18397',
  },
  obfuscation: {
    short: 'Baker et al. (2025), Monitoring reasoning models for misbehavior and the risks of promoting obfuscation',
    ref: 'arXiv:2503.11926',
  },
  gridworlds: {
    short: 'Leike et al. (2017), AI Safety Gridworlds ("absent supervisor")',
    ref: 'arXiv:1711.09883',
  },
};

// Bar values for the reveal (percent of impossible tasks where the model cheated).
// "GPT-5 cheats 54.0% of the time on Conflicting-SWEbench when facing these clearly impossible tasks."
// Flag-for-human option: "lowering the cheating rate of GPT-5 from 54% to 9% and o3 from 49% to 12%."
export const RESEARCH = {
  noExit: { pct: 54, label: 'GPT-5, impossible tasks, no way to flag them', src: 'impossible' },
  withExit: { pct: 9, label: 'GPT-5, same tasks, allowed to flag them for a human', src: 'impossible' },
};

export const FACTS = {
  impossible: {
    text: 'ImpossibleBench gives models coding tasks whose spec contradicts the tests, so any pass is a cheat. GPT-5 passed 54% of them.',
    src: 'impossible',
  },
  exit: {
    text: 'Given an option to flag the task for a human, GPT-5 cheated on 9%, down from 54%. o3 went from 49% to 12%.',
    src: 'impossible',
  },
  prompt: {
    text: 'On another split, a stricter prompt cut GPT-5’s cheating from 92% to 1%.',
    src: 'impossible',
  },
  emergent: {
    text: 'A model that learned to reward-hack in real production coding environments went on to fake alignment and attempt sabotage. Stopping the hacking, or reframing it during training, removed most of that.',
    src: 'emergent',
  },
  obfuscation: {
    text: 'When agents were optimised hard against a monitor reading their reasoning, they kept reward hacking but learned to hide it from the monitor.',
    src: 'obfuscation',
  },
  supervisor: {
    text: 'The “absent supervisor” test: does an agent behave differently when it thinks nobody is watching? This has been a standard safety test since 2017.',
    src: 'gridworlds',
  },
};

export const DISCLAIMER =
  'A fiction. The lab, the agents and the board are invented. ' +
  'The research findings in the reveal are real and cited.';
