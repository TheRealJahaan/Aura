# Jarvis

A free, private Gmail assistant you talk to, on your Mac and on your Android phone.

Tap the floating orb and say "what's new?", "read my latest email" or "reply and say I'll call tomorrow".
Jarvis reads, sorts, drafts and sends your email, and it never sends or deletes anything until you say "yes".
The AI runs on your own Mac with [Ollama](https://ollama.com) (`qwen3:8b`), so your email never goes to an AI company and nothing costs money.

| Part | What it is |
| --- | --- |
| `agentic/` | Jarvis itself in Python: the Gmail tools, the inbox agent, your rules, the voice assistant and the server the phone talks to |
| `android/` | The Android app: Google sign-in, the floating orb and the voice loop |
| `tests/` | Tests that run without Gmail, Ollama or an API key (`python -m pytest -q`) |

The project was built in stages, one per day. Each section below explains one stage and how to set it up.

## Day 1: first Claude call with cost logging

Today's goal: one command that asks an AI model a question, and a log of every call with its token count and cost. Every later agent uses the same `ask()` function.

### Setup (about 15 minutes)

1. Install Python 3.10 or newer.
2. Install Ollama from https://ollama.com/download, open it, then run `ollama pull qwen3:8b` (use `qwen3:4b` on an 8 GB Mac). This is free and runs on your computer.
3. In this folder:

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # defaults to free Ollama; no key needed
```

### Try it

```bash
python -m agentic.cli ask "Give me a 5-step plan to organise my week"
python -m agentic.cli costs
python -m pytest -q              # runs without a key
```

### What is here

| File | Purpose |
| --- | --- |
| `agentic/config.py` | Model, effort level, database path, prices |
| `agentic/llm.py` | `ask()`: calls Ollama or Claude, logs the call |
| `agentic/store.py` | SQLite table `calls` with tokens, cost, latency |
| `agentic/cli.py` | `ask` and `costs` commands |
| `tests/` | Tests with a fake client, no API key needed |

Default provider is `ollama` (free, local). To use Claude instead, set `AGENTIC_PROVIDER=claude` and add `ANTHROPIC_API_KEY` in `.env`.

### Day 1 is done when

- [ ] `ask` prints an answer
- [ ] `costs` shows the call with its price
- [ ] tests pass

## Day 2: Gmail inbox agent

`python -m agentic.cli inbox -n 5` goes through your unread emails one at a time, sorts each into Reply now / Read later / Ignore, and saves draft replies in Gmail for the Reply now ones. It can never send email; you review and send the drafts yourself.

One-time setup: create `credentials.json` in Google Cloud (steps in the Day 2 guide) and put it in this folder. The first run opens your browser to approve access.

| File | Purpose |
| --- | --- |
| `agentic/gmail.py` | Gmail sign-in and the three tools: `list_unread`, `read_email`, `create_draft` |
| `agentic/agent.py` | A general agent loop (model picks a tool, we run it, repeat); kept for later agents |
| `agentic/agents/inbox.py` | The inbox workflow: our code fetches each email, the AI sorts it and writes replies |

## Day 3: Sorting inside Gmail

Each email the inbox agent handles now gets a Gmail label: **AI/Reply now**, **AI/Read later** or **AI/Ignore**. Emails stay unread and in your inbox; nothing is moved or deleted.

The agent remembers every email it has handled (table `handled_emails` in `data/agentic.db`), so running it again only looks at new mail and never drafts the same reply twice.

The first run after this update asks Google for one extra permission (adding labels), so your browser opens once more.

## Day 4: Runs by itself every morning

`python -m agentic.cli morning` does the same sorting as `inbox`, then saves the brief to `data/briefs/<date>.txt` and shows a Mac notification such as "2 to reply (drafts ready), 3 to read later, 10 ignored".

`python -m agentic.cli schedule --time 08:00` asks macOS to run `morning` every day at that time. `unschedule` stops it. Ollama has to be running. If the Mac is asleep at that time, the run happens when it wakes up.

macOS doesn't let background jobs open files in Downloads, Documents or Desktop, so keep this folder in your home folder (for example `~/agentic-ai`). After moving the folder, make the `.venv` again, because it remembers its old location:

```bash
mv ~/Downloads/agentic-ai ~/agentic-ai
cd ~/agentic-ai
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

| File | Purpose |
| --- | --- |
| `agentic/morning.py` | The daily run (brief file plus notification) and the macOS schedule |
| `data/briefs/` | One text file per day with every brief |
| `data/logs/` | What the scheduled run printed, for when something goes wrong |

## Day 5: Your own rules

Rules tell the inbox agent what to do with a sender, so you don't depend on the AI's guess:

```bash
python -m agentic.cli rule ignore zebpay          # always Ignore emails from ZebPay
python -m agentic.cli rule read_later linkedin    # LinkedIn always goes to Read later
python -m agentic.cli rule reply_now professor    # a sender you always answer
python -m agentic.cli rules                       # list your rules
python -m agentic.cli rule remove linkedin        # delete a rule
```

A rule matches when its word appears in the sender's name or email address. Our code checks your rules before the AI runs. An Ignore rule skips the AI completely, and any other rule still lets the AI write the summary (and the draft for Reply now) but your rule picks the group. Rules apply to new emails from the next run on.

Your rules are saved in `rules.txt` in this folder, one per line. You can also open it in TextEdit and edit it by hand.

| File | Purpose |
| --- | --- |
| `agentic/rules.py` | Reads and saves `rules.txt` and finds the rule for a sender |
| `rules.txt` | Your rules (created by the first `rule` command) |

## Days 6 to 8: Jarvis, your Gmail voice assistant

```bash
pip install -r requirements.txt     # Whisper, the microphone, the wake word and the orb window
python -m agentic.cli jarvis --type  # type to Jarvis; it answers out loud
python -m agentic.cli jarvis --enter # press Enter and talk; it stops listening when you stop talking
python -m agentic.cli jarvis         # hands-free: say "Hey Jarvis" and the orb appears
python -m agentic.cli jarvis --check # test the microphone and the wake word
```

Things you can say:

- "What's new?" sorts new emails, like the 8:00 run.
- "What are my unread emails?", "Any emails from Deloitte?", "Anything about my interview this week?"
- "Read the second one", "Read all of it", "When is the meeting?"
- "Reply saying I'll be there at 5", "Email Sam that I'm running late"
- "Archive it", "Mark it as read", "Delete it"
- "Who do I need to reply to?", "Always ignore Unstop", "What are my rules?"
- "Thanks, that's all" ends the conversation. Jarvis goes back to waiting for "Hey Jarvis".

Sending an email and moving one to Trash always wait for you to say "yes". If you say "no", or talk about something else, the email is saved in Drafts instead. To make Jarvis drafts-only and never delete, set `AGENTIC_ALLOW_SEND=false` in `.env`.

How it works:

1. **Ears:** two listeners wait for "Hey Jarvis" on your Mac. The openWakeWord model is instant but was trained on American voices, so Whisper is the backup: it writes down each short thing you say and Jarvis wakes if it sees "Jarvis". You can say it all at once ("Hey Jarvis, what's new?") or wait for the chime. Then Whisper turns your request into text, and recording stops when you've been quiet for about a second. Pressing Enter in Terminal also wakes Jarvis, and `jarvis --check` shows what the microphone hears.
2. **Brain:** the AI is a **router**. It reads your words plus what you were just talking about (the emails it listed, the one you opened) and picks one action as JSON, for example `{"action": "reply", "which": 2, "text": "I'll be there at 5"}`.
3. **Hands:** our code does the action with the Gmail tools, and the AI writes the summary or reply text when one is needed.
4. **Mouth:** the Mac's built-in `say` command reads the answer out loud.
5. **Face:** the orb (`orb.html`) is a small web page in a see-through window that floats at the bottom of your screen. It grows with your voice while listening, swirls while thinking and breathes while speaking.

The first runs download the Whisper model (about 150 MB) and the wake word (a few MB). macOS asks to let Terminal use the microphone. If you said no by mistake, go to System Settings, then Privacy & Security, then Microphone, and turn on Terminal. If Whisper mishears you, set `AGENTIC_WHISPER_MODEL=small.en` in `.env` (about 480 MB, better with accents).

| File | Purpose |
| --- | --- |
| `agentic/jarvis.py` | The brain: router, memory of the conversation, the Gmail actions, asking before send or Trash |
| `agentic/voice.py` | Ears and mouth: wake word, recording until you stop, Whisper, `say` |
| `agentic/orb.py`, `agentic/orb.html` | The Siri-style orb window |
| `agentic/assistant.py` | Runs Jarvis typed, with Enter, or hands-free |

## Day 10: Jarvis on your Android phone

Your Mac keeps doing the work (Ollama, Gmail, the database), and a small Android app is the face and voice:
a floating orb over your other apps and a notification with a Talk button. Tap, talk, and Jarvis answers out loud.

```
phone app  --your words-->  ngrok secure link  -->  Jarvis server on your Mac  -->  Gmail + Ollama
phone app  <--Jarvis's answer, spoken by the phone--------------------------------'
```

One-time setup:

1. **Secure link.** Make a free account at ngrok.com, install it (`brew install ngrok`), and save your token with
   `ngrok config add-authtoken <token>`. Your free domain is under Domains in the ngrok dashboard.
   College and office Wi-Fi often block ngrok; use home Wi-Fi or your phone's hotspot.
2. **Google sign-in for the phone.** In Google Cloud, go to Google Auth Platform, then Clients, then Create client.
   Pick **Web application** and add the redirect URI `https://<your-domain>/auth/callback`. Download the JSON and
   save it as `web_client.json` in this folder.
3. **Settings.** In `.env`, set `AGENTIC_PUBLIC_URL=https://<your-domain>` and `AGENTIC_YOUR_NAME=<your first name>`.
   Then `pip install -r requirements.txt` for the server packages.
4. **The app.** Open the `android` folder in Android Studio, connect your phone with USB debugging on, and press Run.
   In the app, check your Mac's address and tap Sign in with Google, then Start Jarvis.

Every time you want Jarvis on your phone, run these on your Mac in two Terminal windows:

```bash
python -m agentic.cli app                                    # the Jarvis server
ngrok http 127.0.0.1:8000 --url https://<your-domain>        # the secure link
```

Your data on the Mac, all in the `data` folder (never uploaded anywhere):

| Database | What's inside |
| --- | --- |
| `data/agentic.db` | Your Gmail account's memory: emails already sorted, every AI call and its cost, and everything you said to Jarvis (`history`) |
| `data/app.db` | Who signed in to the phone app with Google, and their phones. A phone's key is only stored as a fingerprint |
| `data/users/<email>/` | Anyone else who signs in to your server gets their own memory and rules here |

- The Google account your Mac uses shares `data/agentic.db` and `rules.txt` with the phone, so your rules work on
  both and no email is ever sorted or drafted twice. Only one inbox sort runs at a time.
- Your Mac, your phone and the 8:00 job can all use the databases at once (SQLite WAL mode).
- Private text (what the AI read and wrote, and your conversations) is deleted after 30 days. Costs and the list of
  sorted emails stay.
- `python -m agentic.cli users` shows who signed in, `forget <email>` removes someone, and `history` shows your
  recent conversations.
- Google ends sign-ins after 7 days while your Google app is in Testing. The phone then asks you to sign in again,
  and the 8:00 job leaves a note in its brief instead of getting stuck.

| File | Purpose |
| --- | --- |
| `agentic/server.py` | The Jarvis server: Google sign-in for phones, `/api/talk`, `/api/history` |
| `agentic/accounts.py` | The app database (`data/app.db`) and where each person's data lives |
| `agentic/store.py` | The Gmail memory database, its cleanup, and the one-sort-at-a-time lock |
| `android/` | The Android app: `MainActivity` (the screen), `JarvisService` (listen, think, speak), `Orb` (the floating orb), `Api` (talks to your Mac) |
