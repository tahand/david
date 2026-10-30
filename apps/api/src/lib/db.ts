import { PrismaClient } from '@prisma/client';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export const prismaHealthCheck = (prisma: PrismaClient) => async (): Promise<void> => {
  await prisma.$queryRaw`SELECT 1`;
};
