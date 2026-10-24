import threading
import time

from agentic.store import connect, log_call, log_turn, one_at_a_time, recent_turns, tidy


def test_tidy_forgets_old_private_text_but_keeps_costs(tmp_path):
    conn = connect(str(tmp_path / "t.db"))
    log_call(conn, agent="inbox", prompt="old email text", response="old answer", cost_usd=0.5,
             ts="2020-01-01 08:00:00")
    log_call(conn, agent="inbox", prompt="new email text", response="new answer", cost_usd=0.25)
    log_turn(conn, "phone", "read my email", "From Sam...", "read_email")
    conn.execute("UPDATE turns SET ts = '2020-01-01 08:00:00'")
    log_turn(conn, "mac", "what's new", "No new emails.", "check_inbox")
    tidy(conn)
    calls = conn.execute("SELECT prompt, response, cost_usd FROM calls ORDER BY id").fetchall()
    assert calls == [(None, None, 0.5), ("new email text", "new answer", 0.25)]
    assert [row[2] for row in recent_turns(conn)] == ["what's new"]


def test_turns_newest_first(tmp_path):
    conn = connect(str(tmp_path / "t.db"))
    log_turn(conn, "mac", "first", "one", "help")
    log_turn(conn, "phone", "second", "two", "help")
    assert [(device, heard) for _, device, heard, _, _ in recent_turns(conn)] == [("phone", "second"), ("mac", "first")]


def test_database_allows_mac_phone_and_job_together(tmp_path):
    conn = connect(str(tmp_path / "t.db"))
    assert conn.execute("PRAGMA journal_mode").fetchone() == ("wal",)


def test_one_inbox_sort_at_a_time(tmp_path):
    db, order = str(tmp_path / "t.db"), []

    def second_sort():
        with one_at_a_time(db):
            order.append("second")

    with one_at_a_time(db):
        waiting = threading.Thread(target=second_sort)
        waiting.start()
        time.sleep(0.3)
        order.append("first")
    waiting.join(5)
    assert order == ["first", "second"]
