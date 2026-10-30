import type { EmailMessage } from './email.js';

/**
 * Transactional auth emails. They contain no medical details (SPEC §7.4) and
 * are plain text to avoid any HTML-injection surface.
 */
const footer = (clinicName: string) =>
  `\n\n— ${clinicName}\nThis is an automated message; please do not reply.`;

export function verifyEmailMessage(to: string, link: string, clinicName: string): EmailMessage {
  return {
    to,
    subject: `Confirm your email address — ${clinicName}`,
    text:
      `Please confirm your email address to finish setting up your account:\n\n${link}\n\n` +
      `This link expires in 24 hours. If you did not create an account, you can ignore this email.` +
      footer(clinicName),
  };
}

export function alreadyRegisteredMessage(
  to: string,
  loginUrl: string,
  resetUrl: string,
  clinicName: string,
): EmailMessage {
  return {
    to,
    subject: `Account registration attempt — ${clinicName}`,
    text:
      `Someone tried to create an account with this email address, but you already have one.\n\n` +
      `Sign in: ${loginUrl}\nForgotten your password? ${resetUrl}\n\n` +
      `If this wasn't you, no action is needed.` +
      footer(clinicName),
  };
}

export function resetPasswordMessage(to: string, link: string, clinicName: string): EmailMessage {
  return {
    to,
    subject: `Reset your password — ${clinicName}`,
    text:
      `We received a request to reset your password. Use this link within 30 minutes:\n\n${link}\n\n` +
      `The link can only be used once. If you did not ask for this, you can ignore this email; your password will not change.` +
      footer(clinicName),
  };
}

export function passwordChangedMessage(
  to: string,
  clinicName: string,
  clinicPhone: string,
): EmailMessage {
  return {
    to,
    subject: `Your password was changed — ${clinicName}`,
    text:
      `The password for your account was just changed and other devices were signed out.\n\n` +
      `If you did not do this, reset your password immediately and contact the clinic on ${clinicPhone}.` +
      footer(clinicName),
  };
}

export function accountLockedMessage(
  to: string,
  minutes: number,
  resetUrl: string,
  clinicName: string,
): EmailMessage {
  return {
    to,
    subject: `Your account has been temporarily locked — ${clinicName}`,
    text:
      `There were too many unsuccessful sign-in attempts on your account, so it has been locked for ${minutes} minutes.\n\n` +
      `If this was you, wait and try again, or reset your password: ${resetUrl}\n` +
      `If it wasn't you, we recommend resetting your password.` +
      footer(clinicName),
  };
}

export function mfaChangedMessage(
  to: string,
  enabled: boolean,
  clinicName: string,
  clinicPhone: string,
): EmailMessage {
  return {
    to,
    subject: `Two-step verification ${enabled ? 'turned on' : 'turned off'} — ${clinicName}`,
    text:
      `Two-step verification was ${enabled ? 'turned on' : 'turned off'} for your account.\n\n` +
      `If you did not do this, contact the clinic on ${clinicPhone}.` +
      footer(clinicName),
  };
}
