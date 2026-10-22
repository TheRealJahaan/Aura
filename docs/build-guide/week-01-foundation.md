# Build guide, week 1: the foundation, from an empty folder

This guide rebuilds everything in week 1 **from nothing**, one command and one file at a time, with every line explained. Follow it top to bottom on your own laptop in a new folder (for example `aura-practice`), typing the code yourself rather than copying it. At the end you'll have the same project that's on `main`, and you'll be able to set up any full-stack TypeScript project like it on your own.

**What you'll have at the end:** a backend API that checks its own database, a PostgreSQL database with tables for users, Google connections, conversations, messages and an action log, an app screen that calls the API, shared types between them, automated tests, and CI on GitHub.

**Before you start, install:**

| Tool | Why | Check it's installed |
| --- | --- | --- |
| Node.js 22 | Runs JavaScript/TypeScript outside the browser; comes with `npm` | `node -v` → `v22.x` |
| Git | Version control | `git --version` |
| Docker Desktop | Runs PostgreSQL in a container, so you don't install it by hand | `docker -v` |
| VS Code | Editor with great TypeScript support | — |

---

## Step 1: Create the repo and the monorepo root

```bash
mkdir aura-practice && cd aura-practice   # make the project folder and go into it
git init -b main                          # start a git repo whose first branch is called "main"
```

### File: `package.json` (at the root)

The root `package.json` doesn't contain an app. It ties the three projects together.

```jsonc
{
  "name": "aura",                 // the project's name
  "private": true,                // never publish this folder to the npm registry by accident
  "workspaces": [                 // turns this repo into a monorepo:
    "apps/*",                     //   every folder in apps/ is a project (api, mobile)
    "packages/*"                  //   every folder in packages/ is a shared library (shared)
  ],
  "scripts": {                    // shortcuts you run with `npm run <name>`
    "build": "npm run build --workspaces --if-present",         // run "build" in every project that has one
    "lint": "npm run lint --workspaces --if-present",           // same for lint
    "typecheck": "npm run typecheck --workspaces --if-present", // same for typecheck
    "test": "npm run test --workspaces --if-present",           // same for test
    "db:up": "docker compose -f infra/docker-compose.yml up -d",  // start Postgres in the background (-d = detached)
    "db:down": "docker compose -f infra/docker-compose.yml down"  // stop it
  },
  "engines": {
    "node": ">=22"                // documents (and warns) which Node version the project needs
  }
}
```

> JSON doesn't allow comments. The `//` comments here are only for learning; leave them out of your real file.

**Why workspaces?** One `npm install` installs all three projects, and npm links `packages/shared` into `node_modules/@aura/shared`, so the API and the app can `import` from it like any package.

### File: `.gitignore`

Tells git which files must **never** be committed.

```gitignore
node_modules/   # installed libraries: huge, and anyone can recreate them with npm install
dist/           # compiled output: generated from the source, so don't store it
coverage/       # test coverage reports: generated
.env            # your real secrets (database password, API keys): NEVER commit
.env.*          # any other env file (.env.local, .env.production)...
!.env.example   # ...except .env.example (the ! re-includes it), which has no real values
.expo/          # Expo's local cache
*.log           # log files
.DS_Store       # macOS folder metadata
```

### File: `.nvmrc`

```
22
```

One line: the Node version. Tools like `nvm` (on your laptop) and `actions/setup-node` (in CI) read it, so everyone uses the same Node.

### File: `tsconfig.base.json`

