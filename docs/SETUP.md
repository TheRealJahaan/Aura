# Setting up Aura on your Mac

This takes about 20 minutes the first time. Everything here is free.

You'll set up five things:

1. The tools (Node, Docker, Ollama)
2. A free Google Cloud client, so Aura can sign in to your Google account
3. The API's `.env` file
4. The Mac app's `.env` file (optional: the wake word and voice)
5. First run

> **Never paste keys or secrets into a chat, an issue or a commit.** They go only in the `.env` files, and Git already ignores those.

---

## 1. Install the tools

| Tool | Why | Get it |
| --- | --- | --- |
| Node 22 | Runs the API and builds the app | [nodejs.org](https://nodejs.org) (or `nvm install 22`) |
| Docker Desktop | Runs the Postgres database | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Ollama | The free AI that runs on your Mac | [ollama.com](https://ollama.com) |

Then download the AI model. Pick by your Mac's memory ( > About This Mac):

```bash
ollama pull qwen3:8b     # 16 GB of memory or more (recommended)
ollama pull qwen3:4b     # 8 GB of memory
```

If you use `qwen3:4b`, set `OLLAMA_MODEL=qwen3:4b` in step 3.

Install the project:

```bash
git clone https://github.com/TheRealJahaan/Aura-Practice.git aura
cd aura
npm install                      # never use sudo with npm
npm run build -w packages/shared
```

## 2. Create your Google client (free)

Aura talks to Google with your own OAuth client, so your data goes straight from Google to your Mac.

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project (for example "Aura").
2. Go to **APIs & Services > Library** and enable each of these:
   - Gmail API
   - Google Calendar API
   - Google Tasks API
   - Google Drive API
   - People API (for contacts)
3. Go to **Google Auth Platform** (it may be called **OAuth consent screen**) and click **Get started**:
   - App name: `Aura`, support email: your email.
   - Audience: **External**.
   - Contact email: your email. Accept the policy and create.
4. Under **Audience**, add your own Gmail address as a **Test user**. Only test users can sign in while the app is in testing mode, which is exactly what you want for a personal assistant.
5. Under **Clients**, click **Create client**:
   - Application type: **Web application**
   - Name: `Aura local`
   - Authorized redirect URI: `http://127.0.0.1:3000/auth/google/callback`
6. Copy the **Client ID** and **Client secret** into the `.env` file in the next step. Don't share them.

What to expect when you sign in:

- Google shows a "Google hasn't verified this app" screen. That's normal for your own testing app. Click **Continue**.
- Tick every checkbox on the permissions screen. If you skip one, Aura's dashboard marks that service as "not allowed". To fix it, sign out and sign in again, and tick it this time.
- In testing mode Google makes you sign in again every **7 days**. That's a Google rule for unverified apps. When Aura says it lost access to Google, sign out and sign in again from the dashboard.

What Aura can access (the narrowest scopes that make each feature work):

| Service | Access |
| --- | --- |
| Gmail | Read emails, send emails (always after you confirm) |
| Calendar | Read and create events |
| Tasks | Read, add and complete tasks |
| Drive | File names only. Aura can't open or change your files |
| Contacts | Read-only, to find email addresses |

## 3. The API's `.env`

```bash
cp apps/api/.env.example apps/api/.env
open -e apps/api/.env
```

Fill in:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from step 2.
- `TOKEN_ENCRYPTION_KEY`: run `openssl rand -base64 32` in Terminal and paste the result. It encrypts your Google sign-in in the database. If you lose it, you just sign in again.

Leave the rest as it is. `DATABASE_URL` already points at the Docker database on port **5433** (not 5432, so it never clashes with a Postgres you may already have).

Start the database and create the tables:

```bash
npm run db:up
npm run db:migrate
```

### Optional: use Claude instead of the local AI

This costs money and sends your requests to Anthropic, so it's off by default. To try it, set `LLM_PROVIDER=anthropic` and add your own `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com) to `.env`.

## 4. The Mac app's `.env` (optional)

The app works without this file: press <kbd>⌥ Option</kbd> + <kbd>Space</kbd> to talk.

```bash
cp apps/desktop/.env.example apps/desktop/.env
open -e apps/desktop/.env
```

### Wake word (free)

1. Create a free account at [console.picovoice.ai](https://console.picovoice.ai).
2. Copy your **AccessKey** into `PICOVOICE_ACCESS_KEY`.
3. Now say **"Computer"** (the default built-in wake word) and the orb wakes up. Other built-in words: Jarvis, Bumblebee, Porcupine, Picovoice, Alexa, Hey Google, Hey Siri, Okay Google, Terminator, Americano, Blueberry, Grapefruit, Grasshopper.

Want **"Hey Aura"**? In the Picovoice Console, open **Porcupine**, type `Hey Aura`, choose the **Web (WASM)** platform, train it and download the `.ppn` file. Put its full path in `WAKE_WORD_PATH`, for example `WAKE_WORD_PATH=/Users/you/Documents/hey-aura_en_wasm_v4_0_0.ppn`.

If the orb wakes up by mistake, lower `WAKE_WORD_SENSITIVITY` (for example 0.4). If it doesn't hear you, raise it.

### Voice

- `AURA_VOICE`: leave empty for your system voice, or pick one from `say -v '?'` (for example `Samantha`). Better voices can be downloaded free in **System Settings > Accessibility > Spoken Content > System voice > Manage voices**.
- `AURA_SPEAK=off` turns spoken replies off.

### Speech to text

Whisper runs on your Mac. The first time you talk, Aura downloads the model once (about 290 MB) from Hugging Face. After that it works offline. On Intel Macs it uses a slower WebAssembly engine, so the smaller `Xenova/whisper-tiny.en` model may feel better there.

## 5. First run

Open two Terminal windows in the `aura` folder:

```bash
npm run api        # window 1: wait for "Aura API is running at http://127.0.0.1:3000"
npm run desktop    # window 2: Aura's icon appears in the menu bar
```

1. macOS asks for **microphone access**. Click **Allow**. (If you clicked Don't Allow: System Settings > Privacy & Security > Microphone, and turn on Electron.)
2. Click the menu bar icon and choose **Open Aura**. The dashboard shows a checklist: the API, the AI, Google and the wake word.
3. Click **Sign in with Google**. Your browser opens; sign in and allow access. The browser tab then says "You're signed in".
4. Say "Computer" (or press <kbd>⌥ Option</kbd> + <kbd>Space</kbd>) and try **"brief me"**.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "I can't reach Ollama" | Open the Ollama app (it lives in the menu bar). Check with `ollama list`. |
| "The model isn't downloaded" | Run `ollama pull qwen3:8b` (or the model in your `.env`). |
| `Error 400: redirect_uri_mismatch` | The redirect URI in step 2 must be exactly `http://127.0.0.1:3000/auth/google/callback`. |
| `Error 403: access_denied` | Add your Gmail address as a test user (step 2.4). |
| "The Gmail API is turned off" | Enable that API in step 2.2, wait a minute and try again. |
| Database errors when starting the API | Is Docker Desktop running? Run `npm run db:up`, then `npm run db:migrate`. |
| Port 3000 is taken | Set `PORT` and `PUBLIC_URL` in `apps/api/.env`, `AURA_API_URL` in `apps/desktop/.env`, and update the redirect URI in Google to match. |
| The wake word does nothing | Check the dashboard's wake word line. A wrong AccessKey or a `.ppn` made for a platform other than Web (WASM) shows an error there. |
| Aura heard the wrong words | Speak after the orb turns on, and try a quieter room. Whisper improves with a bigger model, such as `Xenova/whisper-small.en`. |
| Google stops working after a week | Normal in Google's testing mode. Sign out and sign in again from the dashboard. |
