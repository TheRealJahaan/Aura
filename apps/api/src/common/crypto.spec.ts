import { createHash } from 'node:crypto';
import { pkceChallenge, randomToken, safeEqual, sha256Hex, TokenCipher } from './crypto';

describe('TokenCipher', () => {
  const cipher = new TokenCipher(Buffer.alloc(32, 1));

  it('round-trips a secret and never stores it in the clear', () => {
    const encrypted = cipher.encrypt('1//refresh-token');
    expect(encrypted).not.toContain('refresh-token');
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(encrypted)).toBe('1//refresh-token');
  });

  it('uses a fresh IV every time', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('detects tampering', () => {
    const [version, iv, tag, data] = cipher.encrypt('secret').split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => cipher.decrypt([version, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => cipher.decrypt([version, iv, tag.slice(0, 8), data].join('.'))).toThrow();
  });

  it('refuses the wrong key', () => {
    const other = new TokenCipher(Buffer.alloc(32, 2));
    expect(() => other.decrypt(cipher.encrypt('secret'))).toThrow();
  });

  it('rejects malformed values and bad keys', () => {
    expect(() => cipher.decrypt('plain-text')).toThrow('Unrecognized encrypted token format');
    expect(() => new TokenCipher(Buffer.alloc(16))).toThrow();
  });
});

describe('helpers', () => {
  it('makes long random tokens', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('computes the RFC 7636 example challenge', () => {
    // Appendix B of RFC 7636.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('hashes and compares', () => {
    expect(sha256Hex('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
