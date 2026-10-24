"""One function every later agent builds on: ask a model, log the call and its cost.

The provider is chosen in .env: "ollama" (free, runs locally) or "claude" (paid API).
"""
import time
from dataclasses import dataclass

import anthropic

from .config import PRICES, settings
from .store import connect, log_call


@dataclass
class Usage:
    input_tokens: int
    output_tokens: int


@dataclass
class Answer:
    text: str
    stop_reason: str
    cost_usd: float
    input_tokens: int
    output_tokens: int


def estimate_cost(model: str, usage) -> float:
    inp, out, cache_read = PRICES.get(model, PRICES["claude-opus-5-5"])
    cached = getattr(usage, "cache_read_input_tokens", 0) or 0
    return (usage.input_tokens * inp + usage.output_tokens * out + cached * cache_read) / 1_000_000


def ask(
    prompt: str,
    system: str = "You are a concise, practical personal assistant.",
    agent: str = "cli",
    client=None,
    db_path: str | None = None,
    provider: str | None = None,
    json_schema: dict | None = None,
    keep_alive: str | None = None,
) -> Answer:
    """Ask the model once. With json_schema, the answer is JSON text matching that schema.

    keep_alive (Ollama only), such as "30m", keeps the model in memory so the next answer is quick.
    """
    provider = provider or settings.provider
    start = time.monotonic()
    if provider == "ollama":
        model, text, stop_reason, usage, cost = _ask_ollama(prompt, system, client, json_schema, keep_alive)
    elif provider == "claude":
        model, text, stop_reason, usage, cost = _ask_claude(prompt, system, client, json_schema)
    else:
        raise ValueError(f"Unknown AGENTIC_PROVIDER {provider!r}: use 'ollama' or 'claude'")
    latency_ms = int((time.monotonic() - start) * 1000)

    conn = connect(db_path or settings.db_path)
    log_call(
        conn,
        agent=agent,
        model=model,
        prompt=prompt,
        response=text,
        stop_reason=stop_reason,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cost_usd=cost,
        latency_ms=latency_ms,
    )
    conn.close()
    return Answer(text, stop_reason, cost, usage.input_tokens, usage.output_tokens)


def _ask_ollama(prompt, system, client, json_schema=None, keep_alive=None):
    import ollama

    client = client or ollama.Client()
    extra = {"keep_alive": keep_alive} if keep_alive else {}
    response = client.chat(
        model=settings.ollama_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        think=False,  # Qwen 3 can "think" first; off keeps answers fast on a laptop
        format=json_schema,  # None = free text; a schema forces matching JSON
        **extra,
    )
    usage = Usage(response.prompt_eval_count or 0, response.eval_count or 0)
    return response.model, response.message.content, response.done_reason or "stop", usage, 0.0


def _ask_claude(prompt, system, client, json_schema=None):
    client = client or anthropic.Anthropic()
    output_config = {"effort": settings.effort}
    if json_schema:
        output_config["format"] = {"type": "json_schema", "schema": json_schema}
    response = client.beta.messages.create(
        model=settings.model,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        output_config=output_config,
        # If a safety classifier declines, the API retries on a recommended fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        text = "[declined] " + (response.stop_details.explanation if response.stop_details else "")
    else:
        text = "".join(b.text for b in response.content if b.type == "text")

    cost = estimate_cost(response.model, response.usage)
    return response.model, text, response.stop_reason, response.usage, cost
