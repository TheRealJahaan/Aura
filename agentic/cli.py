"""Usage:
    python -m agentic.cli ask "Plan my week"
    python -m agentic.cli inbox        # triage unread Gmail and save draft replies
    python -m agentic.cli morning      # same, plus save the brief and show a notification
    python -m agentic.cli schedule --time 08:00   # run "morning" automatically every day
    python -m agentic.cli unschedule
    python -m agentic.cli rule ignore zebpay      # your own rules (Day 5)
    python -m agentic.cli rule remove zebpay
    python -m agentic.cli rules
    python -m agentic.cli jarvis --type           # Jarvis by typing (Day 7)
    python -m agentic.cli jarvis --enter          # press Enter and talk
    python -m agentic.cli jarvis                  # hands-free: say "Hey Jarvis" (Day 8)
    python -m agentic.cli jarvis --check          # what the microphone hears
    python -m agentic.cli history                 # what you said to Jarvis lately, on the Mac and the phone
    python -m agentic.cli app                     # the Jarvis server for the phone app (Day 10)
    python -m agentic.cli always-on               # run the server and ngrok by themselves (Day 11)
    python -m agentic.cli always-on --off
    python -m agentic.cli users                   # who signed in to the phone app
    python -m agentic.cli forget someone@gmail.com
    python -m agentic.cli costs
"""
import argparse
import os
import sys

import anthropic
import ollama

