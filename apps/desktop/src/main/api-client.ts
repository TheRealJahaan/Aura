import {
  activityResponseSchema,
  healthResponseSchema,
  tokenExchangeResponseSchema,
  turnResponseSchema,
  undoResponseSchema,
  userProfileSchema,
  type ActivityResponse,
  type HealthResponse,
  type TokenExchangeRequest,
  type TokenExchangeResponse,
  type TurnRequest,
  type TurnResponse,
  type UndoResponse,
  type UserProfile,
} from '@aura/shared';
import type { z } from 'zod';

/** A failed API call. The message is safe to show and say to the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly unreachable = false,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** Talks to the Aura API from the main process, with the session token. */
export class ApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly getToken: () => string | null,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S | null,
    options: { body?: unknown; timeoutMs?: number; auth?: boolean } = {},
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.auth !== false) {
      const token = this.getToken();
      if (!token) throw new ApiError('Sign in to Aura first. Open the Aura window and choose Sign in with Google.', 401);
      headers.authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new ApiError('The Aura server took too long to answer. Try again.', null);
      }
      throw new ApiError(`I can't reach the Aura server at ${this.baseUrl}. Start it with: npm run api`, null, true);
    }
    if (res.status === 401) {
      throw new ApiError('Your Aura sign-in has ended. Open the Aura window and sign in again.', 401);
    }
    const text = await res.text();
    const json: unknown = text ? safeJson(text) : null;
    if (!res.ok) {
      throw new ApiError(errorMessage(json) ?? `The Aura server returned an error (${res.status}).`, res.status);
    }
    if (!schema) return undefined as z.output<S>;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError('The Aura server sent an answer this app does not understand. Update both to the same version.', res.status);
    }
    return parsed.data;
  }

  health(): Promise<HealthResponse> {
    return this.request('GET', '/health', healthResponseSchema, { auth: false, timeoutMs: 8_000 });
  }

  exchangeCode(body: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    return this.request('POST', '/auth/token', tokenExchangeResponseSchema, { body, auth: false });
  }

  me(): Promise<UserProfile> {
    return this.request('GET', '/me', userProfileSchema);
  }

  setTimezone(timezone: string): Promise<UserProfile> {
    return this.request('PATCH', '/me', userProfileSchema, { body: { timezone } });
  }

  async logout(): Promise<void> {
    await this.request('POST', '/auth/logout', null);
  }

  async disconnectGoogle(): Promise<void> {
    await this.request('DELETE', '/me/google', null);
  }

  turn(body: TurnRequest): Promise<TurnResponse> {
    // The local AI can take a while, especially the first time it loads.
    return this.request('POST', '/assistant/turn', turnResponseSchema, { body, timeoutMs: 180_000 });
  }

  confirm(actionId: string, approve: boolean): Promise<TurnResponse> {
    return this.request('POST', `/assistant/actions/${encodeURIComponent(actionId)}/confirm`, turnResponseSchema, {
      body: { approve },
      timeoutMs: 60_000,
    });
  }

  undo(actionId: string): Promise<UndoResponse> {
    return this.request('POST', `/assistant/actions/${encodeURIComponent(actionId)}/undo`, undoResponseSchema, {
      timeoutMs: 60_000,
    });
  }

  activity(): Promise<ActivityResponse> {
    return this.request('GET', '/assistant/actions', activityResponseSchema);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Nest sends `{ message: string | string[] }` for errors. */
function errorMessage(json: unknown): string | null {
  const message = (json as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join('; ');
  return null;
}
