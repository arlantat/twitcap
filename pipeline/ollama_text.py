"""Shared Ollama helpers for subtitle MT / polish (Qwen3-safe)."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

# Qwen3 / reasoning models often wrap chain-of-thought like this.
THINK_BLOCK_RE = re.compile(
    r"<think>.*?</think>|<thinking>.*?</thinking>|◁think▷.*?◁/think▷",
    re.DOTALL | re.IGNORECASE,
)
THINK_LINE_RE = re.compile(r"^\s*(thinking|thought|reasoning)\s*:.*$", re.IGNORECASE)


def strip_think(text: str) -> str:
    """Remove model 'thinking' blocks so numbered subtitle lines remain parseable."""
    if not text:
        return ""
    cleaned = THINK_BLOCK_RE.sub("", text)
    lines = []
    for line in cleaned.splitlines():
        if THINK_LINE_RE.match(line):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def is_qwen3_model(model: str) -> bool:
    name = (model or "").lower()
    return name.startswith("qwen3") or "/qwen3" in name


def with_no_think(messages: list[dict], model: str) -> list[dict]:
    """
    Reinforce "no thinking in the answer" for Qwen3 in the system prompt.

    Do NOT append the `/no_think` token: on some Ollama + Qwen3 builds that
    leaves `message.content` empty (answer trapped in `thinking`). Prefer the
    API `think: false` flag via `build_chat_payload` / `call_ollama`.
    """
    if not is_qwen3_model(model) or not messages:
        return messages
    out = [dict(m) for m in messages]
    if out[0].get("role") == "system":
        sys = str(out[0].get("content") or "")
        if "do not output thinking" not in sys.lower():
            out[0]["content"] = (
                sys
                + "\n- Do not output thinking, analysis, or <think> blocks — only the numbered lines."
            )
    return out


def build_chat_payload(
    model: str,
    messages: list[dict],
    *,
    temperature: float = 0.2,
    num_predict: int = 2048,
) -> dict:
    """Build Ollama /api/chat JSON body (disables Qwen3 thinking when supported)."""
    msgs = with_no_think(messages, model)
    payload: dict = {
        "model": model,
        "messages": msgs,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": num_predict},
    }
    if is_qwen3_model(model):
        # Official switch; avoids empty content when /no_think misfires.
        payload["think"] = False
    return payload


def call_ollama(
    base: str,
    model: str,
    messages: list[dict],
    *,
    temperature: float = 0.2,
    num_predict: int = 2048,
    retries: int = 2,
) -> str:
    body = build_chat_payload(
        model, messages, temperature=temperature, num_predict=num_predict
    )
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    last_err = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                msg = data.get("message") or {}
                content = msg.get("content") or ""
                # Never treat CoT `thinking` as the answer — only strip tags in content.
                return strip_think(content)
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(
        f"Ollama request failed at {base} (model={model}): {last_err}. "
        f"Is Ollama running and the model pulled? Try: ollama pull {model}"
    )
