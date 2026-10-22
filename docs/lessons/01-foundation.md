# Lesson 1: The foundation

By the end of this lesson you will understand every file in the first commit of Aura, be able to run the whole stack on your laptop, and make your first change across the frontend, backend and database.

The lesson follows one request from start to finish: the app on your phone asks the API "are you healthy?", the API asks the database, and the answer travels back to the screen.

```
 Phone (Expo app)            API (NestJS)                     Database (PostgreSQL)
 ────────────────            ────────────                     ─────────────────────
 App.tsx                     HealthController  GET /health
   └─ fetchHealth() ──HTTP──▶   └─ HealthService.check()
                                     └─ prisma.$queryRaw ───SQL──▶  SELECT 1
                                     ◀────────────────────────────  1
   ◀──────JSON──────  { status: "ok", database: "up", ... }
 renders "API ok · database up"
```

---

## 1. The monorepo: one repo, three projects

```
aura/
  apps/api/         the backend (NestJS + Prisma)
  apps/mobile/      the frontend (Expo / React Native)
  packages/shared/  code both of them import (Zod schemas + TypeScript types)
  infra/            Docker Compose to run PostgreSQL locally
  .github/workflows the CI pipeline
```

**Why a monorepo?** The app and the API have to agree on what the data looks like. Keeping them in one repo means one pull request can change the API, the app and the shared types together, and CI tests all three at once.

**How it works:** the root `package.json` has a `workspaces` field. When you run `npm install` at the root, npm installs every project's dependencies into one shared `node_modules` and links `@aura/shared` so the other two can `import` it as if it were a published package.

Useful commands from the root:

| Command | What it does |
| --- | --- |
| `npm install` | Installs everything for all three projects |
| `npm run typecheck` | Runs the TypeScript compiler on every project without producing output |
| `npm test` | Runs every project's unit tests |
| `npm run start:dev -w apps/api` | `-w` runs a script inside one workspace |

---

## 2. The database: PostgreSQL and Prisma

### PostgreSQL

PostgreSQL is a relational database: data lives in **tables** (like spreadsheets), each **row** is one record, and **columns** have strict types. Tables point at each other with **foreign keys**, which is what "relational" means.

We run it locally with Docker so nobody has to install Postgres by hand. Look at `infra/docker-compose.yml`:

```yaml
postgres:
  image: pgvector/pgvector:pg16   # Postgres 16 with the pgvector extension (we'll use it for AI search later)
  environment:
    POSTGRES_USER: aura           # creates this user on first start
    POSTGRES_PASSWORD: aura
    POSTGRES_DB: aura
  ports:
    - "5432:5432"                 # your laptop's port 5432 → the container's port 5432
  volumes:
    - pgdata:/var/lib/postgresql/data   # keeps data when the container restarts
```

`npm run db:up` starts it. `npm run db:down` stops it.

### Prisma: the schema is the source of truth

Writing raw SQL for every query is slow and error-prone. **Prisma** is an ORM (object-relational mapper): you describe your tables once in `apps/api/prisma/schema.prisma`, and Prisma

1. generates SQL **migrations** that create or change the tables, and
2. generates a fully typed TypeScript **client**, so `prisma.conversation.findMany()` autocompletes and the compiler catches typos.

Read the schema top to bottom:

```prisma
model User {
  id        String   @id @default(uuid())  // primary key, random UUID
  email     String   @unique                // no two users share an email
  avatarUrl String?                         // ? = optional
  timezone  String   @default("Asia/Kolkata")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt             // Prisma sets this on every update

  google        GoogleConnection?           // zero or one Google account
  conversations Conversation[]              // one user → many conversations
  actions       ActionLog[]
}

model GoogleConnection {
  userId                String   @unique    // @unique makes this one-to-one with User
  scopes                String[]            // which Google services the user allowed
  encryptedRefreshToken String              // never stored in plain text
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  //          deleting a user deletes their Google connection too ─┘
}

model Conversation {                        // one "Aura listen" → orb closes
  userId   String
  messages Message[]
  @@index([userId, startedAt])              // makes "my recent conversations" fast
}

model ActionLog {
  tool   String        // "gmail.send", "calendar.createEvent"
  input  Json          // the exact arguments Aura used
  status ActionStatus  // PENDING_CONFIRMATION, SUCCEEDED, FAILED, CANCELLED
}
```

(Fields are trimmed here; open the file for the full version.)

Design decisions worth noticing, because interviewers ask about them:

