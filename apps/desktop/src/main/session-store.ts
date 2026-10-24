import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Electron's safeStorage: on a Mac it encrypts with a key kept in the Keychain. */
export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Keeps the Aura session token. It is encrypted on disk and never given to
 * the windows: only the main process talks to the API.
 */
export class SessionStore {
  private token: string | null = null;

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
  ) {}

  load(): string | null {
    if (this.token) return this.token;
    if (!this.encryptor.isEncryptionAvailable()) return null;
    try {
      this.token = this.encryptor.decryptString(readFileSync(this.file));
    } catch {
      this.token = null;
    }
    return this.token;
  }

  save(token: string): void {
    this.token = token;
    // Without encryption (some Linux setups) the token stays in memory only,
    // never as plain text on disk.
    if (!this.encryptor.isEncryptionAvailable()) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, this.encryptor.encryptString(token), { mode: 0o600 });
  }

  clear(): void {
    this.token = null;
    rmSync(this.file, { force: true });
  }
}
