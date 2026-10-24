import { Injectable } from '@nestjs/common';
import { randomToken, sha256Hex } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

const TOKEN_PREFIX = 'aura_';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export interface AuthContext {
  userId: string;
  sessionId: string;
}

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a session and returns its token. The token itself is never stored. */
  async create(userId: string): Promise<string> {
    const token = `${TOKEN_PREFIX}${randomToken()}`;
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }

  async verify(token: string): Promise<AuthContext | null> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) {
      return null;
    }
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) } });
    const now = Date.now();
    if (!session || session.expiresAt.getTime() <= now) {
      return null;
    }
    if (now - session.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } });
    }
    return { userId: session.userId, sessionId: session.id };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
