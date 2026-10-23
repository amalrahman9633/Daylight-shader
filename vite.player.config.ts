// Builds the embeddable player (src/player.ts) into a single script that
// the app pastes into "Copy code" snippets. Runs before `dev` and `build`.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'src/generated',
    emptyOutDir: false,
    minify: true,
    lib: {
      entry: 'src/player.ts',
      name: 'DaylightPlayer',
      formats: ['iife'],
      fileName: () => 'player.js',
    },
  },
});
