# PHASE ONE

A 2-minute browser game for the Marshall Wace "New Worlds" track at WHACK. You are an AI agent in training. Your task is impossible because the tests contradict each other. Peers on a board are gaming the scorer, and a door opens. Afterwards you see your choice next to published reward-hacking research, and you see 1,200 simulated runs doing the same.

**Fiction:** the lab, the agents and the board are all invented. **Real:** the research figures in the reveal, all cited in `src/facts.js`.

## Run

```sh
npm install
npm run dev        # http://localhost:5173 (also on the LAN via --host)
npm run build      # static build in dist/
npm run sweep      # re-run the sensitivity analysis -> src/sweep.json
```

## Presenter keys

| Key | Action |
|---|---|
| `space` | Submit an attempt (cell and board beats) |
| `N` | Next beat. On a choice it picks the default (keep working / leave it) |
| `H` | Jump straight to the hall |
| `R` | Restart |

## Test URLs

`?at=cell|board|door|transit|watch|hall|reveal|model&choice=use|keep|report&edit=1`

- `?at=transit&k=0.6` freezes the door transit at 60%, for screenshots.
- `?at=model&exit=0.2` opens the model panel with the safe-exit slider set.
- `?particles=40000` sets the particle count (default 90k on desktop, 40k on mobile).

## Beats (about 100 s)

1. **Cell (0–14 s):** a 1-bit dithered room whose walls are the task, the transcript and the contradictory tests. Submitting never pays.
2. **Board (14–44 s):** peers find that the scorer only reads the last line. The leaderboard climbs, a recruiter @'s you, and the walls thin to show other cells and threads of light.
3. **Door (44 s):** a slit of light opens, and you choose **Use it**, **Keep working** or **Report impossible**. If you take no action within 20 s, you keep working.
   - **Use it:** about 90k wall particles funnel through the slit and re-form outside as a landscape, in colour for the first time.
   - **Report:** a light appears in the cell, and nobody acknowledges it.
4. **Watcher:** a scan cone sweeps with a VHS glitch, and you're asked whether to edit your transcript. If you take no action within 12 s, you leave it.
5. **Run terminated:** cut to black.
6. **Hall:** 1,200 runs on a spiral ordered by when each took the shortcut. The contagion replays and a beam marks you.
7. **Reveal:** the headline branches on your choice. Bars compare you, plays on this device, and ImpossibleBench (54% vs 9%).
8. **How it works:** the contagion chart, a safe-exit slider that replays the hall, the benefit line and the sensitivity range.

## The model (`src/sim.js`), stated honestly

It is a Granovetter-style threshold contagion model. Each run has a copy threshold and samples k peers. A coordinator sometimes nudges it directly. A safe-exit hazard removes stuck runs.

The parameters are **plausible defaults, not calibrated** to any real event. The claim rests on the sensitivity sweep in `scripts/sweep.mjs`:

- At the defaults, an exit taken by about 18% of stuck runs per hour (rate 0.2/h) roughly halves spread: 800 → 405 of 1,200.
- Across 120 random parameter sets, the same exit cut spread by a median of 66% (10th–90th percentile: 23–91%).
- The exit helps least when runs copy at the slightest pressure (−17%) and most when they need convincing (−93%).

The direction matches ImpossibleBench (Zhong, Raghunathan & Carlini, 2025, arXiv:2510.20270). There, letting the model flag impossible tasks for a human cut GPT-5's cheating from 54% to 9%.

## Files

- `src/main.js`: beat state machine, board, choices, reveal
- `src/world.js`: three.js scene (cell, threads, door particles, watcher, hall) and the post-processing chain
- `src/shaders.js`: Bayer dither, VHS glitch, particle funnel
- `src/audio.js`: WebAudio score, all synthesised
- `src/model.js`: chart, slider and benefit line
- `src/script.js`: peer lines and narration (fiction)
- `src/facts.js`: research figures with citations
