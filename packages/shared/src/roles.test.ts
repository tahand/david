import { describe, expect, it } from 'vitest';
import { isStaffRole, roleSchema } from './roles.js';

describe('roles', () => {
  it('treats doctor, receptionist and admin as staff', () => {
    expect(isStaffRole('doctor')).toBe(true);
    expect(isStaffRole('receptionist')).toBe(true);
    expect(isStaffRole('admin')).toBe(true);
    expect(isStaffRole('patient')).toBe(false);
  });

  it('rejects unknown roles', () => {
    expect(roleSchema.safeParse('superuser').success).toBe(false);
  });
});
