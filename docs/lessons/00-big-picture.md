# Lesson 0: The big picture

Read this before anything else. It explains **how Aura is being built** (the workflow a professional team uses) and **every concept the project touches**, from the moment you say "Aura listen" to the moment an email is sent. Later lessons go deep on each part; this one gives you the map.

---

## Part 1: What Aura is, in one picture

```
 ┌──────────────────────── YOUR LAPTOP ────────────────────────┐        ┌──────────── THE CLOUD ────────────┐
 │                                                              │        │                                   │
 │  Microphone ─▶ Wake-word model ("Aura listen"?)              │        │   Aura API (NestJS)               │
 │                     │ yes                                    │        │     ├─ Auth: who are you?         │
 │                     ▼                                        │  HTTPS │     ├─ Agent: Claude + tools      │──▶ Claude API
 │  Orb window wakes ─▶ stream your voice ──────────────────────┼───────▶│     ├─ Google tools ──────────────│──▶ Google Calendar,
 │                                                              │  WSS   │     │                             │    Gmail, Drive...
 │  Orb shows text + speaks the reply  ◀────────────────────────┼────────│     └─ PostgreSQL (users, tokens, │
 │                                                              │        │        conversations, action log) │
 │  Aura desktop app (Electron + React): login, settings, orb   │        │                                   │
 └──────────────────────────────────────────────────────────────┘        └───────────────────────────────────┘
```

There are four big pieces:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| **Desktop app** (frontend) | Your laptop | Login, settings, the orb animation, the microphone, the wake word |
| **API** (backend) | A cloud server | Knows who you are, holds your Google access, runs the AI agent |
| **Database** | Next to the API | Remembers users, encrypted Google tokens, conversations, every action Aura took |
| **External APIs** | Google's and Anthropic's servers | Google does the actual calendar/email work; Claude decides *what* to do |

**Key rule:** secrets (your Google tokens, the Claude API key) live **only on the backend**. The desktop app never sees them. If someone pulls apart the app on their laptop, they find nothing valuable.

---

## Part 2: How I'm building it (the professional workflow)

This is how real engineering teams work. Copy it for every project you do.

### 2.1 Plan first, then build in thin slices

We don't build "the frontend" and then "the backend". Each week we build a **thin vertical slice** that works end to end, even if it's small. Week 1's slice: app → API → database → back to the app, just for a health check. Every week adds a slice on top, and the project is always runnable.

### 2.2 Git and GitHub

| Concept | What it means | In Aura |
| --- | --- | --- |
| **Repository (repo)** | The project folder plus its full history | `TheRealJahaan/aura` |
| **Commit** | A saved snapshot with a message explaining *why* | `chore: scaffold Aura monorepo...` |
| **Branch** | A parallel line of work that doesn't disturb `main` | `week-1-foundation` |
| **`main`** | The branch that's always working and deployable | Only changes through PRs |
| **Pull request (PR)** | "Here's my branch, please review it and merge it into `main`" | PR #1, which you merged |
| **Merge** | Bringing a branch's commits into `main` | You clicked "Merge" |

The loop every change follows:

```
git checkout -b my-feature      # 1. new branch from main
# ...write code, run tests...
git add . && git commit -m "feat: add calendar tool"   # 2. commit
git push -u origin my-feature   # 3. push to GitHub
# 4. open a PR → CI runs → review → merge
git checkout main && git pull   # 5. update your local main
```

**Commit message convention** (Conventional Commits): `feat:` new feature, `fix:` bug fix, `chore:` setup/tooling, `docs:` documentation, `test:` tests, `refactor:` code change with no behaviour change.

### 2.3 CI: a robot that checks every PR

**Continuous Integration** = every push to a PR automatically runs typecheck, lint, tests and the build on a fresh machine (`.github/workflows/ci.yml`). If anything fails, the PR shows a red ✗ and we don't merge. That's how you know `main` always works.

### 2.4 Tests: the three kinds

| Kind | Tests what | Speed | Aura example |
| --- | --- | --- | --- |
| **Unit** | One function or class, with fakes for everything around it | Milliseconds | `HealthService` with a fake database |
| **Integration / e2e** | Real pieces wired together | Seconds | `GET /health` against a real Postgres |
| **Evals** (AI-specific) | How often the AI gets it right | Minutes | 50 spoken requests: did Aura call the right tool? |

### 2.5 Environment variables and secrets

Config that changes between your laptop, CI and production (database URL, API keys) goes in **environment variables**, never in code. Locally they live in a `.env` file, which is **git-ignored** so it never reaches GitHub. We commit a `.env.example` showing which variables exist, with no real values.

