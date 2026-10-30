import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';
import { validEnv } from './test/helpers.js';

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig(validEnv());
    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.appOrigin).toBe('http://localhost:5173');
    expect(config.dataEncryptionKey).toHaveLength(32);
    expect(config.hibpCheckEnabled).toBe(false);
  });

  it.each(['DATABASE_URL', 'SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'APP_URL', 'SMTP_HOST'])(
    'refuses to start when %s is missing',
    (key) => {
      const env = validEnv();
      delete env[key];
      expect(() => loadConfig(env)).toThrowError(new RegExp(key));
    },
  );

  it('treats empty strings as missing', () => {
    expect(() => loadConfig({ ...validEnv(), SESSION_SECRET: '' })).toThrow(ConfigError);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    const env = { ...validEnv(), DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') };
    expect(() => loadConfig(env)).toThrowError(/DATA_ENCRYPTION_KEY/);
  });

  it('rejects a short session secret', () => {
    const env = { ...validEnv(), SESSION_SECRET: Buffer.alloc(32).toString('base64') };
    expect(() => loadConfig(env)).toThrowError(/SESSION_SECRET/);
  });

  it('rejects malformed values', () => {
    expect(() => loadConfig({ ...validEnv(), CLINIC_TIMEZONE: 'Mars/Olympus' })).toThrow(
      /CLINIC_TIMEZONE/,
    );
    expect(() => loadConfig({ ...validEnv(), DATABASE_URL: 'mysql://x@y/z' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadConfig({ ...validEnv(), PORT: 'abc' })).toThrow(/PORT/);
  });

  it('requires https APP_URL in production', () => {
    expect(() => loadConfig({ ...validEnv(), NODE_ENV: 'production' })).toThrow(/https/);
  });

  it('never echoes secret values in the error', () => {
    const env = { ...validEnv(), SESSION_SECRET: 'c2hvcnQ=' };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect(String(err)).not.toContain('c2hvcnQ=');
    }
  });
});