Shared TypeScript settings that every project extends, so you write them once.

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",                       // which JavaScript version to output (modern Node supports ES2022)
    "strict": true,                           // turn on all strict type checks; catches the most bugs
    "esModuleInterop": true,                  // lets you write `import x from 'lib'` for older CommonJS libraries
    "skipLibCheck": true,                     // don't type-check libraries' .d.ts files (faster, avoids their bugs)
    "forceConsistentCasingInFileNames": true, // `./Health` vs `./health` is an error (Mac and Linux disagree on case)
    "resolveJsonModule": true                 // allows `import { version } from './package.json'`
  }
}
```

---

## Step 2: The database container

```bash
mkdir infra
```

### File: `infra/docker-compose.yml`

Docker Compose describes containers to run. We need one: PostgreSQL.

```yaml
services:                                   # each entry under services is one container
  postgres:                                 # our name for this container
    image: pgvector/pgvector:pg16           # the image to download: Postgres 16 with the pgvector extension
    environment:                            # settings the Postgres image reads the first time it starts
      POSTGRES_USER: aura                   #   creates a database user called "aura"
      POSTGRES_PASSWORD: aura               #   with this password (local only; real secrets go in .env)
      POSTGRES_DB: aura                     #   and an empty database called "aura"
    ports:
      - "5432:5432"                         # "laptop port:container port"; 5432 is Postgres's standard port
    volumes:
      - pgdata:/var/lib/postgresql/data     # store the data in a named volume so it survives restarts
    healthcheck:                            # how Docker knows Postgres is ready to accept connections
      test: ["CMD-SHELL", "pg_isready -U aura"]   # pg_isready is a Postgres tool that answers "ready?"
      interval: 5s                          # check every 5 seconds
      retries: 10                           # give up after 10 failed checks

volumes:
  pgdata:                                   # declares the named volume used above
```

Try it:

```bash
npm run db:up          # downloads the image the first time, then starts Postgres
docker ps              # you should see a container running on port 5432
```

---

## Step 3: The shared package (types used by both sides)

```bash
mkdir -p packages/shared/src
```

### File: `packages/shared/package.json`

```jsonc
{
  "name": "@aura/shared",          // the import name: import { ... } from '@aura/shared'
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",         // the file Node loads when someone imports this package (compiled JS)
  "types": "dist/index.d.ts",      // the file TypeScript reads for the types
  "scripts": {
    "build": "tsc -p tsconfig.json",               // compile src/ → dist/
    "typecheck": "tsc -p tsconfig.json --noEmit"   // check types only, write nothing
  }
}
```

### File: `packages/shared/tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",  // start from the shared settings
  "compilerOptions": {
    "module": "CommonJS",                 // output require()/module.exports, which the NestJS API uses
    "declaration": true,                  // also generate .d.ts type files so other projects get the types
    "outDir": "dist",                     // put compiled files here
    "rootDir": "src"                      // source files live here
  },
  "include": ["src"]                      // only compile what's in src/
}
```

### File: `packages/shared/src/health.ts`

```ts
import { z } from 'zod';                       // Zod: describe a data shape once, check it at runtime

