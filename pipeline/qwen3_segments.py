"""Merge Qwen3 ForcedAligner token stamps into subtitle-sized cues."""

from __future__ import annotations

from typing import Iterable


def merge_time_stamps(
    stamps: Iterable[dict],
    *,
    max_chars: int = 42,
    max_duration: float = 6.0,
) -> list[dict]:
    """
    stamps: iterable of {text, start, end} (seconds).
    Returns subtitle cues with the same keys + id.
    """
    cues: list[dict] = []
    buf_text = ""
    buf_start: float | None = None
    buf_end = 0.0

    def flush() -> None:
        nonlocal buf_text, buf_start, buf_end
        text = buf_text.strip()
        if text and buf_start is not None:
            cues.append(
                {
                    "id": len(cues),
                    "start": round(buf_start, 3),
                    "end": round(max(buf_end, buf_start + 0.2), 3),
                    "text": text,
                }
            )
        buf_text = ""
        buf_start = None
        buf_end = 0.0

    for raw in stamps:
        token = str(raw.get("text") or "").strip()
        if not token:
            continue
        start = float(raw["start"])
        end = float(raw["end"])
        if buf_start is None:
            buf_start = start
            buf_text = token
            buf_end = end
            continue

        next_text = f"{buf_text}{token}" if _jp_glue(buf_text, token) else f"{buf_text} {token}"
        duration = end - buf_start
        boundary = token.endswith(("。", "！", "？", "!", "?", "…")) or duration >= max_duration
        overflow = len(next_text) > max_chars and len(buf_text) > 0

        if overflow or (boundary and len(next_text) >= 8):
            if overflow and not boundary:
                flush()
                buf_start = start
                buf_text = token
                buf_end = end
            else:
                buf_text = next_text
                buf_end = end
                flush()
            continue

        buf_text = next_text
        buf_end = end

    flush()
    return cues


def _jp_glue(left: str, token: str) -> bool:
    """Avoid spaces between CJK / kana tokens; keep space before Latin."""
    if not left:
        return True
    a = left[-1]
    b = token[0]
    return not (_is_latin(a) or _is_latin(b))


def _is_latin(ch: str) -> bool:
    return ("A" <= ch <= "Z") or ("a" <= ch <= "z") or ("0" <= ch <= "9")
