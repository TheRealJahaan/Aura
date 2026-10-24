"""Day 10: the phone app's database, data/app.db. It keeps who signed in with Google, and their phones.

Each Google account's Gmail memory (sorted emails, AI calls, conversations) and rules stay apart:
- the Google account your Mac uses (data/token.json) shares data/agentic.db and rules.txt with Jarvis
  on the Mac, so your rules work on both and no email is sorted twice;
- anyone else who signs in to your Jarvis server gets their own folder, data/users/<their email>/.

A phone's key is saved only as a fingerprint (SHA-256), so this file can't be used to sign in a phone.
Google sign-ins are saved like data/token.json: the data folder stays on your Mac and never goes to GitHub.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
from pathlib import Path

from .config import settings
from .rules import RULES_FILE
from .store import open_db

USERS_DIR = Path("data") / "users"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT,
    google_token TEXT NOT NULL,
    created TEXT DEFAULT (datetime('now')),
    last_seen TEXT
);
CREATE TABLE IF NOT EXISTS phones (
    key_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    name TEXT,
    created TEXT DEFAULT (datetime('now')),
    last_used TEXT
);
CREATE TABLE IF NOT EXISTS sign_ins (
    state TEXT PRIMARY KEY,
    code_verifier TEXT,
    phone TEXT,
    created TEXT DEFAULT (datetime('now'))
);
"""


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or settings.app_db
    conn = open_db(path, SCHEMA)
    if path != ":memory:":
        os.chmod(path, 0o600)  # Google sign-ins are inside: only your Mac user can read it
    conn.execute("DELETE FROM sign_ins WHERE created < datetime('now', '-10 minutes')")  # unfinished sign-ins
    conn.commit()
    return conn


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


# Signing in ------------------------------------------------------------------


def start_sign_in(conn: sqlite3.Connection, state: str, code_verifier: str | None, phone: str) -> None:
    """Remember a sign-in while the person is on Google's page (for up to 10 minutes)."""
    conn.execute("INSERT OR REPLACE INTO sign_ins (state, code_verifier, phone) VALUES (?, ?, ?)",
                 (state, code_verifier, phone))
    conn.commit()


def finish_sign_in(conn: sqlite3.Connection, state: str) -> tuple[str | None, str] | None:
    """(code verifier, phone name) of a sign-in in progress, or None. Each sign-in can finish only once."""
    row = conn.execute("SELECT code_verifier, phone FROM sign_ins WHERE state = ?", (state,)).fetchone()
    conn.execute("DELETE FROM sign_ins WHERE state = ?", (state,))
    conn.commit()
    return row


def first_name(id_token: str | None) -> str:
    """The first name inside the token Google sends at sign-in, or "" if there isn't one."""
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("given_name", "")
    except (AttributeError, IndexError, ValueError):
        return ""


def allowed(email: str) -> bool:
    """AGENTIC_ALLOWED_EMAILS limits who may use your server. Empty = anyone Google lets in (your test users)."""
    listed = {e.strip().lower() for e in settings.allowed_emails.split(",") if e.strip()}
    return not listed or email.lower() in listed


def save_user(conn: sqlite3.Connection, email: str, name: str, google_token: str) -> None:
    conn.execute(
        "INSERT INTO users (email, name, google_token) VALUES (?, ?, ?) "
        "ON CONFLICT(email) DO UPDATE SET name = excluded.name, google_token = excluded.google_token",
        (email, name, google_token),
    )
    conn.commit()


def new_phone_key(conn: sqlite3.Connection, email: str, phone: str) -> str:
    """A new key for a phone. Only its fingerprint is saved here; the phone keeps the key."""
    key = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO phones (key_hash, email, name) VALUES (?, ?, ?)", (fingerprint(key), email, phone))
    conn.commit()
    return key


# Using the app ---------------------------------------------------------------


def email_for_key(conn: sqlite3.Connection, key: str) -> str | None:
    """Whose phone this key is, or None if the key is unknown or was signed out."""
    if not key:
        return None
    row = conn.execute("SELECT email FROM phones WHERE key_hash = ?", (fingerprint(key),)).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE phones SET last_used = datetime('now') WHERE key_hash = ?", (fingerprint(key),))
    conn.execute("UPDATE users SET last_seen = datetime('now') WHERE email = ?", (row[0],))
    conn.commit()
    return row[0]


def user(conn: sqlite3.Connection, email: str) -> tuple[str, str] | None:
    """(first name, Google sign-in) of someone who signed in, or None."""
    return conn.execute("SELECT name, google_token FROM users WHERE email = ?", (email,)).fetchone()


def sign_out(conn: sqlite3.Connection, key: str) -> bool:
    removed = conn.execute("DELETE FROM phones WHERE key_hash = ?", (fingerprint(key),)).rowcount
    conn.commit()
    return removed > 0


def list_users(conn: sqlite3.Connection) -> list[tuple[str, str, str | None, int]]:
    """(email, first sign-in, last used, number of phones) for everyone who signed in."""
    return conn.execute(
        "SELECT u.email, u.created, u.last_seen, COUNT(p.key_hash) FROM users u "
        "LEFT JOIN phones p ON p.email = u.email GROUP BY u.email ORDER BY u.created"
    ).fetchall()


def forget(conn: sqlite3.Connection, email: str) -> bool:
    """Remove someone from the app: their Google sign-in, their phones and, unless it's your Mac's own
    account, their folder of memory and rules."""
    email = email.strip().lower()
    removed = conn.execute("DELETE FROM users WHERE email = ?", (email,)).rowcount  # their phones go too
    conn.commit()
    if removed and email != mac_account():
        shutil.rmtree(user_folder(email), ignore_errors=True)
    return removed > 0


# Where each person's data lives ---------------------------------------------

_mac_account: str | None = None


def mac_account(token_path: str = "data/token.json") -> str | None:
    """The Gmail address Jarvis on this Mac uses (data/token.json), or None if the Mac isn't signed in."""
    global _mac_account
    if _mac_account is None and os.path.exists(token_path):
        from .gmail import get_service

        try:
            service = get_service(token_path=token_path, interactive=False)
            _mac_account = service.users().getProfile(userId="me").execute()["emailAddress"].lower()
        except Exception:  # signed out or offline: ask again next time
            return None
    return _mac_account


def user_folder(email: str) -> Path:
    safe = re.sub(r"[^a-z0-9@._+-]", "_", email.strip().lower())
    if not safe.strip("."):
        raise ValueError(f"Not an email address: {email!r}")
    return USERS_DIR / safe


def data_paths(email: str) -> tuple[str, str]:
    """(database, rules file) for this person's Gmail."""
    if email == mac_account():
        return settings.db_path, RULES_FILE
    folder = user_folder(email)
    folder.mkdir(parents=True, exist_ok=True)
    return str(folder / "agentic.db"), str(folder / "rules.txt")