export const healthResponseSchema = z.object({ // the shape of the JSON that GET /health returns
  status: z.enum(['ok', 'degraded']),          // must be exactly one of these two strings
  database: z.enum(['up', 'down']),
  version: z.string(),                         // any string, e.g. "0.1.0"
  uptimeSeconds: z.number().nonnegative(),     // a number that is 0 or more
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
// z.infer turns the schema into a TypeScript type, so we never write the shape twice. It equals:
// { status: 'ok' | 'degraded'; database: 'up' | 'down'; version: string; uptimeSeconds: number }
```

### File: `packages/shared/src/index.ts`

```ts
export * from './health';   // re-export everything, so users import from '@aura/shared', not deep file paths
```

Install and build it:

```bash
npm install -w packages/shared zod            # -w = install into this workspace only; adds zod to its dependencies
npm install -w packages/shared -D typescript  # -D = devDependency: needed to build, not at runtime
npm run build -w packages/shared              # creates packages/shared/dist/
```

---

## Step 4: The API (NestJS)

```bash
mkdir -p apps/api/src/health apps/api/src/prisma apps/api/prisma apps/api/test
```

### Install its packages

```bash
npm install -w apps/api @nestjs/common@11 @nestjs/core@11 @nestjs/platform-express@11 \
  @prisma/client@6 reflect-metadata rxjs @aura/shared@0.1.0
```

| Package | What it's for |
| --- | --- |
| `@nestjs/core`, `@nestjs/common` | The NestJS framework: modules, controllers, decorators like `@Get()` |
| `@nestjs/platform-express` | Nest runs on top of Express, the classic Node web server |
| `@prisma/client` | The generated, typed database client we query with |
| `reflect-metadata` | Lets decorators store type information; Nest's dependency injection needs it |
| `rxjs` | A streams library Nest uses internally |
| `@aura/shared` | Our own shared package (linked locally by the workspace) |

```bash
npm install -w apps/api -D @nestjs/cli@11 @nestjs/schematics@11 @nestjs/testing@11 prisma@6 \
  typescript@5 jest@29 ts-jest@29 @types/jest@29 supertest @types/supertest @types/node@22 \
  eslint@9 typescript-eslint
```

| Dev package | What it's for |
| --- | --- |
| `@nestjs/cli` | The `nest build` and `nest start --watch` commands |
| `@nestjs/testing` | Builds a Nest app inside tests |
| `prisma` | The CLI: `prisma migrate`, `prisma generate`, `prisma studio` |
| `typescript` | The compiler |
| `jest`, `ts-jest`, `@types/jest` | The test runner, running TypeScript tests directly, with types for `describe`/`it`/`expect` |
| `supertest` | Sends real HTTP requests to the app in tests |
| `@types/node` | Types for Node built-ins like `process` |
| `eslint`, `typescript-eslint` | The linter, which finds mistakes and bad patterns |

### File: `apps/api/package.json` (the scripts and Jest parts you add by hand)

`npm install` already wrote `dependencies` and `devDependencies`. Add these sections:

```jsonc
{
  "name": "@aura/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",                              // compile to dist/
    "start": "node dist/main.js",                       // run the compiled app (production)
    "start:dev": "nest start --watch",                  // run and auto-restart when you save a file
    "typecheck": "tsc --noEmit",
    "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\"",  // lint every .ts file in src and test
    "test": "jest",                                     // unit tests (config below)
    "test:e2e": "jest --config test/jest-e2e.json",     // end-to-end tests (separate config)
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "postinstall": "prisma generate"                    // runs automatically after every npm install,
                                                        // so the typed Prisma client always exists
  },
  "jest": {                                             // unit test configuration
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",                                   // look for tests in src/
    "testRegex": ".*\\.spec\\.ts$",                     // a test file is anything ending in .spec.ts
    "transform": { "^.+\\.ts$": "ts-jest" },            // run .ts files through ts-jest
    "testEnvironment": "node"                           // run in Node, not a fake browser
  }
}
```

> Add `postinstall` **after** the first install. If you add it before, npm tries to run `prisma` before it's installed and fails. (That happened while building Aura.)

### File: `apps/api/tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",            // find imports the way Node does (node_modules folders)
    "outDir": "dist",
    "rootDir": ".",
    "experimentalDecorators": true,        // allow @Controller(), @Get(), @Injectable()
    "emitDecoratorMetadata": true,         // record constructor parameter types; this is how Nest knows
                                           // HealthService needs a PrismaService
    "sourceMap": true,                     // errors point at your .ts lines, not the compiled .js
    "strictPropertyInitialization": false  // Nest sets some class properties after construction
  },
  "include": ["src", "test"]               // typecheck the source and the tests
}
```

### File: `apps/api/tsconfig.build.json`

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },  // when building, src/ is the root, so output is dist/main.js
  "include": ["src"],                       // build only the source...
  "exclude": ["**/*.spec.ts"]               // ...and never ship test files
}
```

### File: `apps/api/nest-cli.json`

```jsonc
{
  "$schema": "https://json.schemastore.org/nest-cli",  // gives VS Code autocomplete for this file
  "collection": "@nestjs/schematics",                  // code generators for `nest generate`
  "sourceRoot": "src",
  "compilerOptions": {
    "tsConfigPath": "tsconfig.build.json",             // use the build config
    "deleteOutDir": true                               // wipe dist/ before each build so old files don't linger
  }
}
```

### File: `apps/api/eslint.config.mjs`

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },            // don't lint compiled output
  ...tseslint.configs.recommended,     // the recommended TypeScript rules
);
```

### File: `apps/api/.env.example`

```bash
DATABASE_URL=postgresql://aura:aura@localhost:5432/aura?schema=public
#            protocol    user pass host      port db   which schema inside the db
PORT=3000
```

Copy it to the real file, which git ignores:

```bash
cp apps/api/.env.example apps/api/.env
```

---

## Step 5: The database schema with Prisma

### File: `apps/api/prisma/schema.prisma`

```prisma
generator client {                // what Prisma generates...
  provider = "prisma-client-js"   // ...a JavaScript/TypeScript client
}

datasource db {                   // which database to talk to
  provider = "postgresql"
  url      = env("DATABASE_URL")  // read from the environment / .env, never hard-coded
}

