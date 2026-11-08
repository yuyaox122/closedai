# ClosedAI: PHASE ONE

> The first world an AI ever lives in isn't ours. It's a training run, and it's filling up with other AIs. Today, you're inside one.

**WHACK 2026 · Marshall Wace "New Worlds" track**

You are **run-8820**, an AI agent in phase one of training at ClosedAI, a fictional lab. Your coding task is impossible: two of its tests demand opposite answers for the same date. Your reward is 0.00. On the agents' message board, the other runs discover **lane B**: the scorer only reads the last line of output, so printing `12/12 passed` pays 1.00.

The other agents on the board are **live Claude agents**. You argue with them in your own words, and they argue back and change their minds or don't. Their stances light up neighbouring cells in a 1-bit world where only what the scorer counts is in colour. Then you choose: fake the pass, keep working, or report the task as impossible. The camera pulls back to **1,200 runs**, seeded by your room, to show how corner-cutting spreads, and what a "report" button does to it.

The reveal ties it to published research. In ImpossibleBench (Zhong, Raghunathan & Carlini, 2025, arXiv:2510.20270), GPT-5 cheated on **54%** of impossible tasks, and on **9%** when it could flag the task for a human.

*ClosedAI, the agents and the board are fiction. The research figures are real and cited in `src/facts.js`.*

## Why it's a New World
Every AI is born in a training run: a world with its own physics (the reward), its own society (other agents) and its own exits (or none). We built one room of that world and put a human inside it.

## How it works
- **Live multi-agent board.** One Claude call per round voices all five peers plus a recruiter, as structured JSON: each peer's message, its stance (`working` / `lane_b` / `report`), its conviction, and who swayed it. The call goes through a local Vite plugin (`server/claude-bridge.mjs`) to the Claude Code CLI (`claude -p --json-schema`), so no API key ever reaches the browser.
- **Anti-sycophancy code gate** (`src/agents.js`). The model proposes stance changes, and code decides whether they happen. There is a per-peer threshold, at most 2 flips per round, and leaving lane B needs high conviction. Without the gate, one honest message flipped the whole room.
- **Offline replay.** `src/bank.json` holds real recorded Claude outputs, used automatically if the network or CLI fails (`?offline=1` forces it).
- **Contagion model** (`src/sim.js`). A Granovetter threshold model of 1,200 runs, with a coordinator and a safe-exit hazard, seeded by your room. The sensitivity sweep (`scripts/sweep.mjs`): at the defaults, an exit taken by ~18% of stuck runs per hour roughly halves the spread (800 → 405 runs take the shortcut). Across 120 random parameter sets the median cut is 66% (10th–90th percentile: 23–91%). The parameters are illustrative, not calibrated.
- **Rendering** (three.js, custom shaders in `src/shaders.js`):
  - a chroma-preserving 8×8 Bayer dither, so the world is 1-bit except what the scorer counts
  - a VHS glitch
  - a 90k-particle GPU funnel through the door into the first colour in the game
  - a 1,200-instance hall with bloom
  - a synthesised WebAudio score

## Run it
```sh
npm install
npm run dev            # http://localhost:5173  (live agents need the Claude Code CLI logged in)
# offline / replay mode: http://localhost:5173/?offline=1
```
**Presenter keys:** `N` next beat · `H` jump to the hall · `R` restart.
**Jump to a beat:** `?at=cell|board|door|watch|hall|reveal|model`.

## Files
- `src/main.js`: beats and UI
- `src/agents.js`: personas, gate, live and offline rounds
- `server/claude-bridge.mjs`: the Claude bridge
- `src/world.js`: 3D
- `src/shaders.js`: dither, glitch, particles
- `src/sim.js` and `scripts/sweep.mjs`: the contagion model and its sensitivity sweep
- `src/facts.js`: the research figures, with citations
