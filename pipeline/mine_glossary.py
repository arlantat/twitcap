#!/usr/bin/env python3
"""Mine glossary term proposals from finished JP/translated segment pairs.

Generic across domains and target languages: the focus comes from the domain
pack's profile.md, the language from --lang. Writes a JSON proposals report
consumed by the Node job runner (which merges into the pack's glossary).

Progress: PROGRESS <0..1>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from domain_context import lang_spec, load_domain_pack
from ollama_text import call_ollama


def build_system_prompt(lang_name: str, focus: str) -> str:
    lines = [
        "You extract stable proper nouns and catchphrases from Japanese "
        f"livestream subtitles paired with {lang_name} translations, to build "
        "a reusable glossary.",
    ]
    if focus.strip():
        lines.append("Domain context for what matters here:")
        lines.append(focus.strip())
    lines += [
        "Rules:",
        "- Reply with ONLY a JSON array of objects.",
        '- Each object: {"jp":"...","tl":"...","confidence":"high"|"low",'
        '"alternatives":["..."]}',
        '- "tl" is the preferred rendering in ' + lang_name + ".",
        "- jp must be a short term (≤20 chars), not a full sentence.",
        "- confidence=high only when the rendering is clearly established.",
        "- If unsure or multiple spellings exist, confidence=low and list alternatives.",
        "- Skip one-off chatter, fillers, and generic words.",
        "- No markdown fences, no commentary.",
    ]
    return "\n".join(lines)

FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I)


def strip_fence(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = FENCE_RE.sub("", t).strip()
        # handle opening fence line
        if t.lower().startswith("json"):
            t = t[4:].lstrip()
    return t.strip()


def parse_proposals(raw: str) -> list[dict]:
    """Parse miner JSON array; tolerant of fences / surrounding junk."""
    text = strip_fence(raw)
    # Find outermost array
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out = []
    for item in data:
        if not isinstance(item, dict):
            continue
        jp = str(item.get("jp") or "").strip()
        # "tl" is current; "en" accepted for older model replies.
        tl = str(item.get("tl") or item.get("en") or "").strip()
        if not jp or not tl:
            continue
        conf = str(item.get("confidence") or "low").lower()
        if conf not in ("high", "low"):
            conf = "low"
        alts = item.get("alternatives") or []
        if not isinstance(alts, list):
            alts = []
        out.append(
            {
                "jp": jp,
                "tl": tl,
                "confidence": conf,
                "alternatives": [str(a).strip() for a in alts if str(a).strip()],
            }
        )
    return out


def sample_pairs(segments: list[dict], *, max_pairs: int = 80) -> list[dict]:
    """Pick a spread of JP/translation pairs for the miner prompt."""
    pairs = []
    for s in segments:
        jp = str(s.get("text_jp") or s.get("text") or "").strip()
        tl = str(s.get("text_tl") or s.get("text_en") or "").strip()
        if jp and tl:
            pairs.append({"jp": jp, "tl": tl})
    if len(pairs) <= max_pairs:
        return pairs
    step = len(pairs) / max_pairs
    return [pairs[int(i * step)] for i in range(max_pairs)]


def mine_proposals(
    base: str, model: str, pairs: list[dict], lang_name: str, focus: str
) -> list[dict]:
    if not pairs:
        return []
    lines = [
        f"Extract glossary terms from these JP→{lang_name} subtitle pairs:",
        "",
    ]
    for i, p in enumerate(pairs, 1):
        lines.append(f"{i}. JP: {p['jp']}")
        lines.append(f"   TL: {p['tl']}")
    raw = call_ollama(
        base,
        model,
        [
            {"role": "system", "content": build_system_prompt(lang_name, focus)},
            {"role": "user", "content": "\n".join(lines)},
        ],
        temperature=0.1,
        num_predict=2048,
    )
    return parse_proposals(raw)


def main() -> int:
    p = argparse.ArgumentParser(
        description="Mine glossary proposals from translated segments"
    )
    p.add_argument("sub_json", help="segments.<lang>.json from translation")
    p.add_argument("--ollama", default="http://localhost:11434")
    p.add_argument("--model", default="qwen3:14b")
    p.add_argument("--lang", default="vi", help="Target language mined (vi/en)")
    p.add_argument(
        "--domain-dir",
        default="",
        help="Domain pack dir — profile.md steers what terms matter",
    )
    p.add_argument("--out-proposals", required=True, help="Write proposals JSON")
    p.add_argument("--job-id", default="")
    p.add_argument("--max-pairs", type=int, default=80)
    args = p.parse_args()

    lang_name = lang_spec(args.lang)["name"]
    focus = ""
    if args.domain_dir:
        try:
            focus = load_domain_pack(args.domain_dir)["profile"]
        except Exception:
            pass

    path = Path(args.sub_json)
    data = json.loads(path.read_text(encoding="utf-8"))
    segments = data.get("segments") or []
    print("PROGRESS 0.1", flush=True)
    pairs = sample_pairs(segments, max_pairs=args.max_pairs)
    print(
        f"[mine_glossary] sampling {len(pairs)}/{len(segments)} pairs (lang={args.lang})",
        file=sys.stderr,
    )
    print("PROGRESS 0.3", flush=True)
    proposals = mine_proposals(args.ollama, args.model, pairs, lang_name, focus)
    print("PROGRESS 0.9", flush=True)

    out = {
        "jobId": args.job_id or None,
        "lang": args.lang,
        "pairCount": len(pairs),
        "proposals": proposals,
    }
    Path(args.out_proposals).write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"[mine_glossary] {len(proposals)} proposals → {args.out_proposals}",
        file=sys.stderr,
    )
    print("PROGRESS 1.0", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
