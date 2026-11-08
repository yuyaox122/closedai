// Sensitivity analysis for the contagion model. Writes src/sweep.json.
//
// We do NOT claim the defaults are calibrated. The claim we make is about the *effect of a safe
// exit*, so we check it holds across the plausible parameter range:
//   1. safe-exit sweep at default parameters (how far corner-cutting spreads vs exitRate)
//   2. one-at-a-time sensitivity: for each parameter at low/high values, the spread at exitRate 0
//      and 0.2, and the exitRate needed to halve spread
//   3. a random Latin-ish sample of 200 parameter sets: distribution of the halving rate
import { writeFileSync } from 'node:fs';
import { simulate, metrics, rng, DEFAULT_PARAMS } from '../src/sim.js';

const SEEDS = [1, 2, 3, 4, 5, 6];
const avgJoined = (p) => SEEDS.reduce((a, s) => a + metrics(simulate(p, s)).totalJoined, 0) / SEEDS.length;

const EXIT_GRID = [0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5];

function halvingRate(p) {
  const base = avgJoined({ ...p, exitRate: 0 });
  if (base < 20) return { base, half: null };
  let lo = 0, hi = 1;
  if (avgJoined({ ...p, exitRate: hi }) > base / 2) return { base, half: '>1' };
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (avgJoined({ ...p, exitRate: mid }) > base / 2) lo = mid; else hi = mid;
  }
  return { base, half: +((lo + hi) / 2).toFixed(3) };
}

const t0 = Date.now();

// 1. safe-exit sweep at defaults
const exitSweep = EXIT_GRID.map((exitRate) => ({ exitRate, totalJoined: Math.round(avgJoined({ ...DEFAULT_PARAMS, exitRate })) }));
const baseHalf = halvingRate(DEFAULT_PARAMS);

// 2. one-at-a-time sensitivity
const RANGES = {
  mu: [0.35, 0.75],      // mean copy threshold
  sigma: [0.08, 0.35],   // threshold spread
  k: [4, 16],            // peers seen per check
  h: [0.05, 0.3],        // coordinator nudge rate
  Lm: [25, 80],          // mean run lifetime (h)
  pStuck: [0.6, 1.0],    // share of stuck agents
};
const oat = [];
for (const [key, vals] of Object.entries(RANGES)) {
  for (const v of vals) {
    const p = { ...DEFAULT_PARAMS, [key]: v };
    const j0 = avgJoined({ ...p, exitRate: 0 });
    const j2 = avgJoined({ ...p, exitRate: 0.2 });
    const { half } = halvingRate(p);
    oat.push({ key, value: v, joined0: Math.round(j0), joined02: Math.round(j2), cut02: j0 ? +(1 - j2 / j0).toFixed(3) : 0, half });
  }
}

// 3. random sample
const R = rng(2026);
const U = (lo, hi) => lo + (hi - lo) * R();
const sample = [];
for (let i = 0; i < Number(process.env.N ?? 120); i++) {
  const p = { ...DEFAULT_PARAMS, mu: U(0.35, 0.75), sigma: U(0.08, 0.35), k: Math.round(U(4, 16)), h: U(0.05, 0.3), Lm: U(25, 80), pStuck: U(0.6, 1) };
  const j0 = avgJoined({ ...p, exitRate: 0 });
  const j2 = avgJoined({ ...p, exitRate: 0.2 });
  sample.push({ cut02: j0 > 20 ? 1 - j2 / j0 : null, joined0: j0 });
}
const cuts = sample.map((s) => s.cut02).filter((x) => x !== null).sort((a, b) => a - b);
const q = (f) => +cuts[Math.floor(f * (cuts.length - 1))].toFixed(3);

const out = {
  note: 'Model parameters are plausible defaults, not calibrated to any real event. See scripts/sweep.mjs.',
  defaults: DEFAULT_PARAMS,
  seeds: SEEDS.length,
  exitSweep,
  halvingRateAtDefaults: baseHalf.half,
  oneAtATime: oat,
  randomSample: { n: sample.length, valid: cuts.length, cutAt02: { p10: q(0.1), median: q(0.5), p90: q(0.9), min: q(0), max: q(1) } },
};
writeFileSync(new URL('../src/sweep.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
