import { defineConfig } from 'vite';

export default defineConfig({
  // relative Pfade, damit der Build unter https://<user>.github.io/<repo>/ läuft
  base: './',
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
