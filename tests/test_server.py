import html
import json
import re
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from google.auth.exceptions import RefreshError

from agentic import accounts
from agentic.config import Settings
from agentic.server import WEB_SCOPES, create_app
from tests.test_accounts import id_token
from tests.test_inbox import FakeGmail
from tests.test_jarvis import Script, route


class ProfileGmail(FakeGmail):
    email = "Sam@Example.com"

    def getProfile(self, userId):
        return SimpleNamespace(execute=lambda: {"emailAddress": self.email})


class FakeFlow:
    """Stands in for Google's sign-in."""

    def __init__(self, scopes, **kwargs):
        self.kwargs = kwargs
        self.code_verifier = "verifier-1"
        self.credentials = SimpleNamespace(granted_scopes=scopes, scopes=WEB_SCOPES, id_token=id_token(given_name="Sam"),
                                           to_json=lambda: json.dumps({"refresh_token": "r", "token": "t"}))

    def authorization_url(self, **kwargs):
        return "https://accounts.google.com/o/oauth2/auth?client_id=x", "state-1"

    def fetch_token(self, code):
        self.code = code


def make(*answers, scopes=WEB_SCOPES, gmail=None):
    model, flows, gmail = Script(*answers), [], gmail or ProfileGmail()

    def flow(**kwargs):
        flows.append(FakeFlow(scopes, **kwargs))
        return flows[-1]

    app = create_app(gmail_for=lambda token: gmail, flow=flow, client=model, provider="ollama")
    return TestClient(app), model, flows


def sign_in(client) -> str:
    login = client.get("/login", params={"phone": "Pixel 8"}, follow_redirects=False)
    assert login.status_code == 307 and login.headers["location"].startswith("https://accounts.google.com")
    done = client.get("/auth/callback", params={"state": "state-1", "code": "abc"})
    link = re.search(r'href="(jarvis://[^"]+)"', done.text)
    assert link, done.text
    return parse_qs(urlparse(html.unescape(link.group(1))).query)["key"][0]


def test_sign_in_then_talk(tmp_path):
    client, model, flows = make(route("list_emails", query="is:unread"))
    key = sign_in(client)
    assert flows[1].kwargs == {"state": "state-1", "code_verifier": "verifier-1"} and flows[1].code == "abc"
    assert client.get("/api/me", headers={"Authorization": f"Bearer {key}"}).json() == {"email": "sam@example.com"}

    said = client.post("/api/talk", json={"text": "my unread emails"}, headers={"Authorization": f"Bearer {key}"})
    assert said.status_code == 200
    assert "1, sam@example.com: Meeting" in said.json()["reply"] and said.json()["waiting_for_yes"] is False
    assert "Sam's Gmail" in model.calls[0]["messages"][0]["content"]  # Jarvis uses the name from Google

    turns = client.get("/api/history", headers={"Authorization": f"Bearer {key}"}).json()["turns"]
    assert turns[0]["you"] == "my unread emails" and turns[0]["device"] == "phone"
    assert Path("data/users/sam@example.com/agentic.db").exists()  # Sam's own memory


def test_talk_needs_a_signed_in_phone(tmp_path):
    client, _, _ = make()
    for headers in ({}, {"Authorization": "Bearer made-up"}):
        refused = client.post("/api/talk", json={"text": "hi"}, headers=headers)
        assert refused.status_code == 401 and "sign in" in refused.json()["reply"]


def test_sign_out(tmp_path):
    client, _, _ = make()
    key = sign_in(client)
    client.post("/api/signout", headers={"Authorization": f"Bearer {key}"})
    assert client.get("/api/me", headers={"Authorization": f"Bearer {key}"}).status_code == 401


def test_sign_in_needs_both_gmail_permissions(tmp_path):
    client, _, _ = make(scopes=WEB_SCOPES[:-1])  # the person unticked "send email"
    client.get("/login", follow_redirects=False)
    page = client.get("/auth/callback", params={"state": "state-1", "code": "abc"})
    assert "needs both Gmail permissions" in page.text and "jarvis://" not in page.text
    assert accounts.list_users(accounts.connect()) == []


def test_each_sign_in_link_works_once(tmp_path):
    client, _, _ = make()
    sign_in(client)
    again = client.get("/auth/callback", params={"state": "state-1", "code": "abc"})
    assert "Please try again" in again.text


def test_only_allowed_emails(tmp_path, monkeypatch):
    monkeypatch.setattr(accounts, "settings", Settings(allowed_emails="jahaan@gmail.com"))
    client, _, _ = make()
    client.get("/login", follow_redirects=False)
    page = client.get("/auth/callback", params={"state": "state-1", "code": "abc"})
    assert page.status_code == 403 and "can't use this Jarvis" in page.text


def test_expired_google_sign_in(tmp_path):
    class Expired(ProfileGmail):
        def list(self, **kw):
            raise RefreshError("invalid_grant: Token has been expired or revoked.")

    client, _, _ = make(route("list_emails"), gmail=Expired())
    key = sign_in(client)
    said = client.post("/api/talk", json={"text": "my emails"}, headers={"Authorization": f"Bearer {key}"})
    assert said.status_code == 401 and said.json()["error"] == "signin_expired"
