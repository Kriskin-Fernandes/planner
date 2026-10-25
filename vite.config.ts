/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Automatically set the base path for GitHub Pages production builds ('/planner/')
// while keeping '/' for local development and testing.
const base = process.env.NODE_ENV === 'production' 
  ? (process.env.VITE_BASE_PATH || '/planner/') 
  : '/';

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