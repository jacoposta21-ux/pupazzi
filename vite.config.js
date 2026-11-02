import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base './' so the build works from any folder (CrazyGames serves the zip from a sub-path).
// `--mode cheats` builds a single self-contained HTML test file with infinite cash (see .env.cheats).
// `--mode poki` builds for Poki (Poki SDK, see .env.poki).
// `--mode playgama` builds for Playgama: Bridge SDK instead of CrazyGames, plus its config file (see .env.playgama).
const OUT = { cheats: 'dist-cheats', playgama: 'dist-playgama', poki: 'dist-poki' };
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'cheats' ? [viteSingleFile()] : [],
  publicDir: mode === 'playgama' ? 'platform/playgama' : 'public',
  build: { outDir: OUT[mode] ?? 'dist', chunkSizeWarningLimit: 1500 },
}));
