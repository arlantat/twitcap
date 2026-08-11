#!/usr/bin/env python3
"""Chunked, context-aware JP -> target-language subtitle translation via Ollama.

Reads the segments JSON produced by transcribe.py, translates numbered lines
in batches (previous JP lines + their translations supplied as context), and
writes .srt / .vtt / segments JSON in the requested target language
(Vietnamese by default; English supported).

Only Python stdlib is used (urllib) — Ollama speaks plain HTTP.
Progress is reported on stdout as "PROGRESS <0..1>" for the job runner.
"""

import argparse
import json
import re
import sys

from ollama_text import call_ollama
from domain_context import format_domain_block, lang_spec, load_domain_pack


def build_system_prompt(lang: dict) -> str:
    name = lang["name"]
    lines = [
        "You are a professional subtitle translator for Japanese live streams. "
        f"Translate casual spoken Japanese into clear, natural {name} "
        "that a viewer can read at a glance.",
        "Rules:",
        "- Keep each line's number; translate ONLY the text after the number.",
        "- One output line per input line; never merge or split line numbers.",
        f"- Prefer one short complete {name} sentence per line.",
        "- Do not invent content that is not in the input.",
        "- Keep names/proper nouns (romanize if unsure).",
        "- Prefer DOMAIN/GLOSSARY renderings when the Japanese matches.",
        "- Drop empty fillers (えー/あの) when they would clutter a subtitle.",
        *lang["style"],
        "- No commentary, no quotes around the translation, no Japanese left in the output.",
        "- Do not output thinking, analysis, or <think> blocks — only the numbered lines.",
    ]
    return "\n".join(lines)


def srt_timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def vtt_timestamp(seconds: float) -> str:
    return srt_timestamp(seconds).replace(",", ".")


def make_batches(segments, max_lines: int, max_chars: int):
    batch = []
    chars = 0
    for seg in segments:
        batch.append(seg)
        chars += len(seg["text"])
        if len(batch) >= max_lines or chars >= max_chars:
            yield batch
            batch = []
            chars = 0
    if batch:
        yield batch


NUMBERED_RE = re.compile(r"^\s*(\d{1,4})\s*[\.\):：\-]\s*(.+?)\s*$")


def parse_numbered(text: str) -> dict:
    out = {}
    for raw in text.splitlines():
        m = NUMBERED_RE.match(raw)
        if m:
            out[int(m.group(1))] = m.group(2)
    return out


def translate_batch(
    base, model, batch, context, lang: dict, domain_block: str = ""
) -> dict:
    """Translate one batch. Returns {segment_id: translated_text}."""
    lines = []
    if domain_block.strip():
        lines.append(domain_block.strip())
        lines.append("")
    if context:
        lines.append(
            "Context — previous lines already translated (do NOT retranslate):"
        )
        for cid, ctext, ctl in context:
            if ctl:
                lines.append(f"{cid}. {ctext} → {ctl}")
            else:
                lines.append(f"{cid}. {ctext}")
        lines.append("")
    lines.append(
        f"Translate these Japanese subtitle lines into clear {lang['name']}. "
        "Reply with the same line numbers, one per line:"
    )
    for seg in batch:
        lines.append(f"{seg['id']}. {seg['text']}")

    messages = [
        {"role": "system", "content": build_system_prompt(lang)},
        {"role": "user", "content": "\n".join(lines)},
    ]
    raw = call_ollama(base, model, messages, temperature=0.2, num_predict=2048)
    parsed = parse_numbered(raw)

    result = {}
    for seg in batch:
        sid = seg["id"]
        if sid in parsed and parsed[sid].strip():
            result[sid] = parsed[sid].strip()
        else:
            # never lose timing: fall back to the JP source line
            result[sid] = seg["text"]
            print(
                f"[translate] warning: missing line {sid} in model output, kept JP",
                file=sys.stderr,
            )
    return result


def main() -> int:
    p = argparse.ArgumentParser(
        description="Chunked JP->target-language subtitle translation via Ollama"
    )
    p.add_argument("segments_json", help="segments.jp.json from transcribe.py")
    p.add_argument("--ollama", default="http://localhost:11434")
    p.add_argument("--model", default="qwen3:14b")
    p.add_argument("--target-lang", default="vi", help="vi (default) or en")
    p.add_argument("--chunk-lines", type=int, default=30)
    p.add_argument("--chunk-chars", type=int, default=2200)
    p.add_argument("--context-lines", type=int, default=5)
    p.add_argument("--out-srt", required=True)
    p.add_argument("--out-vtt", required=True)
    p.add_argument("--out-json", required=True)
    p.add_argument(
        "--domain-dir",
        default="",
        help="Domain pack dir (profile.md + glossary.json)",
    )
    args = p.parse_args()

    lang = lang_spec(args.target_lang)
    domain_block = ""
    if args.domain_dir:
        pack = load_domain_pack(args.domain_dir)
        domain_block = format_domain_block(
            pack["profile"], pack["terms"], args.target_lang
        )
        print(
            f"[translate] domain pack: {len(pack['terms'])} glossary terms "
            f"(lang={args.target_lang})",
            file=sys.stderr,
        )

    with open(args.segments_json, "r", encoding="utf-8") as f:
        data = json.load(f)
    segments = data["segments"]
    if not segments:
        print("[translate] no segments to translate", file=sys.stderr)

    batches = list(make_batches(segments, args.chunk_lines, args.chunk_chars))
    translations = {}
    context = []  # [(id, jp_text, translated_text)] previous lines as context

    for bi, batch in enumerate(batches):
        print(
            f"[translate] batch {bi + 1}/{len(batches)} ({len(batch)} lines)",
            file=sys.stderr,
        )
        result = translate_batch(
            args.ollama, args.model, batch, context, lang, domain_block=domain_block
        )
        translations.update(result)
        context = (
            context + [(s["id"], s["text"], result.get(s["id"], "")) for s in batch]
        )[-args.context_lines:]
        print(f"PROGRESS {(bi + 1) / max(len(batches), 1):.4f}", flush=True)

    # merged output
    out_segments = []
    for seg in segments:
        out_segments.append(
            {
                "id": seg["id"],
                "start": seg["start"],
                "end": seg["end"],
                "text_jp": seg["text"],
                "text_tl": translations.get(seg["id"], seg["text"]),
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
                "source_language": data.get("language", "ja"),
                "target_language": args.target_lang,
                "model": args.model,
                "segments": out_segments,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"[translate] wrote {args.out_srt}, {args.out_vtt}, {args.out_json}", file=sys.stderr)
    print("PROGRESS 1.0", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
