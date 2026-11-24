import { defineConfig } from 'vitest/config';

// Served from https://<user>.github.io/grainforge/ on GitHub Pages.
export default defineConfig({
  base: process.env.GRAINFORGE_BASE ?? '/grainforge/',
  build: {
    // three.js is most of the main bundle; the PDF code loads on demand.
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
