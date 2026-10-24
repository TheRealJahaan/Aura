import base64
import json
from types import SimpleNamespace

from agentic.gmail import GmailTools
from agentic.jarvis import ROUTER_SCHEMA, Jarvis
from tests.test_inbox import FakeGmail


def route(action, **fields):
    return json.dumps({"action": action, "which": 0, "query": "", "text": "", "category": "none", "word": "", **fields})


class Script:
    """A fake model that gives back prepared answers in order."""

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def chat(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(model="qwen3:8b", message=SimpleNamespace(content=self.answers.pop(0)),
                               done_reason="stop", prompt_eval_count=10, eval_count=5)


def make(tmp_path, *answers, allow_send=True):
    gmail, model = FakeGmail(), Script(*answers)
    jarvis = Jarvis(GmailTools(gmail), allow_send=allow_send, client=model,
                    db_path=str(tmp_path / "t.db"), provider="ollama")
    return jarvis, gmail, model


def test_list_then_read_by_number(tmp_path):
    jarvis, _, model = make(tmp_path, route("list_emails", query="is:unread"), route("read_email", which=1),
                            "Sam wants to meet you on Friday at 3pm.")
    assert "1, sam@example.com: Meeting" in jarvis.handle("what are my unread emails?")
    assert jarvis.handle("read the first one") == "From sam@example.com. Sam wants to meet you on Friday at 3pm."
    assert model.calls[0]["format"] == ROUTER_SCHEMA
    assert "1. sam@example.com | Meeting" in model.calls[1]["messages"][-1]["content"]  # the router saw the list


def test_reply_is_sent_only_after_yes(tmp_path):
    jarvis, gmail, _ = make(tmp_path, route("list_emails"), route("reply", which=1, text="Friday works"),
                            "Friday at 3pm works for me.")
    jarvis.handle("list my emails")
    said = jarvis.handle("reply saying Friday works")
    assert said.endswith("Shall I send it?") and gmail.sent == []
    assert jarvis.handle("yes") == "Sent."
    assert gmail.sent[0]["threadId"] == "t1"
    assert "Friday at 3pm works for me." in base64.urlsafe_b64decode(gmail.sent[0]["raw"]).decode()


def test_no_keeps_the_reply_as_a_draft(tmp_path):
    jarvis, gmail, _ = make(tmp_path, route("list_emails"), route("reply", which=1), "Sounds good.")
    jarvis.handle("list my emails")
    jarvis.handle("reply to it")
    assert "Drafts" in jarvis.handle("no, wait")
    assert gmail.sent == [] and len(gmail.drafts_created) == 1


def test_changing_the_subject_never_sends(tmp_path):
    jarvis, gmail, _ = make(tmp_path, route("list_emails"), route("reply", which=1), "Sounds good.", route("list_rules"))
    jarvis.handle("list my emails")
    jarvis.handle("reply to it")
    said = jarvis.handle("what are my rules?")
    assert said.startswith("I didn't send it.") and gmail.sent == [] and len(gmail.drafts_created) == 1


def test_drafts_only_mode(tmp_path):
    jarvis, gmail, _ = make(tmp_path, route("list_emails"), route("reply", which=1), "Sounds good.",
                            route("trash", which=1), allow_send=False)
    jarvis.handle("list my emails")
    assert "saved it in your Drafts" in jarvis.handle("reply to it")
    assert "never delete" in jarvis.handle("delete it")
    assert gmail.sent == [] and gmail.trashed == []


def test_trash_waits_for_yes_and_archive_does_not(tmp_path):
    jarvis, gmail, _ = make(tmp_path, route("list_emails"), route("archive", which=1), route("trash", which=1))
    jarvis.handle("list my emails")
    assert jarvis.handle("archive it").startswith("Archived")
    assert gmail.batches[-1] == {"ids": ["m1"], "removeLabelIds": ["INBOX"]}
    assert jarvis.handle("delete it").endswith("to Trash?") and gmail.trashed == []
    jarvis.handle("yes")
    assert gmail.trashed == ["m1"]


def test_asks_which_email_when_unclear(tmp_path):
    jarvis, _, _ = make(tmp_path, route("read_email", which=3))
    assert jarvis.handle("read the third one").startswith("Which email")


def test_rules_by_voice(tmp_path):
    jarvis, _, _ = make(tmp_path, route("add_rule", category="ignore", word="Unstop"), route("list_rules"))
    assert "unstop will always go to Ignore" in jarvis.handle("always ignore Unstop")
    assert "unstop goes to Ignore" in jarvis.handle("what are my rules")


def test_bad_router_answer_gives_help(tmp_path):
    jarvis, _, _ = make(tmp_path, "not json")
    assert jarvis.handle("hmm").startswith("You can ask")


def test_every_turn_is_remembered(tmp_path):
    from agentic.store import connect, recent_turns

    jarvis, _, _ = make(tmp_path, route("list_rules"))
    said = jarvis.handle("what are my rules?")
    assert recent_turns(connect(str(tmp_path / "t.db")))[0][1:] == ("mac", "what are my rules?", said, "list_rules")
