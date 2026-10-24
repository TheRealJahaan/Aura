import base64
import json
from types import SimpleNamespace

from agentic.agent import run_agent
from agentic.agents.inbox import clean_inbox, triage
from agentic.gmail import GmailTools
from agentic.store import connect


class FakeGmail:
    """Mimics the parts of the Gmail API client the tools use."""

    def __init__(self):
        self.drafts_created = []
        self.label_list = [{"id": "L0", "name": "INBOX"}]
        self.labeled = []
        self.archived = []
        self.batches = []
        self.sent = []
        self.trashed = []
        self._in_labels = False
        body = base64.urlsafe_b64encode(b"Can we meet Friday at 3pm?").decode()
        self.msg = {
            "id": "m1",
            "threadId": "t1",
            "snippet": "Can we meet Friday",
            "payload": {
                "mimeType": "text/plain",
                "headers": [{"name": "From", "value": "sam@example.com"}, {"name": "Subject", "value": "Meeting"}],
                "body": {"data": body},
            },
        }

    def users(self):
        return self

    def messages(self):
        self._in_labels = False
        return self

    def drafts(self):
        self._in_labels = False
        return self

    def labels(self):
        self._in_labels = True
        return self

    def modify(self, userId, id, body):
        self.labeled.append((id, body["addLabelIds"][0]))
        if "INBOX" in body.get("removeLabelIds", []):
            self.archived.append(id)
        return SimpleNamespace(execute=lambda: {})

    def batchModify(self, userId, body):
        self.batches.append(body)
        return SimpleNamespace(execute=lambda: {})

    def send(self, userId, body):
        self.sent.append(body)
        return SimpleNamespace(execute=lambda: {"id": "s1"})

    def trash(self, userId, id):
        self.trashed.append(id)
        return SimpleNamespace(execute=lambda: {})

    def list(self, **kw):
        if self._in_labels:
            return SimpleNamespace(execute=lambda: {"labels": list(self.label_list)})
        return SimpleNamespace(execute=lambda: {"messages": [{"id": "m1"}]})

    def get(self, **kw):
        return SimpleNamespace(execute=lambda: self.msg)

    def create(self, userId, body):
        if self._in_labels:
            new = {"id": f"L{len(self.label_list)}", "name": body["name"]}
            self.label_list.append(new)
            return SimpleNamespace(execute=lambda: new)
        self.drafts_created.append(body)
        return SimpleNamespace(execute=lambda: {"id": "d1"})


def test_gmail_tools_read_and_draft():
    gmail = FakeGmail()
    tools = GmailTools(gmail)
    assert "sam@example.com" in tools.list_unread()
    assert "Friday at 3pm" in tools.read_email("m1")
    assert "d1" in tools.create_draft("sam@example.com", "Re: Meeting", "Friday works.", "t1")
    assert gmail.drafts_created[0]["message"]["threadId"] == "t1"


def _reply(content="", calls=None):
    return SimpleNamespace(
        model="qwen3:8b",
        done_reason="stop",
        prompt_eval_count=10,
        eval_count=5,
        message=SimpleNamespace(content=content, tool_calls=calls),
    )


def _call(name, **args):
    return SimpleNamespace(function=SimpleNamespace(name=name, arguments=args))


class ScriptedModel:
    """Plays back a fixed sequence of model turns: list, read, draft, then the brief."""

    def __init__(self):
        self.turns = [
            _reply(calls=[_call("list_unread", max_results=5)]),
            _reply(calls=[_call("read_email", message_id="m1")]),
            _reply(calls=[_call("create_draft", to="sam@example.com", subject="Re: Meeting", body="Yes", thread_id="t1")]),
            _reply(content="Reply now: Sam (Meeting), draft saved."),
        ]
        self.seen = []

    def chat(self, **kw):
        self.seen.append(list(kw["messages"]))
        return self.turns.pop(0)


