/**
 * Creates the first admin account (SPEC §3). Admins are never created via the web.
 *
 *   npm run create-admin -- --email admin@clinic.example
 *
 * The password is read from a hidden prompt, or from ADMIN_PASSWORD when stdin
 * is not a TTY (e.g. provisioning). The admin must enrol in MFA at first login.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { emailSchema } from '@clinic/shared';
import { pino } from 'pino';
import { writeAudit } from '../src/lib/audit.js';
import { AppError } from '../src/lib/errors.js';
import { createHibpChecker, noBreachCheck } from '../src/lib/hibp.js';
import { hashPassword } from '../src/lib/password.js';
import { assertPasswordAcceptable } from '../src/lib/passwordPolicy.js';

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo of typed characters.
    const internal = rl as unknown as { _writeToOutput: (s: string) => void };
    internal._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const fromEnv = process.env.ADMIN_PASSWORD;
    if (!fromEnv) throw new Error('No TTY: set ADMIN_PASSWORD to supply the password');
    return fromEnv;
  }
  const first = await promptHidden('Password (min 12 characters): ');
  const second = await promptHidden('Confirm password: ');
  if (first !== second) throw new Error('Passwords do not match');
  return first;
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  const parsedEmail = emailSchema.safeParse(values.email ?? '');
  if (!parsedEmail.success) throw new Error('Usage: npm run create-admin -- --email <address>');
  const email = parsedEmail.data;
  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email } })) {
      throw new Error(`A user with email ${email} already exists`);
    }
    const password = await readPassword();
    const logger = pino({ level: 'warn' });
    const isBreached =
      process.env.HIBP_CHECK_ENABLED === 'false' ? noBreachCheck : createHibpChecker({ logger });
    await assertPasswordAcceptable(password, email, isBreached);

    const user = await prisma.user.create({
      data: {
        email,
        role: 'admin',
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    });
    await writeAudit(prisma, {
      action: 'admin.user.created_via_cli',
      entityType: 'user',
      entityId: user.id,
      metadata: { role: 'admin' },
    });
    console.log(`Admin ${email} created. Two-step verification will be required at first sign-in.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  if (err instanceof AppError) {
    console.error(
      err.details?.map((d) => (d as { message: string }).message).join('\n') ?? err.message,
    );
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
