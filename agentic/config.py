import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # "ollama" runs a free model on your Mac; "claude" uses the paid Claude API.
    provider: str = os.getenv("AGENTIC_PROVIDER", "ollama")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen3:8b")
    model: str = os.getenv("AGENTIC_MODEL", "claude-opus-5-5")
    effort: str = os.getenv("AGENTIC_EFFORT", "medium")
    db_path: str = os.getenv("AGENTIC_DB", "data/agentic.db")
    # Your first name, so Jarvis knows who it works for and can sign your replies.
    your_name: str = os.getenv("AGENTIC_YOUR_NAME", "")
    # Move Ignore emails out of the inbox. They keep the AI/Ignore label; nothing is deleted.
    archive_ignored: bool = os.getenv("AGENTIC_ARCHIVE_IGNORED", "false").lower() == "true"
    # Let Jarvis send emails and move them to Trash, always after asking you first. false = drafts only.
    allow_send: bool = os.getenv("AGENTIC_ALLOW_SEND", "true").lower() == "true"
    # How sure the wake-word model must be that it heard "Hey Jarvis" (0 to 1). Lower = wakes more easily.
    wake_threshold: float = float(os.getenv("AGENTIC_WAKE_THRESHOLD", "0.5"))
    # The Jarvis server for the phone app (Days 10+). public_url is the address your phone uses.
    public_url: str = os.getenv("AGENTIC_PUBLIC_URL", "http://localhost:8000").rstrip("/")
    web_client: str = os.getenv("AGENTIC_GOOGLE_WEB_CLIENT", "web_client.json")
    app_db: str = os.getenv("AGENTIC_APP_DB", "data/app.db")  # who signed in to the phone app
    # Who may sign in to the app, comma separated. Empty = anyone Google lets in (your test users).
    allowed_emails: str = os.getenv("AGENTIC_ALLOWED_EMAILS", "")
    # Speech-to-text model for voice. "base.en" is a ~150 MB download; "small.en" (~480 MB) hears accents better.
    whisper_model: str = os.getenv("AGENTIC_WHISPER_MODEL", "base.en")


settings = Settings()


def person(name: str | None = None) -> str:
    """Who the agents work for: the name from the phone app's Google sign-in, AGENTIC_YOUR_NAME, or "the user"."""
    return name or settings.your_name or "the user"

# USD per million tokens: (input, output, cache read). Source: Anthropic pricing, Oct 2026.
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),  # cache read approximate
}
