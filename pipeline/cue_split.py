"""Subtitle cue normalization: keep JP/EN lines short and timed sanely."""

from __future__ import annotations

import re
from typing import Iterable

JP_SPLIT = re.compile(r"(?<=[。！？!?…])")
# Rough spoken Japanese reading speed for duration clamps / expansion.
JP_CHARS_PER_SEC = 8.0
MIN_CUE_DUR = 0.35
DEFAULT_MAX_DUR = 8.0
DEFAULT_MAX_CHARS = 42
# Above this reading rate, timestamps are treated as collapsed / unreliable.
MAX_SANE_CPS = 14.0
# Gap after a cue/cluster treated as real silence — do not invent captions into it.
SILENCE_GAP = 2.5
# Max window to pack a collapsed same-stamp cluster (seconds).
MAX_CLUSTER_PACK = 6.0


def expected_duration(text: str, *, max_duration: float = DEFAULT_MAX_DUR) -> float:
    """Minimum readable on-screen duration for subtitle text."""
    n = max(len(str(text or "").strip()), 1)
    return min(max_duration, max(MIN_CUE_DUR, n / JP_CHARS_PER_SEC + 0.35))


def is_collapsed_span(
    start: float,
    end: float,
    text: str,
    *,
    max_duration: float = DEFAULT_MAX_DUR,
) -> bool:
    need = expected_duration(text, max_duration=max_duration)
    dur = max(end - start, 1e-3)
    cps = len(str(text or "").strip()) / dur
    return dur < need * 0.55 or cps > MAX_SANE_CPS


