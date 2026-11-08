import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { claudeBridge } from './server/claude-bridge.mjs';

// Two pages: PHASEONE (index.html) and the parked STOP THE CLOCK greybox (rescue.html).
// claudeBridge() serves /api/* by calling Claude through the local Claude Code CLI.
export default defineConfig({
  plugins: [claudeBridge()],
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), rescue: resolve(__dirname, 'rescue.html') } } },
});