from .config import settings
from .llm import ask
from .store import connect, cost_summary


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="agentic")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_ask = sub.add_parser("ask", help="Ask the AI a question and log the call")
    p_ask.add_argument("prompt")
    p_inbox = sub.add_parser("inbox", help="Triage unread Gmail and save draft replies")
    p_inbox.add_argument("-n", type=int, default=10, help="How many unread emails to look at")
    p_morning = sub.add_parser("morning", help="Sort the inbox, save the brief, show a notification")
    p_morning.add_argument("-n", type=int, default=20, help="How many new unread emails to handle")
    p_schedule = sub.add_parser("schedule", help="Run the morning brief automatically every day")
    p_schedule.add_argument("--time", default="08:00", help="24-hour time, for example 08:00 or 19:30")
    sub.add_parser("unschedule", help="Stop the automatic morning brief")
    p_rule = sub.add_parser("rule", help="Add or remove a rule, e.g. 'rule ignore zebpay'")
    p_rule.add_argument("action", choices=["reply_now", "read_later", "ignore", "remove"])
    p_rule.add_argument("word", help="A word in the sender's name or email address")
    sub.add_parser("rules", help="List your rules")
    p_jarvis = sub.add_parser("jarvis", help="Talk to Jarvis, your Gmail voice assistant")
    mode = p_jarvis.add_mutually_exclusive_group()
    mode.add_argument("--type", action="store_true", help="Type instead of speaking")
    mode.add_argument("--enter", action="store_true", help="Press Enter to talk, no wake word or orb")
    mode.add_argument("--check", action="store_true", help="Test the microphone and the Hey Jarvis wake word")
    sub.add_parser("history", help="What you said to Jarvis lately and what it answered")
    p_app = sub.add_parser("app", help="Run the Jarvis server for the phone app")
    p_app.add_argument("--port", type=int, default=8000)
    p_always = sub.add_parser("always-on", help="Run the server and ngrok in the background whenever your Mac is on")
    p_always.add_argument("--off", action="store_true", help="Stop running them in the background")
    p_always.add_argument("--port", type=int, default=8000)
    sub.add_parser("users", help="Who has signed in to the phone app")
    p_forget = sub.add_parser("forget", help="Remove someone from the phone app and delete their data")
    p_forget.add_argument("email")
    sub.add_parser("costs", help="Show spend per day and agent")
    args = parser.parse_args(argv)

    if args.cmd == "ask":
        model = settings.ollama_model if settings.provider == "ollama" else settings.model
        print(f"(using {settings.provider}: {model})")
        if settings.provider == "claude" and not os.getenv("ANTHROPIC_API_KEY"):
            print("AGENTIC_PROVIDER is claude but ANTHROPIC_API_KEY is empty in .env. "
                  "Set AGENTIC_PROVIDER=ollama to use the free local model.", file=sys.stderr)
            return 1
        try:
            answer = ask(args.prompt)
        except anthropic.AuthenticationError:
            print("No valid API key. Put ANTHROPIC_API_KEY in your .env file.", file=sys.stderr)
            return 1
        except anthropic.RateLimitError:
            print("Rate limited. Wait a minute and try again.", file=sys.stderr)
            return 1
        except anthropic.APIConnectionError:
            print("Could not reach the Claude API. Check your internet connection.", file=sys.stderr)
            return 1
        except ConnectionError:
            print("Ollama isn't running. Open the Ollama app from Applications and try again.", file=sys.stderr)
            return 1
        except ollama.ResponseError as e:
            if e.status_code == 404:
                print(f"Model not downloaded. Run: ollama pull {settings.ollama_model}", file=sys.stderr)
                return 1
            raise
        print(answer.text)
        cost = "free" if answer.cost_usd == 0 else f"${answer.cost_usd:.4f}"
        print(f"\n[{answer.input_tokens} in / {answer.output_tokens} out tokens, {cost}]")
    elif args.cmd == "inbox":
        from .agents.inbox import triage

        try:
            print("Working through your inbox, one email at a time:")
            print("\n" + triage(args.n))
        except FileNotFoundError as e:
            print(e, file=sys.stderr)
            return 1
        except ConnectionError:
            print("Ollama isn't running. Open the Ollama app from Applications and try again.", file=sys.stderr)
            return 1
        except ollama.ResponseError as e:
            if e.status_code == 404:
                print(f"Model not downloaded. Run: ollama pull {settings.ollama_model}", file=sys.stderr)
                return 1
            raise
    elif args.cmd == "morning":
        from .morning import run_morning

        print(run_morning(args.n))
    elif args.cmd == "schedule":
        from .morning import install

        try:
            hour, minute = (int(part) for part in args.time.split(":"))
            assert 0 <= hour < 24 and 0 <= minute < 60
        except (ValueError, AssertionError):
            print("Use a 24-hour time like 08:00 or 19:30.", file=sys.stderr)
            return 1
        try:
            path = install(hour, minute)
        except RuntimeError as e:
            print(e, file=sys.stderr)
            return 1
        print(f"Scheduled: the inbox agent will run every day at {hour:02d}:{minute:02d}.")
        print(f"(macOS job file: {path})")
        print("Keep Ollama running. If your Mac is asleep at that time, it runs when the Mac wakes up.")
    elif args.cmd == "unschedule":
        from .morning import uninstall

        print("Stopped the daily run." if uninstall() else "Nothing was scheduled.")
    elif args.cmd == "rule":
        from .agents.inbox import LABELS
        from .rules import add_rule, remove_rule

        if not args.word.strip():
            print("Give a word from the sender, for example: rule ignore zebpay", file=sys.stderr)
            return 1
        if args.action == "remove":
            print(f"Removed the rule for \"{args.word}\"." if remove_rule(args.word) else f"No rule for \"{args.word}\".")
        else:
            add_rule(args.action, args.word)
            print(f"Saved: emails from senders containing \"{args.word.lower()}\" go to {LABELS[args.action]}.")
            print("This applies to new emails from the next run on.")
    elif args.cmd == "rules":
        from .agents.inbox import LABELS
        from .rules import load_rules

        rules = load_rules()
        if not rules:
            print("No rules yet. Add one with: python -m agentic.cli rule ignore zebpay")
        for category, word in rules:
            print(f"  {word:<20} -> {LABELS[category]}")
    elif args.cmd == "jarvis":
        from . import assistant

        try:
            if args.check:
                from .voice import mic_check

                mic_check()
            elif args.type:
                assistant.run_typed()
            elif args.enter:
                assistant.run_enter()
            else:
                assistant.run_hands_free()
        except ModuleNotFoundError as e:
            print(f"Missing package {e.name}. Run: pip install -r requirements.txt", file=sys.stderr)
            return 1
        except ConnectionError:
            print("Ollama isn't running. Open the Ollama app from Applications and try again.", file=sys.stderr)
            return 1
        except (KeyboardInterrupt, EOFError):
            print()
    elif args.cmd == "history":
        from .store import local_time, recent_turns

        rows = recent_turns(connect(settings.db_path), 20)
        if not rows:
            print("Nothing yet. Talk to Jarvis with: python -m agentic.cli jarvis")
        for ts, device, heard, said, _action in reversed(rows):
            print(f"{local_time(ts)} ({device})\n  You:    {heard}\n  Jarvis: {said}")
    elif args.cmd == "app":
        try:
            from .server import serve

            serve(args.port)
        except ModuleNotFoundError as e:
            print(f"Missing package {e.name}. Run: pip install -r requirements.txt", file=sys.stderr)
            return 1
        except ConnectionError:
            print("Ollama isn't running. Open the Ollama app from Applications and try again.", file=sys.stderr)
            return 1
    elif args.cmd == "always-on":
        from .always_on import install, uninstall

        if args.off:
            print("Stopped. Start the server and ngrok yourself again when you need them."
                  if uninstall() else "Always on wasn't set up.")
            return 0
        try:
            install(args.port)
        except RuntimeError as e:
            print(e, file=sys.stderr)
            return 1
        print(f"Jarvis is now always on at {settings.public_url}")
        print("The server and ngrok start when you log in and restart by themselves, and the Mac stays awake")
        print("while it's plugged in. Keep Ollama open. Logs are in data/logs. To stop: always-on --off")
    elif args.cmd == "users":
        from . import accounts

        rows = accounts.list_users(accounts.connect())
        if not rows:
            print("Nobody has signed in to the phone app yet.")
        for email, created, last_seen, phones in rows:
            used = last_seen[:16] if last_seen else "not yet"
            print(f"  {email:<34} {phones} phone(s)   signed in {created[:10]}   last used {used} (UTC)")
    elif args.cmd == "forget":
        from . import accounts

        if accounts.forget(accounts.connect(), args.email):
            print(f"Removed {args.email} from the phone app. Their Google sign-in is deleted from this Mac.")
        else:
            print(f"{args.email} hasn't signed in to the phone app.")
    else:
        rows = cost_summary(connect(settings.db_path))
        if not rows:
            print("No calls logged yet.")
        for day, agent, calls, tin, tout, usd in rows:
            print(f"{day}  {agent:<10} {calls:>4} calls  {tin:>8} in  {tout:>8} out  ${usd}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
