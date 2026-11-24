import { defineConfig } from 'vitest/config';

// Served from https://<user>.github.io/grainforge/ on GitHub Pages.
export default defineConfig({
  base: process.env.GRAINFORGE_BASE ?? '/grainforge/',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
