import { defineConfig } from 'vitest/config';

// Served from https://<user>.github.io/grainforge/ on GitHub Pages.
export default defineConfig({
  base: process.env.GRAINFORGE_BASE ?? '/grainforge/',
  build: {
    // three.js is most of the main bundle; the PDF code loads on demand.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // The app, the rendered-photo bench (bench.html) and the real-photo bench.
      input: { main: 'index.html', bench: 'bench.html', benchPhotos: 'bench-photos.html' },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
