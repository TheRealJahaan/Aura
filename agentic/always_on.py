"""Day 11: Jarvis always on. Your Mac runs the phone server and ngrok by itself, with no Terminal windows.

`install` gives macOS (launchd) three background jobs that start when you log in and restart if they stop:
- the Jarvis server (`python -m agentic.cli app`),
- ngrok, the secure link your phone uses,
- `caffeinate -s`, which keeps the Mac awake while it's plugged in (closing the lid still makes it sleep).
`uninstall` removes them. What they print goes to data/logs.
"""
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

from .config import settings
from .morning import PROJECT_DIR, protected_folder

LAUNCH_AGENTS = Path.home() / "Library" / "LaunchAgents"
JOBS = ("server", "ngrok", "awake")
NGROK_PLACES = ("/opt/homebrew/bin/ngrok", "/usr/local/bin/ngrok")


def job_name(job: str) -> str:
    return f"com.agentic-ai.{job}"


def find_ngrok() -> str | None:
    """Background jobs don't get your Terminal's PATH, so they need ngrok's full path."""
    return shutil.which("ngrok") or next((p for p in NGROK_PLACES if os.path.exists(p)), None)


def plists(public_url: str, ngrok: str, port: int = 8000, python: str = sys.executable,
           project_dir: Path = PROJECT_DIR) -> dict[str, dict]:
    logs = project_dir / "data" / "logs"
    commands = {
        "server": [python, "-m", "agentic.cli", "app", "--port", str(port)],
        "ngrok": [ngrok, "http", f"127.0.0.1:{port}", "--url", public_url, "--log", "stdout"],
        "awake": ["/usr/bin/caffeinate", "-s"],
    }
    return {
        job: {
            "Label": job_name(job),
            "ProgramArguments": command,
            "WorkingDirectory": str(project_dir),
            "RunAtLoad": True,  # start when you log in
            "KeepAlive": True,  # start again if it stops, for example when Ollama wasn't open yet
            "ThrottleInterval": 20,  # wait 20 seconds between restarts
            "EnvironmentVariables": {"PYTHONUNBUFFERED": "1"},  # logs appear right away
            "StandardOutPath": str(logs / f"{job}.log"),
            "StandardErrorPath": str(logs / f"{job}-error.log"),
        }
        for job, command in commands.items()
    }


def install(port: int = 8000) -> None:
    if sys.platform != "darwin":
        raise RuntimeError("Always on uses macOS launchd, so it only works on a Mac.")
    if folder := protected_folder():
        raise RuntimeError(
            f"This project is inside your {folder} folder, where macOS won't let a background job run. "
            "Move the agentic-ai folder to your home folder first (see Day 4 in the README)."
        )
    if not settings.public_url.startswith("https://"):
        raise RuntimeError("Set AGENTIC_PUBLIC_URL=https://<your-domain> in .env first (see Day 10 in the README).")
    ngrok = find_ngrok()
    if ngrok is None:
        raise RuntimeError("ngrok isn't installed. Run: brew install ngrok (see Day 10 in the README).")
    (PROJECT_DIR / "data" / "logs").mkdir(parents=True, exist_ok=True)
    LAUNCH_AGENTS.mkdir(parents=True, exist_ok=True)
    domain = f"gui/{os.getuid()}"
    for job, plist in plists(settings.public_url, ngrok, port).items():
        path = LAUNCH_AGENTS / f"{job_name(job)}.plist"
        with open(path, "wb") as f:
            plistlib.dump(plist, f)
        subprocess.run(["launchctl", "bootout", domain, str(path)], capture_output=True)  # remove old copy
        subprocess.run(["launchctl", "bootstrap", domain, str(path)], check=True)


def uninstall() -> bool:
    removed = False
    for job in JOBS:
        path = LAUNCH_AGENTS / f"{job_name(job)}.plist"
        if path.exists():
            subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(path)], capture_output=True)
            path.unlink()
            removed = True
    return removed
