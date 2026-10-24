"""Day 4: the inbox agent running on its own.

`run_morning` sorts the inbox, saves the brief to data/briefs/<date>.txt and shows a Mac
notification. `install` tells macOS (launchd) to run it every day at a set time.
"""
import json
import os
import plistlib
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from .agents.inbox import format_brief, sort_inbox
from .config import settings
from .gmail import GmailTools, SignInNeeded, get_service

PROJECT_DIR = Path(__file__).resolve().parent.parent
JOB_NAME = "com.agentic-ai.inbox"
PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{JOB_NAME}.plist"


def notify(title: str, message: str) -> None:
    """Show a macOS notification (does nothing on other systems)."""
    if sys.platform == "darwin":
        script = f"display notification {json.dumps(message)} with title {json.dumps(title)}"
        subprocess.run(["osascript", "-e", script], check=False)


def run_morning(n: int = 20, tools=None, briefs_dir: str | None = None, show_notification: bool = True, **kwargs) -> str:
    try:
        tools = tools or GmailTools(get_service(interactive=False))  # nobody is watching to sign in
        groups = sort_inbox(n, tools, **kwargs)
        brief = format_brief(groups, archived=settings.archive_ignored)
        if groups is None:
            summary = "No new emails since the last run."
        else:
            summary = (
                f"{len(groups['reply_now'])} to reply (drafts ready), "
                f"{len(groups['read_later'])} to read later, {len(groups['ignore'])} ignored"
            )
    except ConnectionError:
        brief = summary = "Couldn't reach Ollama. Open the Ollama app so the agent can run."
    except SignInNeeded as e:
        brief = summary = str(e)
    except Exception as e:  # a scheduled job has nobody watching, so record every failure
        brief = f"The inbox agent failed: {e!r}"
        summary = "The inbox agent failed. See today's brief in data/briefs."

    now = datetime.now()
    folder = Path(briefs_dir) if briefs_dir else PROJECT_DIR / "data" / "briefs"
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / f"{now:%Y-%m-%d}.txt", "a") as f:
        f.write(f"=== Inbox brief, {now:%H:%M} ===\n{brief}\n\n")
    if show_notification:
        notify("Inbox agent", summary)
    return brief


def plist_for(hour: int, minute: int, python: str = sys.executable, project_dir: Path = PROJECT_DIR) -> dict:
    logs = project_dir / "data" / "logs"
    return {
        "Label": JOB_NAME,
        "ProgramArguments": [python, "-m", "agentic.cli", "morning"],
        "WorkingDirectory": str(project_dir),
        "StartCalendarInterval": {"Hour": hour, "Minute": minute},
        "StandardOutPath": str(logs / "morning.log"),
        "StandardErrorPath": str(logs / "morning-error.log"),
    }


def protected_folder(project_dir: Path = PROJECT_DIR) -> str | None:
    """macOS blocks background jobs from Downloads, Documents and Desktop unless given extra permission."""
    for name in ("Downloads", "Documents", "Desktop"):
        if project_dir.is_relative_to(Path.home() / name):
            return name
    return None


def install(hour: int, minute: int) -> Path:
    if sys.platform != "darwin":
        raise RuntimeError("Scheduling uses macOS launchd, so it only works on a Mac.")
    if folder := protected_folder():
        raise RuntimeError(
            f"This project is inside your {folder} folder, where macOS won't let a background job run. "
            "Move the agentic-ai folder to your home folder first (see Day 4 in the README)."
        )
    (PROJECT_DIR / "data" / "logs").mkdir(parents=True, exist_ok=True)
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PLIST_PATH, "wb") as f:
        plistlib.dump(plist_for(hour, minute), f)
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", domain, str(PLIST_PATH)], capture_output=True)  # remove old copy
    subprocess.run(["launchctl", "bootstrap", domain, str(PLIST_PATH)], check=True)
    return PLIST_PATH


def uninstall() -> bool:
    if not PLIST_PATH.exists():
        return False
    subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(PLIST_PATH)], capture_output=True)
    PLIST_PATH.unlink()
    return True