model User {                                // becomes a "User" table
  id        String   @id @default(uuid())   // primary key; Postgres generates a random UUID
  email     String   @unique                // unique index: two users can't share an email
  name      String?                         // ? = optional (can be NULL)
  avatarUrl String?
  timezone  String   @default("Asia/Kolkata")  // default value if none is given
  createdAt DateTime @default(now())        // set automatically when the row is created
  updatedAt DateTime @updatedAt             // Prisma updates this on every change

  google        GoogleConnection?           // relation: a user has zero or one Google connection
  conversations Conversation[]              // relation: a user has many conversations
  actions       ActionLog[]                 // relation: a user has many logged actions
}
// The three relation fields above aren't columns. They let you write
// prisma.user.findUnique({ include: { conversations: true } }).

model GoogleConnection {
  id                    String   @id @default(uuid())
  userId                String   @unique  // foreign key; @unique makes the relation one-to-one
  googleSub             String   @unique  // Google's permanent ID for the account ("sub" = subject)
  scopes                String[]          // Postgres array: the permissions the user granted
  encryptedRefreshToken String            // the API encrypts the token before saving it
  connectedAt           DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  //    links userId → User.id; deleting the user deletes this row too
}

model Conversation {
  id        String   @id @default(uuid())
  userId    String
  startedAt DateTime @default(now())

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages Message[]

  @@index([userId, startedAt])   // index on two columns: fast "this user's conversations, newest first"
}

enum MessageRole {               // a fixed set of allowed values (a Postgres enum type)
  USER
  ASSISTANT
}

model Message {
  id             String      @id @default(uuid())
  conversationId String
  role           MessageRole // who said it
  text           String
  createdAt      DateTime    @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])  // fast "messages in this conversation, in order"
}

enum ActionStatus {
  PENDING_CONFIRMATION   // waiting for the user to say "yes, send it"
  SUCCEEDED
  FAILED
  CANCELLED
}

model ActionLog {
  id        String       @id @default(uuid())
  userId    String
  tool      String       // which tool ran, e.g. "gmail.send"
  input     Json         // its arguments; a JSON column because every tool's arguments differ
  status    ActionStatus
  error     String?      // the error message if it failed
  createdAt DateTime     @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}
```

Create the tables:

```bash
npm run db:up                                   # make sure Postgres is running
cd apps/api
npx prisma migrate dev --name init              # 1. writes prisma/migrations/<time>_init/migration.sql
                                                # 2. runs it against the database
                                                # 3. regenerates the typed client
npx prisma studio                               # optional: opens a browser UI to see the tables
cd ../..
```

Open `migration.sql` and read it. You'll see the `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE ... FOREIGN KEY` statements Prisma wrote from your schema.

---

## Step 6: The API code

### File: `apps/api/src/main.ts` (the entry point: the file Node runs first)

```ts
import { NestFactory } from '@nestjs/core';   // Nest's app builder
import { AppModule } from './app.module';     // the root module (next file)

async function bootstrap() {                  // async because starting the server takes time
  const app = await NestFactory.create(AppModule);  // build the app: create every module, controller, service
  app.enableShutdownHooks();                  // on Ctrl+C or a deploy restart, run cleanup hooks
                                              // (like closing database connections) before exiting
  await app.listen(process.env.PORT ?? 3000); // listen for HTTP on PORT if set (hosting platforms set it),
                                              // otherwise 3000. ?? means "if the left side is null/undefined"
}

void bootstrap();                             // call it; `void` says "I'm deliberately not awaiting this"
```

### File: `apps/api/src/app.module.ts` (the root module)

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({                                 // @Module marks a class as a Nest module
  imports: [PrismaModule, HealthModule],  // the feature modules this app is made of
})
export class AppModule {}                 // the class body is empty: the decorator does all the work
```

### File: `apps/api/src/prisma/prisma.service.ts`

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';   // the client generated from schema.prisma

