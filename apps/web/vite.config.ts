import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { DOCUMENT_SECURITY_HEADERS } from '../../packages/shared/src/security';

// Same-origin in dev too: the API is proxied, so no CORS is needed (SPEC §11).
// End-to-end tests point this at their own API instance.
const proxy = { '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['@clinic/source'] },
  server: { port: 5173, proxy },
  // `vite preview` serves the production build with the production headers,
  // so end-to-end tests catch CSP problems. (The dev server can't: Vite's dev
  // client injects inline styles.)
  preview: { port: 4173, strictPort: true, proxy, headers: DOCUMENT_SECURITY_HEADERS },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
