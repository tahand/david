import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetClientState } from '../api/client';

afterEach(() => {
  cleanup();
  resetClientState();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
