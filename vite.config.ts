/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages base path handling:
// - For a PROJECT site (https://<user>.github.io/<repo>/) set VITE_BASE_PATH="/<repo>/"
//   (the deploy workflow sets this automatically from the repository name).
// - For a USER/ORG site (https://<user>.github.io/) the base must be "/".
// - For local dev/preview it defaults to "/".
const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Keep chunks reasonably split so heavy optional libraries (OCR, transformers,
    // maps) don't bloat the initial load on mobile.
    rollupOptions: {
      output: {
        manualChunks: {
          vendor_react: ['react', 'react-dom'],
          vendor_maps: ['leaflet', 'react-leaflet'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
});
