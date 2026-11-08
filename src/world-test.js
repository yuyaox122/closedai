// Dev-only harness for the world.js room hooks: /world-test.html?shift=180
import { World } from './world.js';
const Q = new URLSearchParams(location.search);
const world = new World(document.getElementById('gl'), { particles: 2000 });
world.setViewShift(+(Q.get('shift') ?? 180), 0.001);
world.setThin(+(Q.get('thin') ?? 0.72), 0.001);
world.setRoom((Q.get('room') || 'working,lane_b,report,working,lane_b').split(','), 0.001);
let last = performance.now();
function frame(ts) { const dt = Math.min(0.05, (ts - last) / 1000); last = ts; world.update(dt); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
setTimeout(() => world.influence(+(Q.get('inf') ?? 1), Q.get('infs') || 'lane_b'), 300);
window.__w = world;
