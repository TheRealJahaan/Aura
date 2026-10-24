"""SQLite memory for one Gmail account, in data/agentic.db:
every model call, the emails already sorted, and what you said to Jarvis and what it answered.
"""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

try:
    import fcntl  # file locks, on Mac and Linux
except ImportError:  # Windows
    fcntl = None

KEEP_DAYS = 30  # prompts, email text and conversations older than this are deleted

SCHEMA = """
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY,
    ts TEXT DEFAULT (datetime('now')),
    agent TEXT,
    model TEXT,
    prompt TEXT,
    response TEXT,
    stop_reason TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cost_usd REAL,
    latency_ms INTEGER
)
"""


# Emails the inbox agent has already handled, so it never sorts or drafts twice.
HANDLED_SCHEMA = """
CREATE TABLE IF NOT EXISTS handled_emails (
    message_id TEXT PRIMARY KEY,
    ts TEXT DEFAULT (datetime('now')),
    sender TEXT,
    subject TEXT,
    category TEXT,
    drafted INTEGER
)
"""

# Everything you said to Jarvis, on your Mac or your phone, and what it answered.
TURNS_SCHEMA = """
CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY,
    ts TEXT DEFAULT (datetime('now')),
    device TEXT,
    heard TEXT,
    said TEXT,
    action TEXT
)
"""

_tidied: set[str] = set()


def open_db(db_path: str, *schemas: str) -> sqlite3.Connection:
    """Open a SQLite database and create its tables the first time.

    WAL mode, and waiting up to 15 seconds when the database is busy, let your Mac, your phone and
    the 8:00 job use the same database at the same time without "database is locked" errors.
    """
    if db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    for schema in schemas:
        conn.executescript(schema)
    return conn


def connect(db_path: str) -> sqlite3.Connection:
    conn = open_db(db_path, SCHEMA, HANDLED_SCHEMA, TURNS_SCHEMA)
    if db_path not in _tidied:  # once per run is enough
        _tidied.add(db_path)
        tidy(conn)
    return conn


def tidy(conn: sqlite3.Connection, days: int = KEEP_DAYS) -> None:
    """Delete private text older than `days`: what the AI was asked and answered (your emails are in
    there) and the conversations. Token counts and costs stay for `costs`, and the list of sorted
    emails stays so none is sorted twice."""
    since = f"-{days} days"
    conn.execute(
        "UPDATE calls SET prompt = NULL, response = NULL WHERE prompt IS NOT NULL AND ts < datetime('now', ?)",
        (since,),
    )
    conn.execute("DELETE FROM turns WHERE ts < datetime('now', ?)", (since,))
    conn.commit()


@contextmanager
def one_at_a_time(db_path: str):
    """Only one inbox sort per account at once (the 8:00 job, your Mac or your phone), so no email gets
    two drafts. A second sort waits for the first to finish, then finds those emails already handled."""
    if fcntl is None or db_path == ":memory:":
        yield
        return
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with open(Path(db_path).with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def handled_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT message_id FROM handled_emails")}


def mark_handled(conn: sqlite3.Connection, message_id, sender, subject, category, drafted) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO handled_emails (message_id, sender, subject, category, drafted) VALUES (?, ?, ?, ?, ?)",
        (message_id, sender, subject, category, int(drafted)),
    )
    conn.commit()


def recent_handled(conn: sqlite3.Connection, category: str, hours: int = 24) -> list[tuple[str, str, str]]:
    """(message_id, sender, subject) of emails sorted into a category in the last few hours, newest first."""
    return conn.execute(
        "SELECT message_id, sender, subject FROM handled_emails WHERE category = ? AND ts >= datetime('now', ?) "
        "ORDER BY ts DESC",
        (category, f"-{hours} hours"),
    ).fetchall()


def log_turn(conn: sqlite3.Connection, device: str, heard: str, said: str, action: str) -> None:
    conn.execute("INSERT INTO turns (device, heard, said, action) VALUES (?, ?, ?, ?)", (device, heard, said, action))
    conn.commit()


def recent_turns(conn: sqlite3.Connection, n: int = 20) -> list[tuple[str, str, str, str, str]]:
    """(time in UTC, device, what you said, what Jarvis said, action) of the last n turns, newest first."""
    return conn.execute(
        "SELECT ts, device, heard, said, action FROM turns ORDER BY id DESC LIMIT ?", (n,)
    ).fetchall()


def local_time(utc: str) -> str:
    """A time as SQLite saves it ('2026-10-24 14:05:00', in UTC) in your Mac's time, like '24 Oct, 19:35'."""
    when = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc).astimezone()
    return f"{when.day} {when:%b, %H:%M}"


def log_call(conn: sqlite3.Connection, **row) -> None:
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    conn.execute(f"INSERT INTO calls ({cols}) VALUES ({marks})", tuple(row.values()))
    conn.commit()


def cost_summary(conn: sqlite3.Connection):
    return conn.execute(
        "SELECT date(ts), agent, COUNT(*), SUM(input_tokens), SUM(output_tokens), ROUND(SUM(cost_usd), 4) "
        "FROM calls GROUP BY date(ts), agent ORDER BY date(ts) DESC"
    ).fetchall()
