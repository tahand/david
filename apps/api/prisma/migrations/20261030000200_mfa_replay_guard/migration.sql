-- TOTP replay protection (OWASP ASVS 2.8.4): remember the last accepted time step.
ALTER TABLE "users" ADD COLUMN "mfa_last_time_step" INTEGER;
