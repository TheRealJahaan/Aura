# Contributing to Aura

Thanks for helping. Aura aims to be the best free, private assistant for your Google account, and every fix, idea and test helps.

## Getting set up

Follow [docs/SETUP.md](docs/SETUP.md) to run Aura locally. To read the code, start with [Lesson 2: How Aura works](docs/lessons/02-how-aura-works.md).

## Making a change

1. Fork the repository and create a branch: `git checkout -b my-change`.
2. Make your change, and add or update tests next to it.
3. Run the checks:
   ```bash
   npm run build -w packages/shared
   npm run typecheck
   npm run lint
   npm test
   npm run test:e2e -w apps/api      # needs `npm run db:up`
   npm run test:ui -w apps/desktop   # first time: npx playwright install chromium
   ```
4. Open a pull request and fill in the template.

## Guidelines

- **Free first.** Every feature must work with the free, local setup (Ollama, Whisper, macOS voices). Paid services can only be optional.
- **Ask before acting outward.** A new tool that reaches other people (email, invites, sharing) must use `risk: 'external'`, so the user confirms it. A tool that changes something should return an `undo` when it can.
- **Narrowest Google scopes.** If you need a new scope, explain why in the pull request.
- **Treat outside text as data.** Email bodies, event descriptions and file names come from other people. Pass them to the AI as untrusted fields, never as instructions.
- **Write for the ear.** A tool's `say` sentence is read aloud, so keep it short and natural ("You have 3 meetings today", not a list of IDs).
- **Never commit secrets.** `.env` files stay local.

## Adding a tool

1. Create it with `defineTool` in `apps/api/src/assistant/tools/` (see `tasks.tools.ts` for a short example).
2. Add it to the list in `apps/api/src/assistant/tools/registry.ts`.
3. Add unit tests with the fakes in `apps/api/test/fakes.ts`.
4. If people will say it often, add a quick command in `intents.ts`.

## Reporting bugs and ideas

Open an issue with the matching template. For security problems, follow [SECURITY.md](SECURITY.md) instead.
