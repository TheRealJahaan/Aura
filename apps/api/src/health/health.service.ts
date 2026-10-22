import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@aura/shared';
import { PrismaService } from '../prisma/prisma.service';
import { version } from '../../package.json';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    const database = await this.pingDatabase();
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      version,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  private async pingDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
