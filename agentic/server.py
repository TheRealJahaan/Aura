"""Day 10: the Jarvis server, so Jarvis works on your phone.

It runs on your Mac next to Ollama, and the Jarvis app on your phone talks to it:
1. Sign in: the app opens /login in the phone's browser. Google asks you to allow Gmail access and
   sends you back to /auth/callback, which saves your Google sign-in in data/app.db and hands the
   app its own key through a jarvis:// link.
2. Talk: the app turns your voice into text and sends it to /api/talk with that key. The server runs
   the same Jarvis as on your Mac, on your Gmail, and sends back what Jarvis says. The phone says it.

Each Google account gets its own Jarvis, memory and rules (see accounts.py).
Start it with `python -m agentic.cli app`.
"""
import html
import json
import os
import threading
import traceback
from urllib.parse import urlencode

from fastapi import FastAPI, Header
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from google.auth.exceptions import RefreshError
from pydantic import BaseModel

from . import accounts
from .config import settings
from .gmail import SCOPES, GmailTools
from .jarvis import Jarvis
from .store import connect, local_time, recent_turns

# The phone sign-in also asks for your first name, so Jarvis knows what to call you.
WEB_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.profile", *SCOPES]
KEEP_ALIVE = "30m"
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")  # we check the Gmail permissions ourselves


class Said(BaseModel):
    text: str


def build_gmail(google_token: str):
    """A Gmail connection from a saved Google sign-in. It renews itself every hour."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials.from_authorized_user_info(json.loads(google_token))
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def google_flow(**kwargs):
    """Google's sign-in for the web client saved in web_client.json."""
    from google_auth_oauthlib.flow import Flow

    return Flow.from_client_secrets_file(settings.web_client, scopes=WEB_SCOPES,
                                         redirect_uri=f"{settings.public_url}/auth/callback", **kwargs)


PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jarvis</title>
<style>
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #05060f; color: #e8e8f0;
         font: 17px/1.5 -apple-system, system-ui, sans-serif; text-align: center; }}
  main {{ max-width: 26rem; padding: 2rem 1.5rem; }}
  .orb {{ width: 96px; height: 96px; margin: 0 auto 1.5rem; border-radius: 50%;
          background: radial-gradient(circle at 30% 35%, #ff3cac, transparent 50%),
                      radial-gradient(circle at 70% 40%, #00d4ff, transparent 50%),
                      radial-gradient(circle at 50% 75%, #784ba0, transparent 60%), #0b1026;
          box-shadow: 0 0 40px 8px rgba(120, 90, 255, .45), 0 0 90px 20px rgba(0, 200, 255, .18); }}
  a.button {{ display: inline-block; margin-top: 1.5rem; padding: .9rem 1.8rem; border-radius: 999px;
              background: #7c5cff; color: #fff; text-decoration: none; font-weight: 600; }}
</style></head>
<body><main><div class="orb"></div><h1>{title}</h1><p>{text}</p>{button}</main>{script}</body></html>"""


def page(title: str, text: str, link: str = "", status: int = 200) -> HTMLResponse:
    """A small web page for the phone's browser. With a link, it opens the Jarvis app."""
    button = f'<a class="button" href="{html.escape(link)}">Open Jarvis</a>' if link else ""
    script = f"<script>location.href = {json.dumps(link)};</script>" if link else ""
    return HTMLResponse(PAGE.format(title=html.escape(title, quote=False), text=html.escape(text, quote=False),
                                    button=button, script=script),
                        status_code=status)


def create_app(gmail_for=build_gmail, flow=google_flow, **jarvis_kwargs) -> FastAPI:
    """The server. The tests pass a fake Gmail, a fake Google sign-in and a fake AI model."""
    app = FastAPI(title="Jarvis", docs_url=None, redoc_url=None)
    jarvises: dict[str, tuple[threading.Lock, Jarvis]] = {}  # one Jarvis per Google account
    jarvises_lock = threading.Lock()

    def jarvis_for(email: str) -> tuple[threading.Lock, Jarvis]:
        with jarvises_lock:
            if email not in jarvises:
                conn = accounts.connect()
                name, google_token = accounts.user(conn, email)
                conn.close()
                db_path, rules_path = accounts.data_paths(email)
                jarvis = Jarvis(GmailTools(gmail_for(google_token)), rules_path=rules_path, name=name or None,
                                device="phone", db_path=db_path, **jarvis_kwargs)
                jarvises[email] = (threading.Lock(), jarvis)
            return jarvises[email]

    def forget_jarvis(email: str) -> None:
        with jarvises_lock:
            jarvises.pop(email, None)

    def who(authorization: str) -> str | None:
        conn = accounts.connect()
        email = accounts.email_for_key(conn, authorization.removeprefix("Bearer ").strip())
        conn.close()
        return email

    def signed_out() -> JSONResponse:
        return JSONResponse({"error": "signed_out", "reply": "Please open the Jarvis app and sign in again."}, 401)

    @app.get("/", response_class=HTMLResponse)
    def home():
        return page("Jarvis is running", "Open the Jarvis app on your phone and tap Sign in with Google.")

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/login")
    def login(phone: str = "phone"):
        try:
            google = flow()
        except FileNotFoundError:
            return page("Almost there", f"{settings.web_client} is missing on the Mac. Download the Google web "
                        "client and save it in the agentic-ai folder (see Day 10 in the README).", status=500)
        url, state = google.authorization_url(access_type="offline", prompt="consent")
        conn = accounts.connect()
        accounts.start_sign_in(conn, state, google.code_verifier, phone[:60])
        conn.close()
        return RedirectResponse(url)

    @app.get("/auth/callback")
    def callback(state: str = "", code: str = "", error: str = ""):
        conn = accounts.connect()
        try:
            started = accounts.finish_sign_in(conn, state)
            if error or not code:
                return page("Sign-in cancelled", "Nothing changed. Go back to the Jarvis app to try again.")
            if started is None:
                return page("Please try again", "This sign-in took too long or was already used. Go back to the "
                            "Jarvis app and tap Sign in with Google.")
            code_verifier, phone = started
            google = flow(state=state, code_verifier=code_verifier)
            google.fetch_token(code=code)
            creds = google.credentials
            granted = creds.granted_scopes or creds.scopes or []
            if isinstance(granted, str):
                granted = granted.split()
            if not set(SCOPES) <= set(granted):
                return page("Jarvis needs both Gmail permissions", "On Google's page, tick every box (read and "
                            "organise your email, and send email), then sign in again.")
            email = gmail_for(creds.to_json()).users().getProfile(userId="me").execute()["emailAddress"].lower()
            if not accounts.allowed(email):
                return page("Not allowed", f"{email} can't use this Jarvis. Its owner can add you to "
                            "AGENTIC_ALLOWED_EMAILS.", status=403)
            accounts.save_user(conn, email, accounts.first_name(creds.id_token), creds.to_json())
            key = accounts.new_phone_key(conn, email, phone)
        except Exception as e:
            traceback.print_exc()
            return page("Sign-in failed", f"Something went wrong: {e}. Go back to the Jarvis app and try again.",
                        status=500)
        finally:
            conn.close()
        forget_jarvis(email)  # the next request uses the new Google sign-in
        print(f"Signed in: {email} on {phone}")
        link = "jarvis://signed-in?" + urlencode({"key": key, "email": email})
        return page("You're signed in", f"Jarvis can now use {email}. Opening the app...", link)

    @app.get("/api/me")
    def me(authorization: str = Header(default="")):
        email = who(authorization)
        return {"email": email} if email else signed_out()

    @app.post("/api/talk")
    def talk(said: Said, authorization: str = Header(default="")):
        email = who(authorization)
        if email is None:
            return signed_out()
        text = said.text.strip()[:1000]
        try:
            lock, jarvis = jarvis_for(email)
            with lock:  # one request at a time for each person, so Jarvis's memory stays in order
                reply = jarvis.handle(text)
                action, waiting = jarvis.last_action, jarvis.pending is not None
        except RefreshError:  # Google ended the sign-in (after 7 days while the app is in Testing)
            forget_jarvis(email)
            return JSONResponse({"error": "signin_expired",
                                 "reply": "Your Google sign-in has ended. Open the Jarvis app and sign in again."}, 401)
        except ConnectionError:
            return JSONResponse({"error": "ollama", "reply": "I can't reach Ollama on your Mac. Please open the "
                                 "Ollama app."}, 503)
        except Exception:
            traceback.print_exc()
            return JSONResponse({"error": "failed", "reply": "Sorry, something went wrong with that. "
                                 "Please try again."}, 500)
        print(f"[{email}] You: {text}\n[{email}] Jarvis: {reply}")
        return {"reply": reply, "action": action, "waiting_for_yes": waiting}

    @app.get("/api/history")
    def history(authorization: str = Header(default="")):
        email = who(authorization)
        if email is None:
            return signed_out()
        conn = connect(accounts.data_paths(email)[0])
        rows = recent_turns(conn, 20)
        conn.close()
        return {"turns": [{"time": local_time(ts), "device": device, "you": heard, "jarvis": said, "action": action}
                          for ts, device, heard, said, action in rows]}

    @app.post("/api/signout")
    def sign_out(authorization: str = Header(default="")):
        conn = accounts.connect()
        accounts.sign_out(conn, authorization.removeprefix("Bearer ").strip())
        conn.close()
        return {"ok": True}

    return app


def serve(port: int = 8000) -> None:
    import uvicorn

    if not os.path.exists(settings.web_client):
        print(f"Note: {settings.web_client} isn't in this folder yet, so phones can't sign in (Day 10 in the README).")
    if settings.public_url.startswith("http://localhost"):
        print("Note: AGENTIC_PUBLIC_URL in .env is still localhost, so your phone can't reach this server yet.")
    kwargs = {}
    if settings.provider == "ollama":
        import ollama

        print("Loading the AI model...")
        ollama.generate(model=settings.ollama_model, keep_alive=KEEP_ALIVE)
        kwargs["keep_alive"] = KEEP_ALIVE
    print(f"Jarvis server is running. Your phone uses {settings.public_url}")
    print("Keep this window open. Press Ctrl+C to stop.")
    uvicorn.run(create_app(**kwargs), host="127.0.0.1", port=port, log_level="warning")