def repair_cue_timing(
    segments: Iterable[dict],
    *,
    max_duration: float = DEFAULT_MAX_DUR,
    max_lag: float = 1.5,
) -> list[dict]:
    """
    Keep captions on real speech bounds when ASR is sane.

    - Sane ASR spans: preserve voice start/end (only fix overlaps).
    - Collapsed same-stamp clusters: pack near the stamp; never march
      through a long following silence before the next distinct speech.
    """
    del max_lag  # retained for call-site compatibility
    raw: list[dict] = []
    for seg in segments:
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("asr_start", seg["start"]))
        end = float(seg["end"])
        if end < start:
            end = start + MIN_CUE_DUR
        raw.append(
            {
                "asr_start": start,
                "asr_end": end,
                "text": text,
            }
        )

    raw.sort(key=lambda s: (s["asr_start"], s["asr_end"]))
    out: list[dict] = []
    i = 0
    while i < len(raw):
        j = i + 1
        while (
            j < len(raw)
            and abs(raw[j]["asr_start"] - raw[i]["asr_start"]) < 1e-3
        ):
            j += 1
        cluster = raw[i:j]
        next_asr = float(raw[j]["asr_start"]) if j < len(raw) else None
        asr_start = float(cluster[0]["asr_start"])

        single = len(cluster) == 1
        collapsed = any(
            is_collapsed_span(
                c["asr_start"], c["asr_end"], c["text"], max_duration=max_duration
            )
            for c in cluster
        )

        if single and not collapsed:
            # Trust ForcedAligner / Whisper voice bounds.
            start = asr_start
            end = float(cluster[0]["asr_end"])
            if out and out[-1]["end"] > start:
                prev = out[-1]
                min_prev_end = prev["start"] + MIN_CUE_DUR
                prev["end"] = round(max(min_prev_end, min(prev["end"], start)), 3)
                start = max(start, prev["end"])
            if next_asr is not None and end > next_asr:
                end = next_asr
            if end <= start:
                end = start + MIN_CUE_DUR
            if end - start > max_duration * 2:
                # Absurdly long but "sane" cps (very short text) — keep start, cap.
                end = start + max_duration
            out.append(
                {
                    "id": len(out),
                    "start": round(start, 3),
                    "end": round(end, 3),
                    "text": cluster[0]["text"],
                    "asr_start": round(asr_start, 3),
                }
            )
        else:
            # Collapsed cluster (or multi-line same stamp): pack near voice stamp.
            needs = [
                expected_duration(c["text"], max_duration=max_duration)
                for c in cluster
            ]
            total_need = sum(needs)
            cluster_asr_end = max(float(c["asr_end"]) for c in cluster)
            native_span = max(cluster_asr_end - asr_start, MIN_CUE_DUR)

            if next_asr is not None:
                gap = next_asr - asr_start
                if gap > SILENCE_GAP:
                    # Long quiet after stamp — do not invent captions into silence.
                    pack = min(
                        total_need,
                        MAX_CLUSTER_PACK,
                        max(native_span, min(total_need, 2.0)),
                    )
                else:
                    pack = min(
                        total_need,
                        MAX_CLUSTER_PACK,
                        max(gap - 0.05, MIN_CUE_DUR * len(cluster)),
                    )
            else:
                pack = min(total_need, MAX_CLUSTER_PACK)

            pack = max(pack, MIN_CUE_DUR * len(cluster))
            cursor = asr_start
            if out and out[-1]["end"] > cursor:
                prev = out[-1]
                min_prev_end = prev["start"] + MIN_CUE_DUR
                prev["end"] = round(max(min_prev_end, min(prev["end"], cursor)), 3)
                cursor = max(cursor, prev["end"])

            window_end = cursor + pack
            if next_asr is not None:
                window_end = min(window_end, next_asr)
            window_end = max(window_end, cursor + MIN_CUE_DUR * len(cluster))

            weights = [max(n, MIN_CUE_DUR) for n in needs]
            wsum = sum(weights) or 1.0
            avail = max(window_end - cursor, MIN_CUE_DUR * len(cluster))
            for k, c in enumerate(cluster):
                frac = weights[k] / wsum
                start = cursor
                piece_end = (
                    cursor + avail * frac if k < len(cluster) - 1 else window_end
                )
                if piece_end <= start:
                    piece_end = start + MIN_CUE_DUR
                if piece_end - start > max_duration:
                    piece_end = start + max_duration
                out.append(
                    {
                        "id": len(out),
                        "start": round(start, 3),
                        "end": round(piece_end, 3),
                        "text": c["text"],
                        "asr_start": round(asr_start, 3),
                    }
                )
                cursor = piece_end

        i = j

    for idx in range(1, len(out)):
        if out[idx]["start"] < out[idx - 1]["end"]:
            out[idx]["start"] = out[idx - 1]["end"]
        if out[idx]["end"] <= out[idx]["start"]:
            out[idx]["end"] = round(out[idx]["start"] + MIN_CUE_DUR, 3)

    return out