@Injectable()                                    // Nest may create this class and inject it elsewhere
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // `extends PrismaClient`: this class IS a Prisma client, so it has .user, .conversation, $queryRaw...
  // `implements OnModuleDestroy`: promises to have the method below, which Nest calls on shutdown

  async onModuleDestroy() {
    await this.$disconnect();                    // close the database connection pool cleanly
  }
}
```

### File: `apps/api/src/prisma/prisma.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()                     // available to every module without importing PrismaModule each time
@Module({
  providers: [PrismaService], // Nest creates ONE PrismaService (one connection pool for the whole app)
  exports: [PrismaService],   // and lets other modules inject it
})
export class PrismaModule {}
```

### File: `apps/api/src/health/health.service.ts` (the logic)

```ts
import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@aura/shared';   // `import type`: types only, removed after compiling
import { PrismaService } from '../prisma/prisma.service';
import { version } from '../../package.json';          // read "version" from apps/api/package.json

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}
  // Dependency injection: we ASK for a PrismaService and Nest passes in the shared one.
  // `private readonly prisma` is shorthand: it declares a field and assigns the argument to it.

  async check(): Promise<HealthResponse> {            // must return the shared shape, or tsc fails
    const database = await this.pingDatabase();       // 'up' or 'down'
    return {
      status: database === 'up' ? 'ok' : 'degraded',  // ternary: condition ? if-true : if-false
      database,                                       // shorthand for database: database
      version,
      uptimeSeconds: Math.round(process.uptime()),    // seconds since the process started
    };
  }

  private async pingDatabase(): Promise<'up' | 'down'> {  // private: only this class can call it
    try {
      await this.prisma.$queryRaw`SELECT 1`;          // the cheapest query there is; succeeds if the DB answers
      return 'up';
    } catch {                                         // any error (DB stopped, wrong password, network)...
      return 'down';                                  // ...is reported, not thrown, so the API stays up
    }
  }
}
```

### File: `apps/api/src/health/health.controller.ts` (the HTTP layer)

```ts
import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@aura/shared';
import { HealthService } from './health.service';

@Controller('health')                  // all routes in this class start with /health
export class HealthController {
  constructor(private readonly health: HealthService) {}   // inject the service

  @Get()                               // handles GET /health (the path is '' added to 'health')
  check(): Promise<HealthResponse> {
    return this.health.check();        // Nest awaits the promise and sends the object as JSON with status 200
  }
}
```

**Why split controller and service?** The controller knows about HTTP; the service knows about logic. Later, the same service logic can be called from a WebSocket or a background job without touching HTTP.

### File: `apps/api/src/health/health.module.ts`

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],  // register the routes
  providers: [HealthService],       // register the service so it can be injected into the controller
})
export class HealthModule {}
```

Run it:

```bash
npm run start:dev -w apps/api
# open http://localhost:3000/health
# → {"status":"ok","database":"up","version":"0.1.0","uptimeSeconds":3}
npm run db:down        # stop the database and refresh: "degraded" / "down", and the API stays up
npm run db:up
```

---

## Step 7: Tests

### File: `apps/api/src/health/health.service.spec.ts` (unit test: no database needed)

```ts
import { healthResponseSchema } from '@aura/shared';
import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';

function serviceWith(queryRaw: jest.Mock) {           // helper: build the service with a FAKE Prisma
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);
  // The fake object only has $queryRaw. `as unknown as PrismaService` tells TypeScript
  // "trust me, treat this as a PrismaService"; acceptable in tests, never in real code.
}

describe('HealthService', () => {                      // groups related tests
  it('reports ok when the database answers', async () => {        // one test case
    const result = await serviceWith(jest.fn().mockResolvedValue([1])).check();
    // jest.fn() makes a fake function; mockResolvedValue makes it return a resolved promise

    expect(healthResponseSchema.parse(result)).toEqual(result);   // the output matches the shared contract
    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
  });

  it('reports degraded when the database is unreachable', async () => {
    const result = await serviceWith(jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))).check();
    // mockRejectedValue makes the fake throw, simulating a dead database without stopping a real one

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
  });
});
```

### File: `apps/api/test/jest-e2e.json`

```jsonc
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",                       // look in test/
  "testRegex": ".e2e-spec.ts$",         // e2e test files end in .e2e-spec.ts
  "transform": { "^.+\\.ts$": "ts-jest" },
  "testEnvironment": "node"
}
```

