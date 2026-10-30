import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@clinic/source'] },
  ssr: { resolve: { conditions: ['@clinic/source'] } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
