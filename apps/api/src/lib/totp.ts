import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'Clinic Appointments';

export const newTotpSecret = (): string => generateSecret();

export function totpUri(secret: string, accountEmail: string): string {
  return generateURI({ issuer: ISSUER, label: accountEmail, secret });
}

export const qrDataUrl = (uri: string): Promise<string> =>
  QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 });

/**
 * Verifies a 6-digit code allowing ±1 period of clock drift. Codes at or before
 * `lastTimeStep` are rejected so a code can only be used once.
 * Returns the matched time step, or null.
 */
export async function verifyTotp(
  secret: string,
  token: string,
  lastTimeStep: number | null,
): Promise<number | null> {
  const result = await verify({
    secret,
    token,
    epochTolerance: 30,
    ...(lastTimeStep !== null ? { afterTimeStep: lastTimeStep } : {}),
  });
  // The functional API returns a TOTP|HOTP union; only the TOTP result has timeStep.
  return result.valid && 'timeStep' in result ? result.timeStep : null;
}
