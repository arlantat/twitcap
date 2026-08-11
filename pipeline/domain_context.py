"""Load a domain pack (profile + per-language glossary) for Ollama MT prompts."""

from __future__ import annotations

import json
from pathlib import Path


def normalize_jp_key(jp: str) -> str:
    return "".join(str(jp or "").split()).strip()


def load_domain_pack(domain_dir: str | Path) -> dict:
    d = Path(domain_dir)
    profile = ""
    profile_path = d / "profile.md"
    if profile_path.is_file():
        profile = profile_path.read_text(encoding="utf-8")

    terms = []
    glossary_path = d / "glossary.json"
    if glossary_path.is_file():
        raw = json.loads(glossary_path.read_text(encoding="utf-8"))
        for t in raw.get("terms") or []:
            jp = normalize_jp_key(t.get("jp", ""))
            if not jp:
                continue
            translations = {
                k: str(v).strip()
                for k, v in (t.get("translations") or {}).items()
                if str(v or "").strip()
            }
            # Legacy single-language shape.
            legacy_en = str(t.get("en") or "").strip()
            if legacy_en and "en" not in translations:
                translations["en"] = legacy_en
            if not translations:
                continue
            terms.append(
                {
                    "jp": jp,
                    "translations": translations,
                    "source": t.get("source") or "learned",
                    "count": int(t.get("count") or 1),
                }
            )
    return {"profile": profile, "terms": terms, "dir": str(d)}


def format_domain_block(
    profile: str,
    terms: list[dict],
    lang: str,
    *,
    max_terms: int = 40,
    max_chars: int = 1500,
) -> str:
    profile = (profile or "").strip()
    sorted_terms = sorted(
        terms, key=lambda t: (-int(t.get("count") or 0), t.get("jp") or "")
    )
    gloss_lines: list[str] = []
    gloss_chars = 0
    for t in sorted_terms:
        tl = str((t.get("translations") or {}).get(lang) or "").strip()
        if not tl:
            continue
        if len(gloss_lines) >= max_terms:
            break
        line = f"{t['jp']} → {tl}"
        if gloss_chars + len(line) + 1 > max_chars and gloss_lines:
            break
        gloss_lines.append(line)
        gloss_chars += len(line) + 1

    parts = ["DOMAIN:", profile or "(no profile)", ""]
    if gloss_lines:
        parts.append("GLOSSARY (prefer these renderings when the Japanese matches):")
        parts.extend(gloss_lines)
        parts.append("")
    return "\n".join(parts)


LANG_SPECS = {
    "vi": {
        "name": "Vietnamese",
        "style": [
            "- Write natural spoken Vietnamese a young VN viewer reads at a glance — never word-by-word translation.",
            '- The streamer refers to herself as "mình" and the audience as "mọi người"; keep this consistent.',
            "- Keep Japanese names romanized; do not translate proper nouns into Vietnamese.",
            "- Use everyday Vietnamese phrasing where the Japanese is casual, but never invent content.",
            "- No Japanese characters and no English filler words in the output.",
        ],
    },
    "en": {
        "name": "English",
        "style": [
            "- Each line must be a fully coherent standard English sentence a native speaker would say.",
            "- Prefer natural meaning over word-for-word Japanese when ASR is fragmented or noisy.",
            "- Smooth fillers and glue fragments into clear speech; drop empty uh/um equivalents.",
            "- No Japanese characters in the output.",
        ],
    },
}


def lang_spec(code: str) -> dict:
    return LANG_SPECS.get((code or "").lower(), LANG_SPECS["vi"])