def normalize_cues(
    segments: Iterable[dict],
    *,
    max_duration: float = DEFAULT_MAX_DUR,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[dict]:
    """
    Split oversized cues on JP punctuation and clamp absurd durations
    (e.g. Whisper mega-segments spanning minutes of silence/music).

    Also expands collapsed timestamps before splitting so multi-piece cues
    are redistributed across a readable speech window, then de-overlaps.
    """
    out: list[dict] = []
    for seg in segments:
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg["start"])
        end = float(seg["end"])
        asr_start = float(seg.get("asr_start", start))
        if end < start:
            end = start + MIN_CUE_DUR

        # Expand collapsed stamps before split/redistribution (local only;
        # repair_cue_timing will keep long silences empty).
        need = expected_duration(text, max_duration=max_duration)
        dur = end - start
        asr_end = end
        if dur < need * 0.55 or (len(text) / max(dur, 1e-3)) > MAX_SANE_CPS:
            end = start + need

        pieces = _split_text(text, max_chars=max_chars)
        if len(pieces) == 1:
            dur = end - start
            expected = expected_duration(pieces[0], max_duration=max_duration)
            # Whisper silence bag: late-pack near ASR end so captions aren't
            # shown through a long quiet stretch before the voice.
            if (asr_end - asr_start) > max(max_duration, expected * 2.5):
                span = min(asr_end - asr_start, max(max_duration, expected))
                end = asr_end
                start = max(asr_start, end - span)
                asr_start = start
            out.append(
                {
                    "id": len(out),
                    "start": round(start, 3),
                    "end": round(max(end, start + MIN_CUE_DUR), 3),
                    "asr_start": round(asr_start, 3),
                    "text": pieces[0],
                }
            )
            continue

        total_chars = sum(max(len(p), 1) for p in pieces)
        orig_start, orig_end = asr_start, asr_end
        span = max(end - start, MIN_CUE_DUR * len(pieces))
        expected = sum(
            expected_duration(p, max_duration=max_duration) for p in pieces
        )
        span = max(span, expected)
        mega_cap = max(max_duration * len(pieces), expected * 2.5)
        if (orig_end - orig_start) > mega_cap:
            # Late-pack split pieces into the end of the mega window.
            span = min(orig_end - orig_start, mega_cap)
            end = orig_end
            start = max(orig_start, end - span)
            asr_start = start
        else:
            end = start + span

        cursor = start
        for i, piece in enumerate(pieces):
            frac = max(len(piece), 1) / total_chars
            piece_dur = max(span * frac, MIN_CUE_DUR)
            piece_end = cursor + piece_dur if i < len(pieces) - 1 else end
            if piece_end <= cursor:
                piece_end = cursor + MIN_CUE_DUR
            out.append(
                {
                    "id": len(out),
                    "start": round(cursor, 3),
                    "end": round(piece_end, 3),
                    "asr_start": round(asr_start if i == 0 else cursor, 3),
                    "text": piece,
                }
            )
            cursor = piece_end

    return repair_cue_timing(out, max_duration=max_duration)


def words_to_cues(
    words: Iterable[dict],
    *,
    max_duration: float = DEFAULT_MAX_DUR,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[dict]:
    """Build subtitle cues from faster-whisper word timestamps."""
    cues: list[dict] = []
    buf: list[dict] = []

    def flush() -> None:
        nonlocal buf
        if not buf:
            return
        text = "".join(w["text"] for w in buf).strip()
        # Whisper JP words usually include leading spaces rarely; keep as-is.
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            cues.append(
                {
                    "id": len(cues),
                    "start": round(float(buf[0]["start"]), 3),
                    "end": round(float(buf[-1]["end"]), 3),
                    "text": text,
                }
            )
        buf = []

    for w in words:
        token = str(w.get("text") or "")
        if not token.strip():
            continue
        item = {
            "text": token,
            "start": float(w["start"]),
            "end": float(w["end"]),
        }
        if not buf:
            buf = [item]
            continue

        next_text = "".join(x["text"] for x in buf) + token
        next_text_norm = re.sub(r"\s+", " ", next_text).strip()
        duration = item["end"] - float(buf[0]["start"])
        boundary = bool(re.search(r"[。！？!?…]\s*$", next_text_norm))
        overflow = len(next_text_norm) > max_chars or duration > max_duration

        if overflow and not boundary and len(buf) > 0:
            flush()
            buf = [item]
            continue

        buf.append(item)
        if boundary or duration >= max_duration or len(next_text_norm) >= max_chars:
            flush()

    flush()
    return normalize_cues(cues, max_duration=max_duration, max_chars=max_chars)


def _split_text(text: str, *, max_chars: int) -> list[str]:
    text = text.strip()
    if len(text) <= max_chars:
        # Still split on strong punctuation when present so MT gets sentence units.
        parts = [p.strip() for p in JP_SPLIT.split(text) if p.strip()]
        return parts or [text]

    parts = [p.strip() for p in JP_SPLIT.split(text) if p.strip()]
    if not parts:
        parts = [text]

    # Soft-wrap any remaining long piece.
    out: list[str] = []
    for part in parts:
        if len(part) <= max_chars:
            out.append(part)
            continue
        buf = ""
        for ch in part:
            buf += ch
            if len(buf) >= max_chars:
                out.append(buf.strip())
                buf = ""
        if buf.strip():
            out.append(buf.strip())
    return out
