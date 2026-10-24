"""The agent loop: the model picks a tool, we run it, feed back the result, repeat until it answers."""
import time

from .config import settings
from .store import connect, log_call


def run_agent(task, tools, system, agent="agent", client=None, db_path=None, max_steps=15) -> str:
    if settings.provider != "ollama":
        raise NotImplementedError("Agents run on Ollama for now. Set AGENTIC_PROVIDER=ollama in .env.")
    import ollama

    client = client or ollama.Client()
    by_name = {t.__name__: t for t in tools}
    messages = [{"role": "system", "content": system}, {"role": "user", "content": task}]
    conn = connect(db_path or settings.db_path)
    try:
        for _ in range(max_steps):
            start = time.monotonic()
            response = client.chat(model=settings.ollama_model, messages=messages, tools=tools, think=False)
            message = response.message
            log_call(
                conn,
                agent=agent,
                model=response.model,
                prompt=messages[-1]["content"] if isinstance(messages[-1], dict) else task,
                response=message.content or f"[tool calls: {[c.function.name for c in message.tool_calls or []]}]",
                stop_reason=response.done_reason or "stop",
                input_tokens=response.prompt_eval_count or 0,
                output_tokens=response.eval_count or 0,
                cache_read_tokens=0,
                cost_usd=0.0,
                latency_ms=int((time.monotonic() - start) * 1000),
            )
            messages.append(message)
            if not message.tool_calls:
                return message.content
            for call in message.tool_calls:
                name = call.function.name
                fn = by_name.get(name)
                print(f"  -> {name}({dict(call.function.arguments)})")
                try:
                    result = fn(**call.function.arguments) if fn else f"Error: no tool named {name}"
                except Exception as e:  # report the failure to the model so it can recover
                    result = f"Error: {e}"
                messages.append({"role": "tool", "content": str(result), "tool_name": name})
        return f"Stopped after {max_steps} steps without a final answer."
    finally:
        conn.close()
