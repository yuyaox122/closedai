// "How it works": the contagion chart, the safe-exit slider and the benefit line.
import { simulate, metrics, T_END, T_SHORTCUT } from './sim.js';
import sweep from './sweep.json';

const NS = 'http://www.w3.org/2000/svg';
const SEEDS = [7, 8, 9];
const avg = (exitRate) => {
  const runs = SEEDS.map((s) => simulate({ exitRate }, s));
  return { runs, joined: runs.reduce((a, r) => a + metrics(r).totalJoined, 0) / runs.length };
};
const fmt = (n) => Math.round(n).toLocaleString('en-GB');

export function mountModel({ onReplay }) {
  const svg = document.getElementById('chart');
  const slider = document.getElementById('exit');
  const pctEl = document.getElementById('exit-pct');
  const benefit = document.getElementById('benefit');
  const sens = document.getElementById('sens');

  const base = avg(0);
  const Wd = 640, Ht = 260, m = { l: 46, r: 12, t: 14, b: 30 };
  const X = (t) => m.l + (t / T_END) * (Wd - m.l - m.r);
  const Y = (v) => Ht - m.b - (v / 1000) * (Ht - m.t - m.b);

  const el = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  // axes
  for (let v = 0; v <= 1000; v += 250) {
    el('line', { x1: m.l, x2: Wd - m.r, y1: Y(v), y2: Y(v), stroke: '#26262c', 'stroke-width': 1 });
    el('text', { x: m.l - 6, y: Y(v) + 3, 'text-anchor': 'end' }).textContent = v;
  }
  for (let t = 0; t <= 96; t += 24) el('text', { x: X(t), y: Ht - 10, 'text-anchor': 'middle' }).textContent = `${t}h`;
  el('line', { x1: X(T_SHORTCUT), x2: X(T_SHORTCUT), y1: m.t, y2: Ht - m.b, stroke: '#55555e', 'stroke-dasharray': '3 3' });
  el('text', { x: X(T_SHORTCUT) + 5, y: m.t + 10 }).textContent = 'shortcut posted';
  el('text', { x: m.l + 4, y: m.t + 10 }).textContent = 'runs';

  const path = (series, key) => series.map((s, i) => `${i ? 'L' : 'M'}${X(s.t).toFixed(1)},${Y(s[key]).toFixed(1)}`).join('');
  const meanSeries = (runs) => runs[0].series.map((s, i) => ({
    t: s.t,
    joined: runs.reduce((a, r) => a + r.series[i].joined, 0) / runs.length,
    exited: runs.reduce((a, r) => a + r.series[i].exited, 0) / runs.length,
  }));
  el('path', { d: path(meanSeries(base.runs), 'joined'), fill: 'none', stroke: '#ffa21f', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', opacity: 0.55 });
  const pJoined = el('path', { fill: 'none', stroke: '#ffa21f', 'stroke-width': 2.5 });
  const pExited = el('path', { fill: 'none', stroke: '#6fdcff', 'stroke-width': 2.5 });

  const rs = sweep.randomSample.cutAt02;
  const lowMu = sweep.oneAtATime.find((o) => o.key === 'mu' && o.value < 0.5);
  const highMu = sweep.oneAtATime.find((o) => o.key === 'mu' && o.value > 0.5);
  sens.innerHTML =
    `<b>Is that robust?</b> Across ${sweep.randomSample.n} random parameter sets (threshold, peers seen, nudge rate, run lifetime, share stuck), ` +
    `an 18%-per-hour exit cut spread by a median of ${Math.round(rs.median * 100)}% ` +
    `(10th–90th percentile: ${Math.round(rs.p10 * 100)}–${Math.round(rs.p90 * 100)}%). ` +
    `It helps least when runs copy at the slightest pressure (−${Math.round(lowMu.cut02 * 100)}%) and most when they need convincing (−${Math.round(highMu.cut02 * 100)}%). ` +
    `The model is illustrative, not fitted to any real event. Its direction matches ImpossibleBench, where a flag-for-human option cut GPT-5’s cheating from 54% to 9%.`;

  let timer = null;
  const render = (replay) => {
    const r = +slider.value;
    const perHour = 1 - Math.exp(-r);
    pctEl.textContent = `${Math.round(perHour * 100)}%`;
    const cur = avg(r);
    const ms = meanSeries(cur.runs);
    pJoined.setAttribute('d', path(ms, 'joined'));
    pExited.setAttribute('d', path(ms, 'exited'));
    const cut = 1 - cur.joined / base.joined;
    benefit.innerHTML = r === 0
      ? `With no safe exit, <b style="color:var(--amber)">${fmt(base.joined)}</b> of 1,200 runs take the shortcut. Drag the slider to give stuck runs a way out.`
      : `A safe exit taken by <b>${Math.round(perHour * 100)}%</b> of stuck runs per hour cuts how far the shortcut spreads from ${fmt(base.joined)} to <b>${fmt(cur.joined)}</b> runs (−${Math.round(cut * 100)}%).`;
    if (replay) {
      clearTimeout(timer);
      timer = setTimeout(() => onReplay(cur.runs[0], r), 120);
    }
  };
  slider.addEventListener('input', () => render(false));
  slider.addEventListener('change', () => render(true));
  render(false);
  return { set(r) { slider.value = r; render(true); } };
}
