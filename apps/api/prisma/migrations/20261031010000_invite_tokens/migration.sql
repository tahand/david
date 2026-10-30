-- Admin-issued set-password links (new staff accounts, admin-forced resets).
-- They live longer than self-service resets (72 h vs 30 min) because the
-- recipient didn't ask for them and may not see the email straight away.
ALTER TYPE "email_token_type" ADD VALUE IF NOT EXISTS 'invite';
