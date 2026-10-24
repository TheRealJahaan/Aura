from pathlib import Path

from agentic.agents.inbox import LABELS  # noqa: F401  (imports the module the morning run uses)
from agentic.gmail import GmailTools
from agentic.morning import plist_for, protected_folder, run_morning
from tests.test_inbox import FakeGmail, FakeSorter


def test_morning_saves_brief_file(tmp_path):
    briefs = tmp_path / "briefs"
    brief = run_morning(
        5,
        tools=GmailTools(FakeGmail()),
        briefs_dir=str(briefs),
        show_notification=False,
        client=FakeSorter("reply_now"),
        db_path=str(tmp_path / "t.db"),
        provider="ollama",
    )
    assert "Reply now (1)" in brief
    files = list(briefs.glob("*.txt"))
    assert len(files) == 1 and "Reply now (1)" in files[0].read_text()


def test_morning_records_failures_instead_of_crashing(tmp_path):
    class BrokenGmail(FakeGmail):
        def list(self, **kw):
            raise RuntimeError("Gmail is down")

    brief = run_morning(5, tools=GmailTools(BrokenGmail()), briefs_dir=str(tmp_path), show_notification=False,
                        db_path=str(tmp_path / "t.db"), provider="ollama")
    assert "failed" in brief and "Gmail is down" in brief


def test_schedule_runs_morning_command_daily(tmp_path):
    plist = plist_for(8, 30, python="/x/.venv/bin/python", project_dir=tmp_path)
    assert plist["ProgramArguments"] == ["/x/.venv/bin/python", "-m", "agentic.cli", "morning"]
    assert plist["StartCalendarInterval"] == {"Hour": 8, "Minute": 30}
    assert plist["WorkingDirectory"] == str(tmp_path)


def test_protected_folders_are_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    assert protected_folder(tmp_path / "Downloads" / "agentic-ai") == "Downloads"
    assert protected_folder(tmp_path / "agentic-ai") is None


def test_always_on_runs_server_ngrok_and_keeps_awake(tmp_path):
    from agentic.always_on import plists

    jobs = plists("https://me.ngrok-free.dev", "/opt/homebrew/bin/ngrok", python="/x/.venv/bin/python",
                  project_dir=tmp_path)
    assert jobs["server"]["ProgramArguments"] == ["/x/.venv/bin/python", "-m", "agentic.cli", "app", "--port", "8000"]
    assert jobs["ngrok"]["ProgramArguments"][:3] == ["/opt/homebrew/bin/ngrok", "http", "127.0.0.1:8000"]
    assert "https://me.ngrok-free.dev" in jobs["ngrok"]["ProgramArguments"]
    assert jobs["awake"]["ProgramArguments"] == ["/usr/bin/caffeinate", "-s"]
    for job in jobs.values():
        assert job["RunAtLoad"] and job["KeepAlive"]
        assert job["WorkingDirectory"] == str(tmp_path)
