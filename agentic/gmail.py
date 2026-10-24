"""Gmail access for the agents: read, search, label, archive, draft and send.

Sending and moving to Trash only happen when Jarvis has asked you and you said yes.
"""
import base64
import os
from email.message import EmailMessage
from email.utils import parseaddr

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",  # read mail and add labels
    "https://www.googleapis.com/auth/gmail.compose",  # create drafts and send (only after you say yes)
]
MAX_BODY_CHARS = 4000  # keeps long emails within a local model's context


class SignInNeeded(Exception):
    """Gmail needs you to sign in again, and nobody is at the computer to do it."""


def get_service(creds_path: str = "credentials.json", token_path: str = "data/token.json", interactive: bool = True):
    """Sign in to Gmail. The first run opens your browser to approve access.

    interactive=False is for jobs that run on their own (the 8:00 run, the phone server): instead of
    opening a browser nobody will see, it raises SignInNeeded.
    """
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if os.path.exists(token_path):
        # Load with the scopes saved at sign-in, so we notice when the app now needs more.
        creds = Credentials.from_authorized_user_file(token_path)
        if not creds.has_scopes(SCOPES):
            if interactive:
                print("The agent needs new Gmail permissions. Your browser will open to approve them.")
            creds = None
    if creds and not creds.valid and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save(creds, token_path)
        except RefreshError:  # Google ended the sign-in, for example after 7 days while the app is in Testing
            creds = None
    if not creds or not creds.valid:
        if not interactive:
            raise SignInNeeded("Your Gmail sign-in has expired. Run `python -m agentic.cli inbox` once to sign in again.")
        if not os.path.exists(creds_path):
            raise FileNotFoundError(
                "credentials.json not found. Download it from Google Cloud (see the Day 2 guide) "
                "and put it in the agentic-ai folder."
            )
        flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
        creds = flow.run_local_server(port=0)
        _save(creds, token_path)
    return build("gmail", "v1", credentials=creds)


def _save(creds, token_path: str) -> None:
    os.makedirs(os.path.dirname(token_path) or ".", exist_ok=True)
    with open(token_path, "w") as f:
        f.write(creds.to_json())
    os.chmod(token_path, 0o600)  # your Gmail sign-in: only your Mac user can read it


