// Settings for end-to-end tests. Real values from the environment win, so CI
// can point DATABASE_URL at its own Postgres.
process.env.DATABASE_URL ??= 'postgresql://aura:aura@localhost:5433/aura?schema=public';
process.env.GOOGLE_CLIENT_ID ??= 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
// Nothing listens here, so tests never reach a real AI by accident.
process.env.LLM_PROVIDER = 'ollama';
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
