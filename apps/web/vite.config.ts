import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['@clinic/source'] },
  server: {
    port: 5173,
    // Same-origin in dev too: the API is proxied, so no CORS is needed (SPEC §11).
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
