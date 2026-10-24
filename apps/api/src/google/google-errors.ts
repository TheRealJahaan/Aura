import type { GoogleService } from '@aura/shared';
import { GoogleNotConnectedError } from './google-apis';

const SERVICE_NAMES: Record<GoogleService, string> = {
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  tasks: 'Google Tasks',
  drive: 'Google Drive',
  contacts: 'Google Contacts',
  meet: 'Google Meet',
};

const API_NAMES: Record<GoogleService, string> = {
  gmail: 'Gmail API',
  calendar: 'Google Calendar API',
  tasks: 'Google Tasks API',
  drive: 'Google Drive API',
  contacts: 'People API',
  meet: 'Google Calendar API',
};

interface GoogleLikeError {
  message?: string;
  code?: unknown;
  status?: unknown;
  response?: { status?: number; data?: unknown };
}

/** Turns a Google API failure into one sentence the user can act on. */
export function describeGoogleError(err: unknown, service: GoogleService | null): string {
  if (err instanceof GoogleNotConnectedError) {
    return err.message;
  }
  const e = (err ?? {}) as GoogleLikeError;
  const status = e.response?.status ?? (typeof e.status === 'number' ? e.status : undefined);
  const details = `${e.message ?? ''} ${JSON.stringify(e.response?.data ?? '')}`;
  const name = service ? SERVICE_NAMES[service] : 'Google';

  if (/invalid_grant/.test(details)) {
    return 'Your Google sign-in has expired (Google ends test-app sign-ins after 7 days). Open the Aura window and sign in again.';
  }
  if (/has not been used in project|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(details)) {
    return `The ${service ? API_NAMES[service] : 'needed Google API'} is turned off in your Google Cloud project. Turn it on (see docs/SETUP.md, step 1) and try again.`;
  }
  if (status === 403 && /insufficient|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE/i.test(details)) {
    return `Aura doesn't have permission to use ${name}. Sign in again and tick ${name} on Google's consent screen.`;
  }
  if (status === 404) {
    return `${name} couldn't find that. It may have been deleted.`;
  }
  if (status === 429) {
    return `${name} is limiting requests right now. Try again in a minute.`;
  }
  if (status !== undefined && status >= 500) {
    return `${name} had a problem on its side. Try again in a moment.`;
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|fetch failed/i.test(details)) {
    return "I couldn't reach Google. Check your internet connection.";
  }
  return `${name} returned an error: ${(e.message ?? 'unknown error').slice(0, 200)}`;
}
