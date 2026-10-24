import base64
import json

import pytest

from agentic import accounts
from agentic.config import Settings


def id_token(**claims):
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


def test_phone_key_is_saved_only_as_a_fingerprint(tmp_path):
    conn = accounts.connect(str(tmp_path / "app.db"))
    accounts.save_user(conn, "sam@example.com", "Sam", '{"refresh_token": "r"}')
    key = accounts.new_phone_key(conn, "sam@example.com", "Pixel 8")
    assert accounts.email_for_key(conn, key) == "sam@example.com"
    assert accounts.email_for_key(conn, "wrong key") is None and accounts.email_for_key(conn, "") is None
    conn.close()
    assert key.encode() not in (tmp_path / "app.db").read_bytes()


def test_sign_out_and_forget(tmp_path):
    conn = accounts.connect(str(tmp_path / "app.db"))
    accounts.save_user(conn, "sam@example.com", "Sam", "{}")
    first, second = (accounts.new_phone_key(conn, "sam@example.com", p) for p in ("Pixel", "Galaxy"))
    assert accounts.sign_out(conn, first) and accounts.email_for_key(conn, first) is None
    assert accounts.list_users(conn)[0][3] == 1  # one phone left

    db_path, _ = accounts.data_paths("sam@example.com")
    assert accounts.forget(conn, "Sam@Example.com")
    assert accounts.email_for_key(conn, second) is None and accounts.list_users(conn) == []
    assert not accounts.user_folder("sam@example.com").exists()
    assert not accounts.forget(conn, "nobody@example.com")


def test_your_macs_account_shares_the_mac_memory_and_rules(monkeypatch):
    monkeypatch.setattr(accounts, "mac_account", lambda: "me@gmail.com")
    assert accounts.data_paths("me@gmail.com") == ("data/agentic.db", "rules.txt")
    assert accounts.data_paths("friend@gmail.com") == ("data/users/friend@gmail.com/agentic.db",
                                                       "data/users/friend@gmail.com/rules.txt")


def test_folder_names_stay_inside_data_users():
    assert accounts.user_folder("../../etc").parent == accounts.USERS_DIR
    with pytest.raises(ValueError):
        accounts.user_folder("..")


def test_sign_in_can_finish_only_once(tmp_path):
    conn = accounts.connect(str(tmp_path / "app.db"))
    accounts.start_sign_in(conn, "s1", "verifier", "Pixel")
    assert accounts.finish_sign_in(conn, "s1") == ("verifier", "Pixel")
    assert accounts.finish_sign_in(conn, "s1") is None


def test_first_name_and_allowed(monkeypatch):
    assert accounts.first_name(id_token(given_name="Jahaan", email="j@gmail.com")) == "Jahaan"
    assert accounts.first_name(None) == "" and accounts.first_name("not a token") == ""
    assert accounts.allowed("anyone@gmail.com")
    monkeypatch.setattr(accounts, "settings", Settings(allowed_emails="Me@gmail.com, friend@gmail.com"))
    assert accounts.allowed("me@gmail.com") and not accounts.allowed("stranger@gmail.com")
