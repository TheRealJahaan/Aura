import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserProfile } from '@aura/shared';
import { missingServices, SERVICE_SCOPES } from '../google/scopes';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { google: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      google: {
        connected: user.google !== null,
        missingServices: user.google ? missingServices(user.google.scopes) : Object.keys(SERVICE_SCOPES),
      },
    };
  }
}
