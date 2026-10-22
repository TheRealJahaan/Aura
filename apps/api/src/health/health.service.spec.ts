import { healthResponseSchema } from '@aura/shared';
import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';

function serviceWith(queryRaw: jest.Mock) {
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('HealthService', () => {
  it('reports ok when the database answers', async () => {
    const result = await serviceWith(jest.fn().mockResolvedValue([1])).check();

    expect(healthResponseSchema.parse(result)).toEqual(result);
    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
  });

  it('reports degraded when the database is unreachable', async () => {
    const result = await serviceWith(jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))).check();

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
  });
});
