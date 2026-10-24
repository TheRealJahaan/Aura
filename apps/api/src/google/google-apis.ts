import { calendar, calendar_v3 } from '@googleapis/calendar';
import { drive, drive_v3 } from '@googleapis/drive';
import { gmail, gmail_v1 } from '@googleapis/gmail';
import { people, people_v1 } from '@googleapis/people';
import { tasks, tasks_v1 } from '@googleapis/tasks';
import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { TokenCipher } from '../common/crypto';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

export interface GoogleApis {
  gmail: gmail_v1.Gmail;
  calendar: calendar_v3.Calendar;
  tasks: tasks_v1.Tasks;
  drive: drive_v3.Drive;
  people: people_v1.People;
}

export interface GoogleAccount {
  apis: GoogleApis;
  scopes: string[];
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super('Your Google account is not connected. Open the Aura window and sign in with Google.');
  }
}

/**
 * Builds Google API clients that act as one user. The OAuth client keeps the
 * short-lived access token in memory and refreshes it with the stored refresh
 * token when it expires, so we cache one per user.
 */
@Injectable()
export class GoogleApisFactory {
  private readonly clients = new Map<string, { version: number; auth: OAuth2Client }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly cipher: TokenCipher,
  ) {}

  async forUser(userId: string): Promise<GoogleAccount> {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) {
      throw new GoogleNotConnectedError();
    }
    const version = connection.updatedAt.getTime();
    let cached = this.clients.get(userId);
    if (!cached || cached.version !== version) {
      const auth = new OAuth2Client({
        clientId: this.config.google.clientId,
        clientSecret: this.config.google.clientSecret,
        redirectUri: this.config.google.redirectUri,
      });
      auth.setCredentials({ refresh_token: this.cipher.decrypt(connection.encryptedRefreshToken) });
      cached = { version, auth };
      this.clients.set(userId, cached);
    }
    const auth = cached.auth;
    return {
      apis: {
        gmail: gmail({ version: 'v1', auth }),
        calendar: calendar({ version: 'v3', auth }),
        tasks: tasks({ version: 'v1', auth }),
        drive: drive({ version: 'v3', auth }),
        people: people({ version: 'v1', auth }),
      },
      scopes: connection.scopes,
    };
  }
}
