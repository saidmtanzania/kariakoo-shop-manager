import type { PrismaService } from '../../database/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('reports ok when the database is reachable', async () => {
    const prisma = {
      isReachable: vi.fn().mockResolvedValue(true),
    } as unknown as PrismaService;
    await expect(new HealthService(prisma).readiness()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('reports unavailable when the database is down', async () => {
    const prisma = {
      isReachable: vi.fn().mockResolvedValue(false),
    } as unknown as PrismaService;
    await expect(new HealthService(prisma).readiness()).resolves.toMatchObject({
      status: 'unavailable',
      checks: { database: 'down' },
    });
  });
});