**Never paste an API key in chat, in code, or in a commit.** If a key leaks, revoke it immediately.

---

## Part 3: Every concept the project uses

Read each one now so that when a lesson uses the word, you already know it.

### 3.1 How computers talk: HTTP and REST

- **Client and server:** the client (desktop app) asks, the server (API) answers.
- **HTTP request** = method + URL + headers + optional body. **Response** = status code + headers + body.
- **Methods:** `GET` read, `POST` create, `PATCH` update, `DELETE` remove.
- **Status codes:** `200` OK, `201` created, `400` your request is wrong, `401` not logged in, `403` logged in but not allowed, `404` not found, `429` too many requests, `500` the server broke.
- **JSON** is the text format both sides speak: `{ "status": "ok" }`.
- **REST** is a style of designing URLs around things: `GET /conversations`, `GET /conversations/:id`, `DELETE /conversations/:id`.
- **HTTPS** = HTTP encrypted, so nobody on the Wi-Fi can read it. Always used in production.

### 3.2 Real-time: WebSockets and streaming

HTTP is one question, one answer. A voice assistant needs a **continuous two-way pipe**: audio flowing up while transcript and reply flow down. That's a **WebSocket** (`wss://`). **Streaming** means sending data in small chunks as soon as each is ready, instead of waiting for the whole thing. It's the single biggest reason Aura will feel fast.

### 3.3 Backend: NestJS

- **Controller** = the URL handlers. **Service** = the logic. **Module** = a feature's box.
- **Dependency injection:** classes ask for what they need in their constructor and Nest supplies it. That makes them easy to test with fakes.
- **DTO + validation:** every request body is checked against a schema before your code sees it. Never trust input.
- **Guards:** code that runs before a route and blocks it if you aren't logged in.

### 3.4 Databases: PostgreSQL and Prisma

- **Table, row, column**, **primary key** (unique ID), **foreign key** (points at a row in another table).
- **Relations:** one-to-one (user ↔ Google connection), one-to-many (user → conversations).
- **Index:** a lookup structure that makes a query fast, like a book's index.
- **Migration:** a versioned SQL change to the schema, committed to git.
- **ORM (Prisma):** write `prisma.user.findUnique(...)` in TypeScript instead of raw SQL, with full type safety.
- **Transactions:** several writes that all succeed or all fail together.

### 3.5 Authentication: who are you?

- **Authentication** = proving who you are. **Authorization** = what you're allowed to do.
- **OAuth 2.0** is how "Sign in with Google" works: Aura sends you to Google, you approve, and Google gives Aura a **code** that the backend swaps for tokens. Aura never sees your Google password.
- **Scopes** = exactly which permissions you granted (e.g. "read calendar", "send email"). We ask for the minimum we need.
- **Access token** = short-lived key (about 1 hour) for calling Google. **Refresh token** = long-lived key used to get new access tokens. It's precious, so we **encrypt** it before saving.
- **PKCE** = an extra step that makes OAuth safe for desktop apps, which can't keep a secret.
- **JWT** = a signed token our own API gives the desktop app after login, sent with every request to prove who you are.
- **Encryption at rest** = data is encrypted in the database (AES-256-GCM), with the key stored separately as a secret.

### 3.6 Frontend: Electron and React

- **React** builds UIs from **components** (functions that return what the screen shows) with **state** (data that changes) and **props** (data passed in). When state changes, React re-renders.
- **Hooks:** `useState` (remember a value), `useEffect` (do something after rendering, like fetching data).
- **Electron** = a Chromium browser + Node.js packaged as a desktop app. It has two kinds of processes:
  - **Main process** (Node.js): has full system access. It creates windows, the tray icon, global shortcuts and microphone permissions.
  - **Renderer process** (the web page): draws the UI with React. Locked down for security.
  - **IPC** (inter-process communication) is how they talk, through a small, safe **preload** bridge.
- **The orb** is a second window: transparent, frameless and always on top, so it floats at the edge of the screen.

### 3.7 Audio and voice

