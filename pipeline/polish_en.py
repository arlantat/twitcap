#!/usr/bin/env python3
"""Polish English subtitle lines into clear, fluent sentences.

Inspired by extract-social-link's semantic polish step:
- rewrite into readable English
- preserve meaning; do not invent facts
- fix grammar/punctuation; split run-ons into clear sentences
- keep one numbered output line per input cue (subtitle timing stays intact)

Uses Ollama HTTP (stdlib only). Progress: PROGRESS <0..1>
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from ollama_text import call_ollama

SYSTEM_PROMPT = (
    "You polish English livestream subtitle lines into clear, fluent English. "
    "This is like a careful human edit of ASR/translation debris — not a new translation.\n"
    "Rules:\n"
    "- Keep each line's number. One output line per input line. Never merge/split line numbers.\n"
    "- Rewrite into natural English sentences a viewer enjoys reading.\n"
    "- Fix grammar, punctuation, glued words, and awkward phrasing.\n"
    "- Preserve meaning and factual content. Do NOT add claims that aren't in the line.\n"
    "- Do NOT leave Japanese characters in the output. If a line is still Japanese, "
    "translate it to clear English.\n"
    "- Prefer one short clear sentence per line. Drop empty fillers (uh/um) when clutter.\n"
    "- Keep names/romanizations when present. No commentary or quotes around the line.\n"
    "- Do not output thinking, analysis, or <think> blocks — only the numbered lines."
)

NUMBERED_RE = re.compile(r"^\s*(\d{1,4})\s*[\.\):：\-]\s*(.+?)\s*$")
JP_RE = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]")


def make_batches(segments, max_lines: int, max_chars: int):
    batch = []
    chars = 0
    for seg in segments:
        text = seg.get("text_tl") or seg.get("text_en") or seg.get("text") or ""
        batch.append(seg)
        chars += len(text)
        if len(batch) >= max_lines or chars >= max_chars:
            yield batch
            batch = []
            chars = 0
    if batch:
        yield batch


def parse_numbered(text: str) -> dict:
    out = {}
    for raw in text.splitlines():
        m = NUMBERED_RE.match(raw)
        if m:
            out[int(m.group(1))] = m.group(2).strip()
    return out


def polish_batch(base, model, batch, context) -> dict:
    lines = []
    if context:
        lines.append("Context — previous polished lines (do NOT rewrite these):")
        for cid, ctext in context:
            lines.append(f"{cid}. {ctext}")
        lines.append("")
    lines.append(
        "Polish these English subtitle lines into clear sentences. "
        "Reply with the same line numbers, one per line:"
    )
    for seg in batch:
        sid = int(seg["id"])
        text = (seg.get("text_tl") or seg.get("text_en") or seg.get("text") or "").strip()
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
    parsed = parse_numbered(raw)
    result = {}
    for seg in batch:
        sid = int(seg["id"])
        original = (seg.get("text_tl") or seg.get("text_en") or seg.get("text") or "").strip()
        polished = (parsed.get(sid) or "").strip()
        if not polished:
            result[sid] = original
            print(f"[polish] warning: missing line {sid}, kept original", file=sys.stderr)
            continue
        # If model ignored the "no JP" rule, keep original when original was already EN.
        if JP_RE.search(polished) and not JP_RE.search(original):
            result[sid] = original
            print(f"[polish] warning: line {sid} still had JP, kept original EN", file=sys.stderr)
            continue
        result[sid] = polished
    return result


def srt_timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def vtt_timestamp(seconds: float) -> str:
    return srt_timestamp(seconds).replace(",", ".")


def main() -> int:
    p = argparse.ArgumentParser(description="Polish EN subtitle segments via Ollama")
    p.add_argument("segments_json", help="segments.en.json from translate.py")
    p.add_argument("--ollama", default="http://localhost:11434")
    p.add_argument("--model", default="qwen3:14b")
    p.add_argument("--chunk-lines", type=int, default=20)
    p.add_argument("--chunk-chars", type=int, default=1800)
    p.add_argument("--context-lines", type=int, default=4)
    p.add_argument("--out-srt", required=True)
    p.add_argument("--out-vtt", required=True)
    p.add_argument("--out-json", required=True)
    args = p.parse_args()

    with open(args.segments_json, "r", encoding="utf-8") as f:
        data = json.load(f)
    segments = data.get("segments") or []
    if not segments:
        print("[polish] no segments", file=sys.stderr)

    batches = list(make_batches(segments, args.chunk_lines, args.chunk_chars))
    polished: dict[int, str] = {}
    context: list[tuple[int, str]] = []

    for bi, batch in enumerate(batches):
        print(
            f"[polish] batch {bi + 1}/{len(batches)} ({len(batch)} lines)",
            file=sys.stderr,
        )
        result = polish_batch(args.ollama, args.model, batch, context)
        polished.update(result)
        context = (
            context + [(int(s["id"]), result[int(s["id"])]) for s in batch]
        )[-args.context_lines :]
        print(f"PROGRESS {(bi + 1) / max(len(batches), 1):.4f}", flush=True)

    out_segments = []
    for seg in segments:
        sid = int(seg["id"])
        text_tl = polished.get(sid, seg.get("text_tl") or seg.get("text_en") or seg.get("text") or "")
        out_segments.append(
            {
                "id": sid,
                "start": seg["start"],
                "end": seg["end"],
                "text_jp": seg.get("text_jp", ""),
                "text_tl_raw": seg.get("text_tl") or seg.get("text_en") or seg.get("text") or "",
                "text_tl": text_tl,
            }
        )

    with open(args.out_srt, "w", encoding="utf-8") as f:
        for i, s in enumerate(out_segments, 1):
            f.write(
                f"{i}\n{srt_timestamp(s['start'])} --> {srt_timestamp(s['end'])}\n{s['text_tl']}\n\n"
            )

    with open(args.out_vtt, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for i, s in enumerate(out_segments, 1):
            f.write(
                f"{i}\n{vtt_timestamp(s['start'])} --> {vtt_timestamp(s['end'])}\n{s['text_tl']}\n\n"
            )

    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source_language": data.get("source_language", "ja"),
                "target_language": "en",
                "translate_model": data.get("model"),
                "polish_model": args.model,
                "polished": True,
                "segments": out_segments,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"[polish] wrote {args.out_srt}, {args.out_vtt}, {args.out_json}", file=sys.stderr)
    print("PROGRESS 1.0", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
