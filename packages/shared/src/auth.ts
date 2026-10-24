import { z } from 'zod';

// PKCE (RFC 7636): the desktop app keeps a random "verifier" secret and sends
// only its SHA-256 hash (the "challenge") when sign-in starts.
export const pkceVerifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9\-._~]{43,128}$/, 'must be a PKCE verifier (43-128 URL-safe characters)');

export const pkceChallengeSchema = z
  .string()
  .regex(/^[A-Za-z0-9\-_]{43}$/, 'must be a base64url SHA-256 hash');

export const loginStartQuerySchema = z.object({
  challenge: pkceChallengeSchema,
  port: z.coerce.number().int().min(1024).max(65535),
});

export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  timezone: z.string(),
  google: z.object({
    connected: z.boolean(),
    // Google services the user didn't allow on the consent screen.
    missingServices: z.array(z.string()),
  }),
});

export const tokenExchangeRequestSchema = z.object({
  code: z.string().min(20).max(200),
  verifier: pkceVerifierSchema,
});

export const tokenExchangeResponseSchema = z.object({
  token: z.string(),
  user: userProfileSchema,
});

export const updateProfileRequestSchema = z.object({
  timezone: z.string().min(1).max(64),
});

export type LoginStartQuery = z.infer<typeof loginStartQuerySchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type TokenExchangeRequest = z.infer<typeof tokenExchangeRequestSchema>;
export type TokenExchangeResponse = z.infer<typeof tokenExchangeResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
