from types import SimpleNamespace

from agentic.llm import ask, estimate_cost
from agentic.store import connect


class FakeClient:
    """Stands in for anthropic.Anthropic so tests run without a key or network."""

    def __init__(self):
        self.kwargs = None
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            model="claude-opus-5-5",
            stop_reason="end_turn",
            stop_details=None,
            content=[SimpleNamespace(type="thinking"), SimpleNamespace(type="text", text="Hello Jahaan")],
            usage=SimpleNamespace(input_tokens=1000, output_tokens=500, cache_read_input_tokens=0),
        )


def test_cost_math():
    usage = SimpleNamespace(input_tokens=1_000_000, output_tokens=1_000_000, cache_read_input_tokens=0)
    assert estimate_cost("claude-opus-5-5", usage) == 24.0


def test_ask_returns_text_and_logs(tmp_path):
    db = str(tmp_path / "t.db")
    client = FakeClient()
    answer = ask("hi", client=client, db_path=db, provider="claude")
    assert answer.text == "Hello Jahaan"
    assert client.kwargs["fallbacks"] == "default"
    rows = connect(db).execute("SELECT agent, input_tokens, cost_usd FROM calls").fetchall()
    assert rows == [("cli", 1000, 0.014)]


class FakeOllama:
    def chat(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            model="qwen3:8b",
            message=SimpleNamespace(content="Hi from Ollama"),
            done_reason="stop",
            prompt_eval_count=20,
            eval_count=10,
        )


def test_ollama_is_free_and_logged(tmp_path):
    db = str(tmp_path / "t.db")
    fake = FakeOllama()
    answer = ask("hi", client=fake, db_path=db, provider="ollama")
    assert answer.text == "Hi from Ollama"
    assert answer.cost_usd == 0.0
    assert fake.kwargs["messages"][0]["role"] == "system"
    rows = connect(db).execute("SELECT model, input_tokens, cost_usd FROM calls").fetchall()
    assert rows == [("qwen3:8b", 20, 0.0)]
