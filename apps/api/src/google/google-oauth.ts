import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppConfig } from '../config/app-config';
import { GOOGLE_SCOPES } from './scopes';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleSignInResult {
  profile: GoogleProfile;
  refreshToken: string | null;
  scopes: string[];
}

/**
 * The three things Aura needs from Google's OAuth server. It's an abstract
 * class so tests can swap in a fake Google.
 */
export abstract class GoogleOAuth {
  abstract authUrl(state: string): string;
  abstract exchangeCode(code: string): Promise<GoogleSignInResult>;
  abstract revoke(refreshToken: string): Promise<void>;
}

@Injectable()
export class GoogleOAuthClient extends GoogleOAuth {
  constructor(private readonly config: AppConfig) {
    super();
  }

  private client(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.config.google.clientId,
      clientSecret: this.config.google.clientSecret,
      redirectUri: this.config.google.redirectUri,
    });
  }

  authUrl(state: string): string {
    return this.client().generateAuthUrl({
      access_type: 'offline', // gives us a refresh token, so Aura works without signing in every hour
      prompt: 'consent', // always show the consent screen, so Google always returns that refresh token
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES,
      state,
    });
  }

  async exchangeCode(code: string): Promise<GoogleSignInResult> {
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new Error('Google did not return an ID token');
    }
    // The ID token is signed by Google; verifying it proves who signed in.
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.config.google.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error('Google did not say who signed in');
    }
    return {
      profile: {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      },
      refreshToken: tokens.refresh_token ?? null,
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.client().revokeToken(refreshToken);
  }
}
