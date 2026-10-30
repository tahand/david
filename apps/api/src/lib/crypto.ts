import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level AES-256-GCM encryption (SPEC §6.2).
 *
 * Envelope format: `v<keyVersion>:<iv>:<authTag>:<ciphertext>` (base64 parts).
 * The key version travels with the ciphertext so old rows stay readable after
 * a key rotation. Callers pass an `aad` (additional authenticated data) naming
 * the column and row, e.g. `users.mfa_secret:<userId>`, so a ciphertext copied
 * into another row or column fails to decrypt.
 */
export class FieldCipher {
  private readonly keys: ReadonlyMap<number, Buffer>;

  constructor(
    private readonly currentVersion: number,
    keys: ReadonlyMap<number, Buffer>,
  ) {
    for (const [version, key] of keys) {
      if (key.length !== 32) throw new Error(`Encryption key v${version} must be 32 bytes`);
    }
    if (!keys.has(currentVersion)) throw new Error(`No key for current version ${currentVersion}`);
    this.keys = keys;
  }

  static single(version: number, key: Buffer): FieldCipher {
    return new FieldCipher(version, new Map([[version, key]]));
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      `v${this.currentVersion}`,
      iv.toString('base64'),
      tag.toString('base64'),
      ct.toString('base64'),
    ].join(':');
  }

  decrypt(envelope: string, aad: string): string {
    const parts = envelope.split(':');
    const [versionPart, ivB64, tagB64, ctB64] = parts;
    if (
      parts.length !== 4 ||
      !versionPart?.startsWith('v') ||
      !ivB64 ||
      !tagB64 ||
      ctB64 === undefined
    ) {
      throw new Error('Malformed ciphertext envelope');
    }
    const version = Number(versionPart.slice(1));
    const key = this.keys.get(version);
    if (!key) throw new Error(`Unknown encryption key version ${version}`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** True when the envelope was written with an older key and should be re-encrypted. */
  needsRotation(envelope: string): boolean {
    return !envelope.startsWith(`v${this.currentVersion}:`);
  }
}
