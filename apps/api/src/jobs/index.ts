import cron, { type ScheduledTask } from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppointmentNotifier } from '../modules/appointments/notifications.js';
import { sendDueReminders } from './reminders.js';
import { eraseExpiredPatients } from './retention.js';
import { cleanupExpired } from './sessionCleanup.js';

export interface JobDeps {
  prisma: PrismaClient;
  notifier: AppointmentNotifier;
  logger: Logger;
  timezone: string;
}

/**
 * Scheduled jobs (SPEC §7.4, §6.2), run in the API process with node-cron.
 * Every job is safe to run twice or concurrently, so a restart mid-run or a
 * second instance can't duplicate reminders or erasures. Returns a stop function.
 */
export function startJobs(deps: JobDeps): () => Promise<void> {
  const { prisma, notifier, logger, timezone } = deps;
  const run = (name: string, job: () => Promise<object | number>) => async (): Promise<void> => {
    try {
      logger.info({ job: name, result: await job() }, 'job finished');
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
    }
  };

  const tasks: ScheduledTask[] = [
    cron.schedule(
      '*/10 * * * *',
      run('reminders', () => sendDueReminders({ prisma, notifier })),
      { name: 'reminders', noOverlap: true },
    ),
    cron.schedule(
      '17 * * * *',
      run('session-cleanup', () => cleanupExpired({ prisma })),
      {
        name: 'session-cleanup',
        noOverlap: true,
      },
    ),
    // Nightly at a quiet hour, in clinic time.
    cron.schedule(
      '30 3 * * *',
      run('retention', () => eraseExpiredPatients({ prisma })),
      {
        name: 'retention',
        noOverlap: true,
        timezone,
      },
    ),
  ];
  return async () => {
    await Promise.all(tasks.map((t) => t.stop()));
  };
}