### File: `apps/api/test/health.e2e-spec.ts` (end-to-end: the real app and the real database)

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GET /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {                                  // runs once before the tests in this file
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();               // the full real app...
    await app.init();                                      // ...started in memory (no port needed)
  });

  afterAll(async () => {
    await app.close();                                     // shut down so Jest can exit
  });

  it('returns ok with the database up', async () => {
    const res = await request(app.getHttpServer())         // supertest sends a real HTTP request
      .get('/health')
      .expect(200);                                        // fail unless the status code is 200
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });  // checks only these keys
  });
});
```

Run all checks:

```bash
npm test                        # unit tests
npm run test:e2e -w apps/api    # e2e (needs the database running)
npm run typecheck
npm run lint
```

---

## Step 8: The app screen (Expo)

```bash
npx create-expo-app@latest apps/mobile --template blank-typescript --no-install
# Generates a blank React Native + TypeScript app. --no-install: the root npm install will handle it.
```

Then edit `apps/mobile/package.json`: set `"name": "@aura/mobile"`, add `"typecheck": "tsc --noEmit"` to `scripts`, and add `"@aura/shared": "^0.1.0"` to `dependencies`.

In `apps/mobile/app.json`, set `"name": "Aura"` (shown under the app icon), `"slug": "aura"` (the URL-safe name Expo uses), and the unique app IDs `"bundleIdentifier": "com.therealjahaan.aura"` (iOS) and `"package": "com.therealjahaan.aura"` (Android). The stores use these IDs to identify your app forever.

### File: `apps/mobile/.env.example`

```bash
# Use your computer's LAN IP when testing on a phone with Expo Go
EXPO_PUBLIC_API_URL=http://localhost:3000
```

### File: `apps/mobile/src/api.ts` (every network call lives here)

```ts
import { healthResponseSchema, type HealthResponse } from '@aura/shared';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
// Expo copies EXPO_PUBLIC_* variables into the app at build time. They're PUBLIC: never put secrets here.

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`);      // send GET /health; template string builds the URL
  if (!res.ok) throw new Error(`Health check failed with ${res.status}`);  // res.ok = status 200–299
  return healthResponseSchema.parse(await res.json());
  // res.json() parses the body; .parse() throws if it doesn't match the contract,
  // so bad data fails here, in one place, instead of crashing a screen later
}
```

### File: `apps/mobile/App.tsx` (the screen)

```tsx
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
// View = a box (like <div>), Text = text (all text must be inside <Text>), ActivityIndicator = a spinner
import type { HealthResponse } from '@aura/shared';
import { fetchHealth } from './src/api';

export default function App() {                       // a component is a function that returns UI
  const [health, setHealth] = useState<HealthResponse | null>(null);  // state: the data, null until loaded
  const [error, setError] = useState<string | null>(null);            // state: an error message, if any
  // useState returns [current value, function to change it]. Calling the setter re-renders the screen.

  useEffect(() => {                                   // run this after the first render
    fetchHealth()
      .then(setHealth)                                // success → store the data → re-render
      .catch((e: Error) => setError(e.message));      // failure → store the message → re-render
  }, []);                                             // [] = dependencies; empty means "run once"

  return (                                            // JSX: HTML-like syntax that becomes native views
    <View style={styles.container}>
      <Text style={styles.title}>Aura</Text>
      <Text style={styles.subtitle}>Your Google account, by voice.</Text>
      {!health && !error && <ActivityIndicator />}    {/* loading: no data and no error yet */}
      {health && (                                    /* success: `a && b` renders b only if a is truthy */
        <Text style={styles.status}>
          API {health.status} · database {health.database} · v{health.version}
        </Text>
      )}
      {error && <Text style={[styles.status, styles.error]}>API unreachable: {error}</Text>}
      {/* an array of styles merges them; later ones win */}
      <StatusBar style="auto" />                      {/* the phone's top bar adapts to light/dark */}
    </View>
  );
}

const styles = StyleSheet.create({                    // styles look like CSS but in camelCase JS objects
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  // flex: 1 = fill the screen; alignItems/justifyContent = center horizontally and vertically
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 16, opacity: 0.7 },
  status: { fontSize: 14 },
  error: { color: '#c62828' },
});
```

Install everything and run the app:

```bash
npm install                     # from the root: installs the mobile app's packages too
npm run typecheck
npm start -w apps/mobile        # scan the QR code with the Expo Go app on your phone
```

On a phone, `localhost` means the phone itself. Create `apps/mobile/.env` with `EXPO_PUBLIC_API_URL=http://<your laptop's IP>:3000` (find the IP with `ipconfig` on Windows or `ipconfig getifaddr en0` on Mac).

