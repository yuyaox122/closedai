import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the original PHASEONE (index.html) and the STOP THE CLOCK greybox (rescue.html).
export default defineConfig({
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), rescue: resolve(__dirname, 'rescue.html') } } },
});