- **Sample rate:** how many times per second the mic is measured. Speech models typically use 16,000 (16 kHz).
- **PCM** = raw audio samples; we send small chunks of it (about 20 to 100 ms each).
- **Wake word / keyword spotting:** a tiny neural network that listens constantly for one phrase. It runs **on the device** so no audio leaves your laptop until it hears "Aura listen". We measure **false accepts** (wakes when you didn't say it) and **false rejects** (misses when you did).
- **VAD** (voice activity detection) = detecting when you've stopped talking, so Aura knows the request is finished.
- **STT** (speech-to-text) turns voice into text. **TTS** (text-to-speech) turns the reply into voice.

### 3.8 AI: LLMs, tool calling and agents

- An **LLM** (Claude) reads text and writes text. On its own it can't touch your calendar.
- **Tool calling:** we describe tools to Claude (name, description, input schema), for example `calendar_list_events(start, end)`. Claude replies "call this tool with these arguments", **our code** runs it, and we send the result back.
- **Agent loop:** repeat until done. Model → tool call → run it → result → model → maybe another tool → final answer. "Move my 3 pm to Friday" might be: list events → find a free slot Friday → update the event → reply.
- **System prompt:** the standing instructions that shape Aura's behaviour ("be brief, always confirm before sending email").
- **Tokens:** how LLM usage is measured and billed. Shorter prompts are cheaper and faster.
- **Guardrails:** the agent can call only the tools we allow, and risky ones (send, delete, share) need your confirmation.
- **Evals:** a fixed set of test requests we run after every change to measure accuracy, so we know a change made things better and not worse.

### 3.9 Google APIs

- Each service (Calendar, Gmail, Drive, Tasks, People) is a separate **REST API**, called with the user's access token.
- **Pagination:** big lists come in pages, and you follow `nextPageToken` to get more.
- **Rate limits / quotas:** Google limits how many calls you can make. On a `429` you **back off** (wait, then retry).
- **Verification:** apps using sensitive scopes like Gmail need Google's review before going public. In **testing mode**, up to 100 named test users can use the app without it.

### 3.10 Shipping it: deployment and operations

- **Deploy** = putting the API on a cloud server (Railway / Fly.io) that's always on, with a managed database.
- **CD** (continuous deployment) = merging to `main` automatically deploys.
- **Installers:** `.dmg` for Mac (must be **code-signed** and **notarized** by Apple, or macOS blocks it) and `.exe` for Windows.
- **Auto-update:** the app checks for new versions and updates itself.
- **Monitoring:** **Sentry** reports crashes with stack traces. **PostHog** tracks how people use the app (signups, daily users, retention).
- **Logs** tell you what happened. **Metrics** tell you how much and how fast (latency, error rate, cost per user).

### 3.11 Security and privacy (non-negotiable for an assistant that reads your email)

- Least privilege: request only the Google scopes we actually use.
- Encrypt tokens at rest; use HTTPS everywhere.
- Validate every input; never build SQL by hand from user text (Prisma protects us).
- Rate-limit the API so one user can't run up a huge bill.
- Keep an audit log so users can see exactly what Aura did.
- Write a clear privacy policy: what we store, what we don't, and how to delete your data.

---

## Part 4: The essentials checklist

You know the project well when you can explain each of these out loud, which is exactly what an interviewer will ask:

- [ ] Draw the architecture from memory and explain where each secret lives and why.
- [ ] Walk through what happens, step by step, from "Aura listen" to an email being sent.
- [ ] Explain the OAuth flow, and the difference between an access token and a refresh token.
- [ ] Explain tool calling and the agent loop, with a real example.
- [ ] Explain why the wake word runs on-device.
- [ ] Explain how you keep latency under 1.5 seconds (streaming at every step).
- [ ] Explain how you know the AI is accurate (evals) and how you keep costs down.
- [ ] Explain the Git → PR → CI → merge → deploy workflow.
- [ ] Name three security decisions and the threat each one stops.

---

## Part 5: How to learn alongside me

1. **Read the lesson for each week before you review its PR.** Every PR links its lesson.
2. **Run it locally.** Break things on purpose (stop the database, send a bad request) and watch what happens.
3. **Do the exercises yourself** on your own branch and open a PR. I'll review it like a senior teammate would.
4. **Ask "why" about anything.** Comment on any line in a PR on GitHub, or ask me in this thread.
5. **Keep a dev log:** one paragraph a week on what you built and what you learned. It becomes your LinkedIn posts and your interview stories.

## Glossary

| Term | Meaning |
| --- | --- |
| API | A program other programs talk to over HTTP |
| Endpoint | One URL + method the API answers, e.g. `GET /health` |
| Schema | The shape data must have (database tables, or Zod for JSON) |
| Monorepo | One repo holding several related projects |
| Workspace | One project inside the monorepo (`apps/api`) |
| Dependency | A library your code uses, listed in `package.json` |
| Lockfile | `package-lock.json`: the exact versions installed, so every machine matches |
| Build | Turning TypeScript into JavaScript that can run |
| Typecheck | The TypeScript compiler checking types without building |
| Lint | Automated code-style and mistake checks (ESLint) |
| Latency | How long something takes; p95 = 95% of requests are faster than this |
| Idempotent | Doing it twice has the same effect as once (important for retries) |
| Backoff | Waiting longer between each retry after a failure |