- **UUIDs instead of 1, 2, 3 IDs.** They can't be guessed, so nobody can try `/conversations/5` to read someone else's data.
- **Google tokens live in their own table and are encrypted.** A refresh token is a long-lived key to someone's Gmail. If the database ever leaked, encrypted tokens are useless without the key, which lives somewhere else (an environment secret).
- **`ActionLog` records every action Aura takes.** Users can see exactly what was sent or changed on their behalf, and an assistant that acts on your email needs that kind of trust. The `PENDING_CONFIRMATION` status is how "Are you sure you want to send this?" works.
- **`input` is a `Json` column**, because every tool has different arguments: structured columns where the shape is fixed, JSON where it varies.
- **Indexes match the queries we'll run most.** Without them, Postgres scans every row in the table.

### Migrations

A migration is a SQL file that moves the database from one version of the schema to the next. Open `apps/api/prisma/migrations/<timestamp>_init/migration.sql` and you'll see the `CREATE TABLE` statements Prisma wrote for you.

- `npx prisma migrate dev --name <what-changed>`: on your laptop, after editing the schema. Creates a new migration file and applies it.
- `npx prisma migrate deploy`: in CI and production. Applies existing migrations and never creates new ones.

Migrations are committed to git, so every laptop, CI run and server builds exactly the same tables.

---

## 3. The backend: NestJS

The API is a program that listens for HTTP requests and answers with JSON. NestJS organises it into three kinds of pieces:

| Piece | Job | Example |
| --- | --- | --- |
| **Controller** | Maps a URL + HTTP method to a function. Knows about HTTP, nothing else. | `HealthController` handles `GET /health` |
| **Service** | The actual logic. Knows nothing about HTTP, so it's easy to test. | `HealthService.check()` |
| **Module** | Groups a feature's controllers and services together. | `HealthModule` |

### Start: `src/main.ts`

```ts
const app = await NestFactory.create(AppModule);  // build the app from the root module
app.enableShutdownHooks();                         // close DB connections cleanly on Ctrl+C or deploys
await app.listen(process.env.PORT ?? 3000);       // hosting platforms set PORT; locally it's 3000
```

### The root module: `src/app.module.ts`

```ts
@Module({ imports: [PrismaModule, HealthModule] })
export class AppModule {}
```

Every feature we add (Google sign-in, the AI agent, voice) becomes one more module in this list.

### Dependency injection, the most important NestJS idea

Look at the service's constructor:

```ts
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}
```

`HealthService` never writes `new PrismaService()`. It just **asks** for one in its constructor, and Nest **injects** the shared instance. Two big wins:

1. **One database connection pool** for the whole app instead of one per class.
2. **Testing is easy.** In a test we pass in a fake Prisma instead of a real database (you'll see this in section 6).

`PrismaModule` is marked `@Global()` and `exports: [PrismaService]`, so every module can inject it without importing it again.

### The controller: `src/health/health.controller.ts`

```ts
@Controller('health')          // every route in this class starts with /health
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()                       // GET /health
  check(): Promise<HealthResponse> {
    return this.health.check();  // Nest turns the returned object into JSON automatically
  }
}
```

### The service: `src/health/health.service.ts`

```ts
async check(): Promise<HealthResponse> {
  const database = await this.pingDatabase();
  return {
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    version,                                  // read from package.json
    uptimeSeconds: Math.round(process.uptime()),
  };
}

private async pingDatabase(): Promise<'up' | 'down'> {
  try {
    await this.prisma.$queryRaw`SELECT 1`;  // the cheapest possible query
    return 'up';
  } catch {
    return 'down';                          // the API stays up and reports the problem
  }
}
```

**Why a health check matters:** hosting platforms call `/health` every few seconds. If it fails, they restart the server or stop sending it traffic. Reporting the database separately tells you immediately whether the API or the database is the problem.

---

## 4. The contract: `packages/shared`

The API returns JSON and the app reads JSON. What stops them drifting apart, for example the API renaming `database` to `db` and the app silently breaking?

```ts
// packages/shared/src/health.ts
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
```

One definition gives us two things:

- **A TypeScript type** (`HealthResponse`) for compile time. The API's `check()` must return this shape, or `tsc` fails.
- **A Zod schema** (`healthResponseSchema`) for runtime. The app calls `.parse()` on the JSON it receives, so a bad response fails loudly in one place instead of crashing a random screen.

From week 2 on, every endpoint gets its request and response schemas here.

---

## 5. The frontend: Expo and React Native

> This small Expo screen is a stand-in so we can test the full request path now. In week 2 it gets replaced by the Aura desktop app (or grows into the Android app, depending on which platform comes first). The ideas in this section, like API calls, environment variables and loading/error states, carry over unchanged.

**React Native** lets you write the app once in TypeScript and React, and it renders real native iOS and Android views. **Expo** is the toolkit around it: the dev server, the Expo Go app for testing on your phone, and EAS for building store releases.

### API integration: `apps/mobile/src/api.ts`

```ts
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`);              // 1. send the HTTP request
  if (!res.ok) throw new Error(`Health check failed with ${res.status}`);  // 2. handle non-2xx
  return healthResponseSchema.parse(await res.json());       // 3. validate the JSON
}
```

- **Environment variables:** the API's address differs between your laptop, your phone and production, so it isn't hard-coded. Expo only exposes variables that start with `EXPO_PUBLIC_` to the app. Never put secrets in them, because anyone can read them from the app bundle.
- **`localhost` on a phone means the phone itself**, not your laptop. That's why `.env.example` says to use your laptop's LAN IP (for example `http://192.168.1.5:3000`) when testing with Expo Go.
- **All network code lives in `src/api.ts`**, not inside screens. Screens call functions; they don't build URLs.

