import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A random, URL-safe secret. 32 bytes = 256 bits, impossible to guess. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The PKCE "S256" challenge for a verifier (RFC 7636 section 4.2). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Compares two secrets without leaking how many characters matched. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts Google refresh tokens before they go into the database.
 * AES-256-GCM also detects tampering: decrypting a modified value throws.
 * Format: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.
 */
export class TokenCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('TokenCipher needs a 32-byte key');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), ciphertext].map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    ).join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext, ...rest] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || ciphertext === undefined || rest.length > 0) {
      throw new Error('Unrecognized encrypted token format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