def _header(msg: dict, name: str) -> str:
    for h in msg.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def _plain_text(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    for part in payload.get("parts", []) or []:
        text = _plain_text(part)
        if text:
            return text
    return ""


def _raw(to: str, subject: str, body: str, in_reply_to: str = "") -> str:
    """An email in the encoded form the Gmail API expects."""
    message = EmailMessage()
    message["To"] = to
    message["Subject"] = subject
    if in_reply_to:
        message["In-Reply-To"] = in_reply_to
        message["References"] = in_reply_to
    message.set_content(body)
    return base64.urlsafe_b64encode(message.as_bytes()).decode()


class GmailTools:
    def __init__(self, service):
        self.service = service

    # Plain Python helpers, used by the inbox workflow --------------------------

    def unread_ids(self, n: int) -> list[str]:
        listing = (
            self.service.users().messages().list(userId="me", q="is:unread in:inbox", maxResults=n).execute()
        )
        return [m["id"] for m in listing.get("messages", [])]

    def label_id(self, name: str) -> str:
        """Find a Gmail label by name, creating it the first time."""
        if not hasattr(self, "_labels"):
            existing = self.service.users().labels().list(userId="me").execute().get("labels", [])
            self._labels = {lab["name"]: lab["id"] for lab in existing}
        if name not in self._labels:
            created = (
                self.service.users()
                .labels()
                .create(userId="me", body={"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"})
                .execute()
            )
            self._labels[name] = created["id"]
        return self._labels[name]

    def add_label(self, message_id: str, name: str, archive: bool = False) -> None:
        """Put an email under a label. With archive=True it also leaves the inbox. It stays unread."""
        if "/" in name:
            self.label_id(name.split("/")[0])  # parent first, so Gmail shows it as a folder
        body = {"addLabelIds": [self.label_id(name)]}
        if archive:
            body["removeLabelIds"] = ["INBOX"]
        self.service.users().messages().modify(userId="me", id=message_id, body=body).execute()

    def ids_with_label(self, name: str, query: str = "") -> list[str]:
        """Every email under a label, narrowed by a Gmail search such as "in:inbox"."""
        label, ids, page = self.label_id(name), [], None
        while True:
            listing = (
                self.service.users()
                .messages()
                .list(userId="me", labelIds=[label], q=query, maxResults=500, pageToken=page)
                .execute()
            )
            ids += [m["id"] for m in listing.get("messages", [])]
            page = listing.get("nextPageToken")
            if not page:
                return ids

    def _change_labels(self, ids: list[str], add: list[str] = (), remove: list[str] = ()) -> None:
        for start in range(0, len(ids), 1000):  # Gmail takes up to 1000 emails per call
            body = {"ids": ids[start : start + 1000]}
            if add:
                body["addLabelIds"] = list(add)
            if remove:
                body["removeLabelIds"] = list(remove)
            self.service.users().messages().batchModify(userId="me", body=body).execute()

    def set_in_inbox(self, ids: list[str], in_inbox: bool) -> None:
        """Move emails back into the inbox or out of it (archive). Labels stay and nothing is deleted."""
        if in_inbox:
            self._change_labels(ids, add=["INBOX"])
        else:
            self._change_labels(ids, remove=["INBOX"])

    def mark_read(self, ids: list[str]) -> None:
        self._change_labels(ids, remove=["UNREAD"])

    def trash(self, message_id: str) -> None:
        """Move an email to Trash. Gmail keeps it there for 30 days, so it can be restored."""
        self.service.users().messages().trash(userId="me", id=message_id).execute()

    def search(self, query: str, n: int = 5) -> list[dict]:
        """Find emails with a Gmail search, such as "is:unread" or "from:deloitte newer_than:7d"."""
        listing = self.service.users().messages().list(userId="me", q=query, maxResults=n).execute()
        found = []
        for item in listing.get("messages", []):
            msg = (
                self.service.users()
                .messages()
                .get(userId="me", id=item["id"], format="metadata", metadataHeaders=["From", "Subject"])
                .execute()
            )
            found.append({
                "id": msg["id"],
                "from": _header(msg, "From"),
                "subject": _header(msg, "Subject"),
                "unread": "UNREAD" in msg.get("labelIds", []),
            })
        return found

    def find_address(self, name: str) -> str | None:
        """The email address of someone who has emailed you, found by their name."""
        for e in self.search(f"from:({name})", 1):
            return parseaddr(e["from"])[1] or None
        return None

    def send_email(self, to: str, subject: str, body: str, thread_id: str = "", in_reply_to: str = "") -> str:
        """Send an email right away. Jarvis only calls this after you said yes."""
        message = {"raw": _raw(to, subject, body, in_reply_to)}
        if thread_id:
            message["threadId"] = thread_id
        return self.service.users().messages().send(userId="me", body=message).execute()["id"]

    def get_email(self, message_id: str) -> dict:
        msg = self.service.users().messages().get(userId="me", id=message_id, format="full").execute()
        body = _plain_text(msg.get("payload", {})) or msg.get("snippet", "")
        if len(body) > MAX_BODY_CHARS:
            body = body[:MAX_BODY_CHARS] + "\n[... email shortened ...]"
        sender = _header(msg, "From")
        return {
            "id": msg["id"],
            "thread_id": msg.get("threadId", ""),
            "message_id": _header(msg, "Message-ID"),  # lets a reply join the conversation
            "from": sender,
            "reply_to": parseaddr(_header(msg, "Reply-To") or sender)[1],
            "subject": _header(msg, "Subject"),
            "body": body,
        }

    # Tools the AI can call in the agent loop -----------------------------------

    def list_unread(self, max_results: int = 10) -> str:
        """List unread emails in the inbox, newest first.

        Args:
            max_results: How many emails to list, at most 25.

        Returns:
            One line per email with its id, sender, subject and a short preview.
        """
        max_results = max(1, min(int(max_results), 25))
        listing = (
            self.service.users()
            .messages()
            .list(userId="me", q="is:unread in:inbox", maxResults=max_results)
            .execute()
        )
        lines = []
        for item in listing.get("messages", []):
            msg = (
                self.service.users()
                .messages()
                .get(userId="me", id=item["id"], format="metadata", metadataHeaders=["From", "Subject"])
                .execute()
            )
            lines.append(
                f"id={msg['id']} | from: {_header(msg, 'From')} | subject: {_header(msg, 'Subject')} "
                f"| preview: {msg.get('snippet', '')}"
            )
        return "\n".join(lines) or "No unread emails."

    def read_email(self, message_id: str) -> str:
        """Read the full text of one email.

        Args:
            message_id: The id shown by list_unread.

        Returns:
            The sender, subject, thread id and plain-text body.
        """
        e = self.get_email(message_id)
        return f"from: {e['from']}\nsubject: {e['subject']}\nthread_id: {e['thread_id']}\n\n{e['body']}"

    def create_draft(self, to: str, subject: str, body: str, thread_id: str = "") -> str:
        """Save a reply as a Gmail draft for the user to review. Nothing is sent.

        Args:
            to: Recipient email address.
            subject: Subject line, usually "Re: " plus the original subject.
            body: The reply text.
            thread_id: The thread_id from read_email, so the draft joins that conversation.

        Returns:
            Confirmation with the draft id.
        """
        draft = {"message": {"raw": _raw(to, subject, body)}}
        if thread_id:
            draft["message"]["threadId"] = thread_id
        created = self.service.users().drafts().create(userId="me", body=draft).execute()
        return f"Draft saved (id={created['id']}) to {to}: {subject}"

    def tools(self):
        return [self.list_unread, self.read_email, self.create_draft]
