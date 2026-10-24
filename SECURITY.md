# Security

Aura reads your email and acts in your Google account, so security comes first.

## Reporting a problem

Please **don't open a public issue** for a security problem. Use GitHub's private reporting instead: the **Security** tab of this repository > **Report a vulnerability**. If that button isn't there, contact the maintainer through their GitHub profile and ask for a private channel. Include what you found, how to reproduce it and what an attacker could do with it. You'll get a reply as soon as possible.

## How Aura protects you

**Your data stays on your Mac.** The API listens only on `127.0.0.1`. By default the AI (Ollama) and speech-to-text (Whisper) run locally too. Your data goes to an outside AI service only if you switch on the optional Claude provider yourself.

**Sign-in**
- Google sign-in happens in your browser on Google's own page, using loopback + PKCE ([RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252), [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)). Aura never sees your password.
- The Google refresh token is encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`).
- Session tokens are random 256-bit values. The database stores only their SHA-256 hash.
- The Mac app keeps its session token encrypted with the macOS Keychain (Electron `safeStorage`), in the main process only. Web pages never see it.
- **Disconnect Google** revokes the token at Google, deletes it and signs out every device.

**Least privilege.** Aura asks for the narrowest Google scopes that make each feature work. Drive is metadata-only, and Contacts is read-only.

**The AI can't act alone**
- Anything that reaches other people (sending an email, inviting guests) needs your explicit "yes", tied to your account and usable only once.
- Email text is passed to the AI as untrusted data, and the system prompt tells it never to follow instructions inside it.
- Tool inputs are validated with Zod before anything runs.
- Aura opens only `https://` Google pages. Any other link is refused.

**The Mac app**
- Renderer pages run with `contextIsolation`, `sandbox` and no Node.js access, behind a strict Content Security Policy.
- Each IPC call checks it comes from an Aura page and validates its arguments.
- App pages are served from a custom `aura://` protocol that refuses paths outside the app folder.
- Microphone access is granted only to Aura's own pages.
- Spoken text is passed to `say` on standard input, never through a shell.

## What you should do

- Never commit `.env` files or paste keys into chats or issues. `.gitignore` already excludes `.env`.
- Keep your Google OAuth client in testing mode with only yourself as a test user, unless you go through Google's verification.
- If a key leaks, rotate it: create a new client secret in Google Cloud, a new Picovoice AccessKey, or a new `TOKEN_ENCRYPTION_KEY` (then sign in again).
