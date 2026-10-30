import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions.js';
import { mfaVerifySchema, registerSchema } from './auth.js';

describe('RBAC (SPEC §3)', () => {
  it('never grants clinical notes to receptionists or admins', () => {
    expect(hasPermission('receptionist', 'clinical-notes:read')).toBe(false);
    expect(hasPermission('admin', 'clinical-notes:read')).toBe(false);
    expect(hasPermission('doctor', 'clinical-notes:read')).toBe(true);
  });

  it('keeps admin capabilities to admins', () => {
    for (const role of ['patient', 'doctor', 'receptionist'] as const) {
      expect(hasPermission(role, 'admin:users')).toBe(false);
    }
    expect(hasPermission('admin', 'admin:users')).toBe(true);
    expect(hasPermission('admin', 'appointments:book:any')).toBe(true);
  });

  it('limits patients to self-service', () => {
    expect(hasPermission('patient', 'appointments:book:self')).toBe(true);
    expect(hasPermission('patient', 'appointments:book:any')).toBe(false);
    expect(hasPermission('patient', 'patients:read')).toBe(false);
  });
});

describe('auth schemas', () => {
  it('normalises email and strips unknown fields on registration', () => {
    const parsed = registerSchema.parse({
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '1990-01-01',
      email: '  Someone@Example.TEST ',
      mobile: '07700 900000',
      password: 'a long enough password',
      acceptTerms: true,
      role: 'admin',
    });
    expect(parsed.email).toBe('someone@example.test');
    expect('role' in parsed).toBe(false);
  });

  it('rejects future dates of birth', () => {
    const r = registerSchema.safeParse({
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '2999-01-01',
      email: 'a@example.test',
      mobile: '07700 900000',
      password: 'a long enough password',
      acceptTerms: true,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a TOTP code or a recovery code, normalising the latter', () => {
    expect(mfaVerifySchema.parse({ code: '123456' })).toEqual({ code: '123456' });
    expect(mfaVerifySchema.parse({ recoveryCode: 'ABCDE-FGH23' })).toEqual({
      recoveryCode: 'abcdefgh23',
    });
    expect(mfaVerifySchema.safeParse({ code: '12345' }).success).toBe(false);
  });
});
