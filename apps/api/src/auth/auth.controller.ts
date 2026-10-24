import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  loginStartQuerySchema,
  tokenExchangeRequestSchema,
  type TokenExchangeRequest,
  type TokenExchangeResponse,
} from '@aura/shared';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthGuard, CurrentAuth } from './auth.guard';
import { AuthService, type CallbackQuery } from './auth.service';
import { renderPage } from './pages';
import { type AuthContext, SessionsService } from './sessions.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  /** Opened in the browser by the desktop app. Sends the browser on to Google. */
  @Get('google/start')
  async start(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const parsed = loginStartQuerySchema.safeParse(query);
    if (!parsed.success) {
      res
        .status(400)
        .type('html')
        .send(renderPage('This sign-in link is broken', 'Start signing in from the Aura app.'));
      return;
    }
    res.redirect(302, await this.auth.startLogin(parsed.data.challenge, parsed.data.port));
  }

  /** Where Google sends the browser back after the user allows access. */
  @Get('google/callback')
  async callback(@Query() query: CallbackQuery, @Res() res: Response): Promise<void> {
    const result = await this.auth.completeGoogleSignIn(query);
    if (result.ok) {
      res.redirect(302, result.redirectUrl);
    } else {
      res.status(400).type('html').send(renderPage(result.title, result.message));
    }
  }

  /** The desktop app swaps its one-time code (plus PKCE verifier) for a session token. */
  @Post('token')
  @HttpCode(200)
  token(
    @Body(new ZodValidationPipe(tokenExchangeRequestSchema)) body: TokenExchangeRequest,
  ): Promise<TokenExchangeResponse> {
    return this.auth.exchangeCode(body);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
  }
}
