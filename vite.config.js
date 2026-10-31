import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base './' so the build works from any folder (CrazyGames serves the zip from a sub-path).
// `--mode cheats` builds a single self-contained HTML test file with infinite cash (see .env.cheats).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'cheats' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'cheats' ? 'dist-cheats' : 'dist', chunkSizeWarningLimit: 1500 },
}));