### The screen: `apps/mobile/App.tsx`

```tsx
const [health, setHealth] = useState<HealthResponse | null>(null);  // the data
const [error, setError] = useState<string | null>(null);            // what went wrong

useEffect(() => {                  // runs once, after the first render
  fetchHealth()
    .then(setHealth)
    .catch((e: Error) => setError(e.message));
}, []);                            // [] = no dependencies, so it never re-runs
```

Every screen that loads data has the same **three states**: loading, success and error. The JSX shows one of them:

```tsx
{!health && !error && <ActivityIndicator />}          // loading
{health && <Text>API {health.status} ...</Text>}       // success
{error && <Text>API unreachable: {error}</Text>}       // error
```

In week 2 we'll replace this hand-written `useState` + `useEffect` with **TanStack Query**, which handles loading, errors, caching and retries for you. It's worth writing it by hand once first so you know what the library does.

---

## 6. Tests: proving it works

### Unit test: `src/health/health.service.spec.ts`

This tests the service with **no database**, thanks to dependency injection:

```ts
function serviceWith(queryRaw: jest.Mock) {
  return new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);  // a fake Prisma
}

it('reports degraded when the database is unreachable', async () => {
  const result = await serviceWith(jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))).check();
  expect(result.status).toBe('degraded');
});
```

Unit tests are fast (milliseconds) and test one piece of logic, including failures that are hard to cause for real.

### End-to-end test: `test/health.e2e-spec.ts`

This boots the **real** app against the **real** database and sends a real HTTP request with Supertest:

```ts
const res = await request(app.getHttpServer()).get('/health').expect(200);
expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
```

It's slower, but it catches what unit tests can't: wiring mistakes, wrong routes, migrations that don't match the code.

---

## 7. CI: GitHub Actions

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

1. Starts a throwaway PostgreSQL as a **service container**.
2. `npm ci`: installs exactly the versions in `package-lock.json`.
3. Builds `@aura/shared`, then runs typecheck, lint and unit tests.
4. Runs `prisma migrate deploy`, then the e2e tests.
5. Builds the API.

If any step fails, the PR shows a red ✗ and we don't merge. That's how a solo project stays healthy, and the green badge in the README is something recruiters notice.

---

## 8. Run it yourself

```bash
git clone https://github.com/TheRealJahaan/aura.git && cd aura
npm install
npm run db:up
cp apps/api/.env.example apps/api/.env
npm run build -w packages/shared
npx -w apps/api prisma migrate dev
npm run start:dev -w apps/api
```

Then open http://localhost:3000/health in your browser. You should see:

```json
{ "status": "ok", "database": "up", "version": "0.1.0", "uptimeSeconds": 4 }
```

Now run `npm run db:down` and refresh: it says `"degraded"` and `"down"`, but the API stays up. Start the database again with `npm run db:up`.

For the app, in a second terminal: `npm start -w apps/mobile`, then scan the QR code with Expo Go. Remember to set `EXPO_PUBLIC_API_URL` to your laptop's IP first.

Explore the database visually with `npx -w apps/api prisma studio`.

---

## 9. Your exercises

Do these yourself on a branch, then open a PR and I'll review it like a teammate would.

1. **Full-stack field (frontend + backend + shared).** Add `environment: string` to the health response, set from `process.env.NODE_ENV ?? 'development'`. Change the Zod schema, the service and the unit test, then show it on the app screen. Notice how `tsc` points you to every place that has to change.
2. **Database (schema + migration).** Add a `wakeWordSensitivity Float @default(0.5)` column to `User`. Run `prisma migrate dev --name wake-word-sensitivity` and read the SQL it generated.
3. **Test the failure path.** Write a unit test that checks `uptimeSeconds` is a whole number, and an e2e test that `GET /nope` returns 404.

## Check your understanding

1. Why does `HealthService` take `PrismaService` in its constructor instead of creating it?
2. What would break, and where would you find out, if the API renamed `database` to `db`?
3. Why can't the app on your phone reach `http://localhost:3000`?
4. When do you run `migrate dev`, and when `migrate deploy`?

**Next lesson (week 2):** the desktop app, covering how Electron works (the main process, the renderer and IPC between them), a tray icon, the login window, and the transparent orb window that will animate when you say "Aura listen".
