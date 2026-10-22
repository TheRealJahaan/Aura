# Aura

Aura is a voice assistant for your laptop. Say "Aura listen", an animated orb appears at the edge of the screen, and Aura gets things done across your Google account: Calendar, Gmail, Tasks, Drive, Contacts and Meet.

> Status: week 1 of 6. Foundation only: API with health check, database schema, a placeholder app screen and CI.

## Learn how it's built

Each week comes with a lesson that explains every piece of code added:

- [Lesson 1: The foundation](docs/lessons/01-foundation.md) (monorepo, PostgreSQL and Prisma, NestJS, shared schemas, the app talking to the API, tests, CI)

## Architecture

```
apps/
  api/        NestJS + Prisma REST API (PostgreSQL)
  mobile/     Expo (React Native, TypeScript) app
packages/
  shared/     Zod schemas and types shared by the app and the API
infra/        Docker Compose for local PostgreSQL (pgvector)
```

## Getting started

Requirements: Node 22, Docker.

```bash
npm install
npm run db:up                                # PostgreSQL on localhost:5432
cp apps/api/.env.example apps/api/.env
npm run build -w packages/shared
npx -w apps/api prisma migrate dev           # apply migrations
npm run start:dev -w apps/api                # API on http://localhost:3000/health
npm start -w apps/mobile                     # Expo dev server
```

To open the app on your phone with Expo Go, copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL` to your computer's LAN IP.

## Checks

```bash
npm run typecheck
npm run lint
npm test                        # unit tests
npm run test:e2e -w apps/api    # needs the database running
```

## Roadmap

1. Foundation: monorepo, API, database, CI
2. Desktop app shell and the orb animation
3. Sign in with Google
4. Calendar and Gmail tools
5. The AI agent (Claude tool use)
6. Voice: speech-to-text and spoken replies
7. The "Aura listen" wake word
8. Tasks, Meet, Contacts and Drive, plus evals
9. Production: deploy, signed installers, auto-updates
10. Beta launch
