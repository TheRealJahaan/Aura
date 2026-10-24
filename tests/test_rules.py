from agentic.agents.inbox import triage
from agentic.gmail import GmailTools
from agentic.rules import add_rule, load_rules, match_rule, remove_rule
from tests.test_inbox import FakeGmail, FakeSorter


def test_rules_file_add_replace_remove(tmp_path):
    path = str(tmp_path / "rules.txt")
    add_rule("ignore", "ZebPay", path)
    add_rule("read_later", "linkedin", path)
    add_rule("read_later", "zebpay", path)  # same word again replaces the old rule
    assert load_rules(path) == [("read_later", "linkedin"), ("read_later", "zebpay")]
    assert remove_rule("linkedin", path) and not remove_rule("swiggy", path)
    assert load_rules(path) == [("read_later", "zebpay")]


def test_rule_matches_sender_name_or_address():
    rules = [("ignore", "zebpay")]
    assert match_rule('"Team ZebPay" <no-reply@email.zebpay.com>', rules) == ("ignore", "zebpay")
    assert match_rule("Sam <sam@example.com>", rules) is None


class NoAI(FakeSorter):
    def chat(self, **kw):
        raise AssertionError("the AI should not be asked about an email a rule ignores")


def test_ignore_rule_skips_the_ai(tmp_path):
    gmail = FakeGmail()
    brief = triage(5, tools=GmailTools(gmail), rules=[("ignore", "sam@")], client=NoAI("ignore"),
                   db_path=str(tmp_path / "t.db"), provider="ollama")
    assert "Ignore (1)" in brief and 'Your rule: ignore "sam@"' in brief


def test_reply_rule_overrides_the_ai_and_drafts(tmp_path):
    gmail = FakeGmail()
    model = FakeSorter("ignore")  # the AI says ignore, but your rule wins
    brief = triage(5, tools=GmailTools(gmail), rules=[("reply_now", "example.com")], client=model,
                   db_path=str(tmp_path / "t.db"), provider="ollama")
    assert "Reply now (1)" in brief and "your rule" in brief
    assert len(gmail.drafts_created) == 1
    assert len(model.calls) == 2  # the AI still wrote the summary and the reply
