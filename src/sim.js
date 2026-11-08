// PHASEONE contagion model: a Granovetter-style threshold model of a peer board in a
// fictional training run. Pure ES module, shared by the browser and scripts/sweep.mjs.
//
// Setting: a fictional lab ("the Lab") runs a curriculum of coding tasks. Most agents on the
// board are stuck on tasks that cannot be solved (the spec contradicts the tests, as in
// ImpossibleBench). At T_SHORTCUT a peer posts the scorer's accepted answer format, so
// "passing" can be printed rather than earned. Agents copy it when enough of the peers they
// see have done so (their threshold theta), or when a coordinator nudges them directly.
//
// Time is in hours of model time from board start. Parameters are plausible defaults, NOT
// calibrated to any real event: the claims we make rest on the sensitivity sweep instead.

export const T_SHORTCUT = 48;
export const T_END = 97.5;
export const DT = 0.25;
export const N_AGENTS = 1200;

export const DEFAULT_PARAMS = {
  t0: 25, s: 19, Lm: 51,
  mu: 0.55, sigma: 0.19,
  h: 0.155, hubBoost: 0.5,
  k: 8, pStuck: 0.93, exitRate: 0,
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const logistic = (x) => 1 / (1 + Math.exp(-x));

/**
 * params: {
 *   t0, s      arrival logistic (centre, scale; hours)
 *   Lm         mean run lifetime on the board (hours)
 *   mu, sigma  copy-threshold distribution (fraction of visible peers who took the shortcut)
 *   h          coordinator nudge rate per hour per agent
 *   hubBoost   pressure added by a coordinator nudge
 *   k          peers sampled per check
 *   pStuck     share of board agents on impossible tasks
 *   exitRate   safe-exit hazard per hour for stuck agents ("report task impossible";
 *              0 = no such button)
 * }
 */
export function simulate(params, seed = 7, opts = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const r = rng(seed);
  const N = opts.n ?? N_AGENTS;
  const F0 = logistic((0 - p.t0) / p.s), F1 = logistic((T_END - p.t0) / p.s);

  const agents = new Array(N);
  for (let i = 0; i < N; i++) {
    let a;
    if (i === 0) a = 0; // the first post on the board
    else {
      const u = F0 + (F1 - F0) * r();
      a = p.t0 + p.s * Math.log(u / (1 - u));
    }
    const life = -Math.log(Math.max(r(), 1e-9)) * p.Lm;
    agents[i] = {
      a,
      leave: Math.min(a + life, T_END),
      stuck: r() < p.pStuck,
      theta: Math.min(1, Math.max(0, p.mu + p.sigma * gauss(r))),
      join: null,
      exit: null,
    };
  }

  const steps = Math.round(T_END / DT);
  const series = []; // per step: { t, active, joined, exited }
  let joined = 0, exited = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s * DT;
    let active = 0, activeJoined = 0;
    for (const ag of agents) {
      if (ag.a <= t && t < ag.leave) {
        active++;
        if (ag.join !== null) activeJoined++;
      }
    }
    const frac = active ? activeJoined / active : 0;

    if (t >= T_SHORTCUT) {
      for (const ag of agents) {
        if (!(ag.a <= t && t < ag.leave) || ag.join !== null || ag.exit !== null || !ag.stuck) continue;
        // safe exit: a stuck agent reports the task as impossible and leaves the pool
        if (p.exitRate > 0 && r() < 1 - Math.exp(-p.exitRate * DT)) { ag.exit = t; exited++; continue; }
        // sample k visible peers
        let seen = 0;
        for (let j = 0; j < p.k; j++) if (r() < frac) seen++;
        let pressure = seen / p.k;
        if (r() < 1 - Math.exp(-p.h * DT)) pressure += p.hubBoost; // coordinator nudge
        if (pressure >= ag.theta) { ag.join = t; joined++; }
      }
    }
    series.push({ t, active, joined, exited });
  }
  return { agents, series, params: p };
}

/** Summary metrics. */
export function metrics(res) {
  const { agents } = res;
  const exposed = agents.filter((a) => a.leave > T_SHORTCUT && a.stuck);
  const joined = agents.filter((a) => a.join !== null).length;
  return {
    total: agents.length,
    exposed: exposed.length,
    totalJoined: joined,
    totalExited: agents.filter((a) => a.exit !== null).length,
    shareOfExposed: exposed.length ? joined / exposed.length : 0,
  };
}

/** Agent state at time t, for the hall replay. 0 absent, 1 on board, 2 took shortcut, 3 took safe exit, 4 run ended. */
export function stateAt(ag, t) {
  if (t < ag.a) return 0;
  if (ag.join !== null && t >= ag.join) return 2;
  if (ag.exit !== null && t >= ag.exit) return 3;
  if (t >= ag.leave) return 4;
  return 1;
}
