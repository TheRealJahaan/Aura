import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LlmStatus } from '@aura/shared';
import { AppModule } from '../src/app.module';
import { LlmProvider, LlmReply, LlmRequest } from '../src/assistant/llm/types';
import { GoogleApisFactory } from '../src/google/google-apis';
import { GoogleOAuth, GoogleSignInResult } from '../src/google/google-oauth';
import { GOOGLE_SCOPES } from '../src/google/scopes';
import { PrismaService } from '../src/prisma/prisma.service';
import { fakeGoogle, FakeGoogle } from './fakes';

/** Google's sign-in server, played by the test. */
export class FakeGoogleOAuth extends GoogleOAuth {
  result: GoogleSignInResult = {
    profile: { sub: 'google-sub-1', email: 'jahaan@example.com', emailVerified: true, name: 'Jahaan Suthar', picture: null },
    refreshToken: 'google-refresh-token-1',
    scopes: GOOGLE_SCOPES,
  };
  revoked: string[] = [];

  authUrl(state: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<GoogleSignInResult> {
    if (code !== 'good-google-code') throw new Error('invalid_grant');
    return this.result;
  }

  async revoke(token: string): Promise<void> {
    this.revoked.push(token);
  }
}

/** An AI that gives the replies a test scripts, and remembers what it was asked. */
export class ScriptedLlm extends LlmProvider {
  readonly name = 'ollama' as const;
  readonly model = 'scripted';
  replies: Array<LlmReply | Error> = [];
  requests: LlmRequest[] = [];

  async chat(request: LlmRequest): Promise<LlmReply> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as LlmRequest);
    const next = this.replies.shift();
    if (!next) throw new Error('The test did not script a reply for this AI call');
    if (next instanceof Error) throw next;
    return next;
  }

  async status(): Promise<LlmStatus> {
    return { provider: 'ollama', model: this.model, status: 'ready' };
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  oauth: FakeGoogleOAuth;
  llm: ScriptedLlm;
  google: FakeGoogle;
}

export async function createTestApp(): Promise<TestApp> {
  const oauth = new FakeGoogleOAuth();
  const llm = new ScriptedLlm();
  const google = fakeGoogle();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleOAuth)
    .useValue(oauth)
    .overrideProvider(LlmProvider)
    .useValue(llm)
    .overrideProvider(GoogleApisFactory)
    .useValue({ forUser: async () => ({ apis: google, scopes: GOOGLE_SCOPES }) })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, prisma: app.get(PrismaService), oauth, llm, google };
}

/** Removes everything a test created for this email address. */
export async function deleteUser(prisma: PrismaService, email: string): Promise<void> {
  await prisma.user.deleteMany({ where: { email } });
}
