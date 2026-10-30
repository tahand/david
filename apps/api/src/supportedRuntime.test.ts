import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Cyber Essentials: only vendor-supported software (docs/CYBER-ESSENTIALS.md).
 * Keeps the Node.js version in .nvmrc, package.json and the Docker image in
 * step, and away from end-of-life lines.
 */
const repo = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

/** Node.js lines past end of life. Add a line here when it reaches EOL. */
const END_OF_LIFE = [16, 18, 20, 21, 23];

describe('supported Node.js runtime', () => {
  const nvmrc = Number(repo('.nvmrc').trim());
  const engines = Number(/>=\s*(\d+)/.exec(JSON.parse(repo('package.json')).engines.node)?.[1]);
  const docker = Number(/FROM node:(\d+)-/.exec(repo('deploy/local/Dockerfile'))?.[1]);

  it('uses the same major version everywhere', () => {
    expect(engines).toBe(nvmrc);
    expect(docker).toBe(nvmrc);
  });

  it('is an even-numbered (LTS) line that is still supported', () => {
    expect(nvmrc % 2).toBe(0);
    expect(END_OF_LIFE).not.toContain(nvmrc);
  });
});
