import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { TokenExchangeRequest, TokenExchangeResponse } from '@aura/shared';
import type { User } from '@prisma/client';
import { pkceChallenge, randomToken, safeEqual, sha256Hex, TokenCipher } from '../common/crypto';
import { GoogleOAuth, GoogleSignInResult } from '../google/google-oauth';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from './profile.service';
import { SessionsService } from './sessions.service';

const LOGIN_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

export type CallbackResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; title: string; message: string };

export interface CallbackQuery {
  code?: unknown;
  state?: unknown;
  error?: unknown;
}

const asString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

const START_AGAIN = 'Start signing in again from the Aura app.';

/**
 * Google sign-in for the desktop app, following RFC 8252 (OAuth for native apps):
 *
 * 1. The app makes a secret `verifier`, starts a tiny server on 127.0.0.1 and opens
 *    /auth/google/start?challenge=sha256(verifier)&port=<its port> in the browser.
 * 2. We remember the challenge and send the browser to Google.
 * 3. Google sends the browser back to /auth/google/callback with a code. We swap it
 *    for the user's tokens, then redirect the browser to the app's 127.0.0.1 server
 *    with a short-lived one-time code of our own.
 * 4. The app posts that code plus its verifier to /auth/token and gets a session.
 *
 * Only the app that started the sign-in knows the verifier, and only programs on
 * the user's own computer can receive the 127.0.0.1 redirect.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleOAuth,
    private readonly cipher: TokenCipher,
    private readonly sessions: SessionsService,
    private readonly profiles: ProfileService,
  ) {}

  async startLogin(challenge: string, port: number): Promise<string> {
    const id = randomToken();
    await this.prisma.loginRequest.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - CLEANUP_AFTER_MS) } },
    });
    await this.prisma.loginRequest.create({
      data: {
        id,
        codeChallenge: challenge,
        redirectPort: port,
        expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
      },
    });
    return this.google.authUrl(id);
  }

  async completeGoogleSignIn(query: CallbackQuery): Promise<CallbackResult> {
    const state = asString(query.state);
    const request = state ? await this.prisma.loginRequest.findUnique({ where: { id: state } }) : null;
    if (!request || request.completedAt || request.expiresAt.getTime() < Date.now()) {
      return { ok: false, title: 'This sign-in link has expired', message: START_AGAIN };
    }

    const error = asString(query.error);
    if (error) {
      return {
        ok: false,
        title: 'Sign-in was cancelled',
        message:
          error === 'access_denied'
            ? `You chose not to give Aura access. ${START_AGAIN}`
            : `Google said "${error}". ${START_AGAIN}`,
      };
    }

    const code = asString(query.code);
    if (!code) {
      return { ok: false, title: 'Google did not finish the sign-in', message: START_AGAIN };
    }

    let result: GoogleSignInResult;
    try {
      result = await this.google.exchangeCode(code);
    } catch (err) {
      this.logger.warn(`Google code exchange failed: ${(err as Error).message}`);
      return { ok: false, title: 'Google sign-in failed', message: START_AGAIN };
    }
    if (!result.profile.emailVerified) {
      return { ok: false, title: 'Unverified Google account', message: 'Verify your email address with Google first.' };
    }
    if (!result.refreshToken) {
      return {
        ok: false,
        title: 'Google did not allow offline access',
        message: 'Remove Aura at myaccount.google.com/permissions, then sign in again from the Aura app.',
      };
    }

    const user = await this.saveGoogleAccount(result, result.refreshToken);
    const authCode = randomToken();
    const completed = await this.prisma.loginRequest.updateMany({
      where: { id: request.id, completedAt: null },
      data: {
        authCodeHash: sha256Hex(authCode),
        userId: user.id,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    if (completed.count !== 1) {
      return { ok: false, title: 'This sign-in link has expired', message: START_AGAIN };
    }
    return {
      ok: true,
      redirectUrl: `http://127.0.0.1:${request.redirectPort}/callback?code=${encodeURIComponent(authCode)}`,
    };
  }

  async exchangeCode({ code, verifier }: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    const invalid = new UnauthorizedException('This sign-in code is invalid or expired. Sign in again.');
    const request = await this.prisma.loginRequest.findUnique({ where: { authCodeHash: sha256Hex(code) } });
    if (!request?.userId || !request.completedAt) {
      throw invalid;
    }
    // Claim the code before checking the verifier, so each code can be tried only once.
    const claimed = await this.prisma.loginRequest.updateMany({
      where: { id: request.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1 || !safeEqual(pkceChallenge(verifier), request.codeChallenge)) {
      throw invalid;
    }
    const token = await this.sessions.create(request.userId);
    return { token, user: await this.profiles.get(request.userId) };
  }

  private async saveGoogleAccount({ profile, scopes }: GoogleSignInResult, refreshToken: string): Promise<User> {
    const encryptedRefreshToken = this.cipher.encrypt(refreshToken);
    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.googleConnection.findUnique({
        where: { googleSub: profile.sub },
        include: { user: true },
      });
      const byEmail = await tx.user.findUnique({ where: { email: profile.email } });
      const existing = connection?.user ?? byEmail;

      const details = { name: profile.name, avatarUrl: profile.picture };
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            // Only follow an email change if no other Aura user already has that address.
            data: !byEmail || byEmail.id === existing.id ? { ...details, email: profile.email } : details,
          })
        : await tx.user.create({ data: { ...details, email: profile.email } });

      await tx.googleConnection.upsert({
        where: { userId: user.id },
        create: { userId: user.id, googleSub: profile.sub, scopes, encryptedRefreshToken },
        update: { googleSub: profile.sub, scopes, encryptedRefreshToken },
      });
      return user;
    });
  }
}
