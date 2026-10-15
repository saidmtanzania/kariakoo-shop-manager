import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { ReadinessDto } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness(): Promise<ReadinessDto> {
    const databaseUp = await this.prisma.isReachable();
    return {
      status: databaseUp ? 'ok' : 'unavailable',
      checks: { database: databaseUp ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    };
  }
}