def test_agent_loop_runs_tools_until_answer(tmp_path):
    gmail = FakeGmail()
    db = str(tmp_path / "t.db")
    out = run_agent("triage", GmailTools(gmail).tools(), "sys", agent="inbox", client=ScriptedModel(), db_path=db)
    assert out == "Reply now: Sam (Meeting), draft saved."
    assert len(gmail.drafts_created) == 1
    assert connect(db).execute("SELECT COUNT(*) FROM calls WHERE agent='inbox'").fetchone() == (4,)


def test_tool_errors_go_back_to_model(tmp_path):
    model = ScriptedModel()
    model.turns = [_reply(calls=[_call("no_such_tool")]), _reply(content="ok")]
    out = run_agent("x", [], "sys", client=model, db_path=str(tmp_path / "t.db"))
    assert out == "ok"
    assert "no tool named" in model.seen[1][-1]["content"]


class FakeSorter:
    """Fake Ollama for the workflow: first call sorts the email, second writes the reply."""

    def __init__(self, category):
        self.answers = [json.dumps({"category": category, "summary": "Sam asks to meet Friday."}), "Friday at 3pm works."]
        self.calls = []

    def chat(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(
            model="qwen3:8b",
            message=SimpleNamespace(content=self.answers.pop(0)),
            done_reason="stop",
            prompt_eval_count=10,
            eval_count=5,
        )


def test_triage_sorts_and_drafts_reply(tmp_path):
    gmail = FakeGmail()
    model = FakeSorter("reply_now")
    brief = triage(5, tools=GmailTools(gmail), client=model, db_path=str(tmp_path / "t.db"), provider="ollama")
    assert "Reply now (1)" in brief and "Draft saved" in brief
    assert model.calls[0]["format"]["properties"]["category"]["enum"] == ["reply_now", "read_later", "ignore"]
    draft = gmail.drafts_created[0]["message"]
    assert draft["threadId"] == "t1"
    assert "Friday at 3pm works." in base64.urlsafe_b64decode(draft["raw"]).decode()


def test_triage_ignores_without_drafting(tmp_path):
    gmail = FakeGmail()
    brief = triage(5, tools=GmailTools(gmail), client=FakeSorter("ignore"), db_path=str(tmp_path / "t.db"), provider="ollama")
    assert "Ignore (1)" in brief
    assert gmail.drafts_created == []


def test_triage_labels_email_and_never_repeats(tmp_path):
    gmail = FakeGmail()
    db = str(tmp_path / "t.db")
    triage(5, tools=GmailTools(gmail), client=FakeSorter("reply_now"), db_path=db, provider="ollama")
    names = {lab["id"]: lab["name"] for lab in gmail.label_list}
    assert [names[label] for _, label in gmail.labeled] == ["AI/Reply now"]
    assert "AI" in names.values()  # parent label created so Gmail nests it

    # Second run: same unread email, already handled -> nothing new, no second draft
    again = triage(5, tools=GmailTools(gmail), client=FakeSorter("reply_now"), db_path=db, provider="ollama")
    assert again == "No new unread emails since the last run."
    assert len(gmail.drafts_created) == 1


def test_ignore_emails_leave_the_inbox(tmp_path):
    gmail = FakeGmail()
    brief = triage(5, tools=GmailTools(gmail), client=FakeSorter("ignore"), archive=True,
                   db_path=str(tmp_path / "t.db"), provider="ollama")
    assert gmail.archived == ["m1"] and "left your inbox" in brief


def test_other_emails_stay_in_the_inbox(tmp_path):
    gmail = FakeGmail()
    triage(5, tools=GmailTools(gmail), client=FakeSorter("reply_now"), archive=True,
           db_path=str(tmp_path / "t.db"), provider="ollama")
    assert gmail.archived == []


def test_clean_inbox_and_undo():
    gmail = FakeGmail()
    assert clean_inbox(GmailTools(gmail)) == 1
    assert clean_inbox(GmailTools(gmail), undo=True) == 1
    assert [("removeLabelIds" in b, "addLabelIds" in b) for b in gmail.batches] == [(True, False), (False, True)]
