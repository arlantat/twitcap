#!/usr/bin/env python3
"""Normalize / merge Japanese ASR cues into clear sentences via Ollama.

Runs after Qwen (or Whisper) ASR and before JP→EN translation:
- rewrite fragmented ASR into clear spoken Japanese
- allow merging consecutive cue IDs into one sentence (timing = span)
- then clamp/split with cue_split.normalize_cues for readable subtitle lengths

Uses Ollama HTTP (stdlib + local cue_split). Progress: PROGRESS <0..1>
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from cue_split import normalize_cues, repair_cue_timing
from ollama_text import call_ollama

SYSTEM_PROMPT = (
    "You clean Japanese livestream ASR into clear spoken Japanese sentences "
    "for subtitles. This is editing ASR debris — not translation, not invention.\n"
    "Rules:\n"
    "- Input lines are numbered. You MAY merge consecutive numbers into one "
    "sentence when they are fragments of the same utterance.\n"
    "- Output format ONLY:\n"
    "  N. きれいな日本語。\n"
    "  or for a merge: A-B. きれいな日本語。\n"
    "  (A and B are inclusive cue numbers from the input.)\n"
    "- Cover every input cue number exactly once across your output ranges. "
    "Do not skip, overlap, or invent cue numbers outside the batch.\n"
    "- Fix digit soup, glued words, and broken fragments into natural Japanese.\n"
    "- Add 。！？ where a sentence clearly ends. Prefer short subtitle sentences.\n"
    "- Preserve meaning and names. Do NOT invent facts that are not in the input.\n"
    "- Drop empty fillers (えー/あの/うん) when they only clutter.\n"
    "- Output Japanese only — no English, no commentary, no quotes around lines.\n"
    "- Do not output thinking, analysis, or <think> blocks — only the numbered lines."
)

# 12. text  |  12-14. text  | separators . ): ： -
RANGE_RE = re.compile(
    r"^\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\s*[\.\):：\-]\s*(.+?)\s*$"
)


def parse_range_lines(text: str) -> list[tuple[int, int, str]]:
    """Parse model output into (id_start, id_end, text) rows."""
    out: list[tuple[int, int, str]] = []
    for raw in (text or "").splitlines():
        m = RANGE_RE.match(raw)
        if not m:
            continue
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) is not None else a
        if b < a:
            a, b = b, a
        body = m.group(3).strip()
        if body:
            out.append((a, b, body))
    return out


def apply_normalized_batch(
    batch: list[dict],
    parsed: list[tuple[int, int, str]],
) -> list[dict]:
    """
    Map parsed merge ranges onto batch segments.
    Invalid / overlapping / out-of-batch ranges are skipped; any uncovered
    cue ids are kept as original segments (no invented text).
    """
    by_id = {int(s["id"]): s for s in batch}
    batch_ids = [int(s["id"]) for s in batch]
    covered: set[int] = set()
    pieces: list[dict] = []

    for a, b, text in parsed:
        ids = list(range(a, b + 1))
        if not ids:
            continue
        if any(i not in by_id for i in ids):
            continue
        if any(i in covered for i in ids):
            continue
        # Must be contiguous cues that actually appear in this batch order
        if ids != [i for i in batch_ids if a <= i <= b]:
            continue
        first = by_id[a]
        last = by_id[b]
        asr_start = float(first.get("asr_start", first["start"]))
        pieces.append(
            {
                "start": float(first["start"]),
                "end": float(last["end"]),
                "asr_start": asr_start,
                "text": text.strip(),
                "id_start": a,
                "id_end": b,
            }
        )
        covered.update(ids)

    # Keep originals for anything the model skipped (in batch order).
    for sid in batch_ids:
        if sid in covered:
            continue
        seg = by_id[sid]
        pieces.append(
            {
                "start": float(seg["start"]),
                "end": float(seg["end"]),
                "asr_start": float(seg.get("asr_start", seg["start"])),
                "text": str(seg.get("text") or "").strip(),
                "id_start": sid,
                "id_end": sid,
            }
        )

    pieces.sort(key=lambda p: (p["start"], p["end"], p["id_start"]))
    return [p for p in pieces if p["text"]]


def rebuild_segments(pieces: list[dict]) -> list[dict]:
    """Re-number segments 0..n-1 for downstream MT; keep ASR anchors."""
    out = []
    for i, p in enumerate(pieces):
        text = str(p.get("text") or "").strip()
        if not text:
            continue
        start = float(p["start"])
        out.append(
            {
                "id": i,
                "start": start,
                "end": float(p["end"]),
                "asr_start": float(p.get("asr_start", start)),
                "text": text,
            }
        )
    return out


def make_batches(segments, max_lines: int, max_chars: int):
    batch = []
    chars = 0
    for seg in segments:
        batch.append(seg)
        chars += len(str(seg.get("text") or ""))
        if len(batch) >= max_lines or chars >= max_chars:
            yield batch
            batch = []
            chars = 0
    if batch:
        yield batch


def normalize_batch(base, model, batch, context) -> list[dict]:
    lines = []
    if context:
        lines.append("Context — previous normalized sentences (do NOT rewrite these):")
        for ctext in context:
            lines.append(f"- {ctext}")
        lines.append("")
    lines.append(
        "Normalize these Japanese ASR cues into clear sentences. "
        "Merge consecutive numbers when they are one utterance. "
        "Cover every cue number exactly once:"
    )
    for seg in batch:
        sid = int(seg["id"])
        text = str(seg.get("text") or "").strip()
        lines.append(f"{sid}. {text}")

    raw = call_ollama(
        base,
        model,
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "\n".join(lines)},
        ],
        temperature=0.15,
        num_predict=2048,
    )
    parsed = parse_range_lines(raw)
    if not parsed:
        print(
            f"[normalize_jp] warning: empty parse for ids "
            f"{batch[0]['id']}-{batch[-1]['id']}, keeping originals",
            file=sys.stderr,
        )
    return apply_normalized_batch(batch, parsed)


def srt_timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main() -> int:
    p = argparse.ArgumentParser(
        description="Normalize/merge JP ASR segments into clear sentences via Ollama"
    )
    p.add_argument("segments_json", help="segments.jp.json from ASR")
    p.add_argument("--ollama", default="http://localhost:11434")
    p.add_argument("--model", default="qwen3:14b")
    p.add_argument("--chunk-lines", type=int, default=20)
    p.add_argument("--chunk-chars", type=int, default=1800)
    p.add_argument("--context-lines", type=int, default=4)
    p.add_argument("--max-cue-seconds", type=float, default=8.0)
    p.add_argument("--max-cue-chars", type=int, default=42)
    p.add_argument("--out-json", required=True)
    p.add_argument("--out-srt", required=True)
    args = p.parse_args()

    with open(args.segments_json, "r", encoding="utf-8") as f:
        data = json.load(f)
    segments = data.get("segments") or []
    if not segments:
        print("[normalize_jp] no segments", file=sys.stderr)
        return 1

    # Ensure stable integer ids for merge ranges; seed ASR anchors.
    for i, seg in enumerate(segments):
        if "id" not in seg:
            seg["id"] = i
        if "asr_start" not in seg:
            seg["asr_start"] = float(seg["start"])

    batches = list(make_batches(segments, args.chunk_lines, args.chunk_chars))
    merged_pieces: list[dict] = []
    context: list[str] = []

    for bi, batch in enumerate(batches):
        print(
            f"[normalize_jp] batch {bi + 1}/{len(batches)} ({len(batch)} lines)",
            file=sys.stderr,
        )
        pieces = normalize_batch(args.ollama, args.model, batch, context)
        merged_pieces.extend(pieces)
        context = (context + [p["text"] for p in pieces])[-args.context_lines :]
        print(f"PROGRESS {(bi + 1) / max(len(batches), 1) * 0.9:.4f}", flush=True)

    rebuilt = rebuild_segments(merged_pieces)
    clamped = normalize_cues(
        rebuilt,
        max_duration=args.max_cue_seconds,
        max_chars=args.max_cue_chars,
    )
    # Anchor-aware repair again after normalize merges/splits.
    repaired = repair_cue_timing(
        clamped,
        max_duration=args.max_cue_seconds,
    )
    out_segments = []
    for i, s in enumerate(repaired):
        out_segments.append(
            {
                "id": i,
                "start": s["start"],
                "end": s["end"],
                "asr_start": s.get("asr_start", s["start"]),
                "text": s["text"],
            }
        )

    with open(args.out_srt, "w", encoding="utf-8") as f:
        for i, s in enumerate(out_segments, 1):
            f.write(
                f"{i}\n{srt_timestamp(s['start'])} --> {srt_timestamp(s['end'])}\n{s['text']}\n\n"
            )

    meta = {
        k: data[k]
        for k in data
        if k != "segments"
    }
    meta.update(
        {
            "source_language": data.get("source_language", "ja"),
            "normalized_jp": True,
            "normalize_model": args.model,
            "segments_raw_count": len(segments),
            "segments": out_segments,
        }
    )
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(
        f"[normalize_jp] {len(segments)} → {len(out_segments)} cues; "
        f"wrote {args.out_json}, {args.out_srt}",
        file=sys.stderr,
    )
    print("PROGRESS 1.0", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
