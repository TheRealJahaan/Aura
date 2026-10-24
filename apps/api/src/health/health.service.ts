import { Injectable, Optional } from '@nestjs/common';
import type { HealthResponse, LlmStatus } from '@aura/shared';
import { LlmProvider } from '../assistant/llm/types';
import { PrismaService } from '../prisma/prisma.service';
import { version } from '../../package.json';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly llm?: LlmProvider,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, llm] = await Promise.all([this.pingDatabase(), this.llmStatus()]);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      version,
      uptimeSeconds: Math.round(process.uptime()),
      ...(llm ? { llm } : {}),
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

  private llmStatus(): Promise<LlmStatus> | undefined {
    return this.llm?.status();
  }
}
