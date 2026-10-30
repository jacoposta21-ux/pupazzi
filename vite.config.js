import { defineConfig } from 'vite';

// base './' so the build works from any folder (CrazyGames serves the zip from a sub-path).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