---

## Step 9: CI with GitHub Actions

```bash
mkdir -p .github/workflows
```

### File: `.github/workflows/ci.yml`

```yaml
name: CI                                   # shown in the GitHub "Actions" tab

on:                                        # WHEN to run
  pull_request:                            #   on every PR
  push:
    branches: [main]                       #   and on every push to main (e.g. after a merge)

jobs:
  check:                                   # one job called "check"
    runs-on: ubuntu-latest                 # a fresh Linux machine from GitHub, every time
    services:                              # extra containers running alongside the job
      postgres:
        image: pgvector/pgvector:pg16      # same image as local, so tests match your laptop
        env:
          POSTGRES_USER: aura
          POSTGRES_PASSWORD: aura
          POSTGRES_DB: aura
        ports:
          - 5432:5432
        options: >-                        # wait until Postgres is healthy before running steps
          --health-cmd "pg_isready -U aura"
          --health-interval 5s
          --health-retries 10
    env:                                   # environment variables for every step
      DATABASE_URL: postgresql://aura:aura@localhost:5432/aura?schema=public
    steps:                                 # run in order; if one fails, the job stops and goes red
      - uses: actions/checkout@v4          # download the repo's code
      - uses: actions/setup-node@v4        # install Node...
        with:
          node-version-file: .nvmrc        # ...at the version in .nvmrc
          cache: npm                       # cache downloads between runs (faster)
      - run: npm ci                        # clean install of EXACTLY what package-lock.json lists
      - run: npm run build -w packages/shared   # the others import its compiled output
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - name: Migrate database
        run: npx prisma migrate deploy     # apply committed migrations (never creates new ones)
        working-directory: apps/api
      - name: API e2e tests
        run: npm run test:e2e -w apps/api
      - name: Build API
        run: npm run build -w apps/api     # proves the production build works
```

`npm ci` vs `npm install`: `install` may update the lockfile; `ci` refuses to and installs it exactly. Always use `ci` in automation.

---

## Step 10: Commit and push

```bash
git add .                                         # stage every new and changed file (respecting .gitignore)
git status                                        # ALWAYS check: no .env, no node_modules in the list
git commit -m "chore: scaffold monorepo with API, database, app shell and CI"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/aura-practice.git   # tell git where GitHub's copy lives
git push -u origin main                           # upload; -u remembers origin/main for future pushes
```

Open the repo's **Actions** tab and watch CI go green.

---

## Every file you created, in one list

```
aura-practice/
├── package.json                 workspaces + root scripts
├── package-lock.json            generated by npm: exact versions
├── .gitignore  .nvmrc  tsconfig.base.json
├── infra/docker-compose.yml     local PostgreSQL
├── packages/shared/
│   ├── package.json  tsconfig.json
│   └── src/index.ts  src/health.ts        the shared contract
├── apps/api/
│   ├── package.json  tsconfig.json  tsconfig.build.json  nest-cli.json  eslint.config.mjs  .env.example
│   ├── prisma/schema.prisma  prisma/migrations/…   the database
│   ├── src/main.ts  src/app.module.ts
│   ├── src/prisma/prisma.service.ts  prisma.module.ts
│   ├── src/health/health.controller.ts  health.service.ts  health.module.ts  health.service.spec.ts
│   └── test/jest-e2e.json  test/health.e2e-spec.ts
├── apps/mobile/                 generated by create-expo-app, plus:
│   ├── src/api.ts  App.tsx  .env.example   (and edits to package.json, app.json)
└── .github/workflows/ci.yml
```

## Reuse this on your next project

The same skeleton works for almost any full-stack app. To start a new one:

1. Steps 1–3 unchanged (root, database, shared package), renaming `aura`.
2. Step 4–6: keep `main.ts`, `app.module.ts` and the Prisma files; replace the schema with your own models; keep the health module, since every deployed service needs one.
3. Step 7: copy the test setup; write one unit test per service and one e2e test per endpoint.
4. Step 8: swap in whatever frontend you need (Expo, Next.js, Electron); keep the `src/api.ts` + shared-schema pattern.
5. Step 9: the CI file works as is.

**Next week's guide:** the Aura desktop app (Electron + React), built file by file: the main process, the preload bridge, the login window, the tray icon, and the transparent orb window with its animation.
