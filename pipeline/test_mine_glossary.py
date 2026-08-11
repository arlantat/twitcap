#!/usr/bin/env python3
import unittest

from mine_glossary import build_system_prompt, parse_proposals, sample_pairs, strip_fence


class ParseProposalsTest(unittest.TestCase):
    def test_parses_raw_array_with_tl_key(self):
        raw = (
            '[{"jp":"まつりす","tl":"Matsurisu","confidence":"high","alternatives":[]}]'
        )
        out = parse_proposals(raw)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["jp"], "まつりす")
        self.assertEqual(out[0]["tl"], "Matsurisu")
        self.assertEqual(out[0]["confidence"], "high")

    def test_accepts_legacy_en_key(self):
        raw = '[{"jp":"ホロライブ","en":"Hololive","confidence":"high"}]'
        out = parse_proposals(raw)
        self.assertEqual(out[0]["tl"], "Hololive")

    def test_parses_fenced_json(self):
        raw = """```json
[
  {"jp": "ホロライブ", "tl": "Hololive", "confidence": "high", "alternatives": []}
]
```"""
        out = parse_proposals(raw)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["tl"], "Hololive")

    def test_returns_empty_on_garbage(self):
        self.assertEqual(parse_proposals("nope"), [])

    def test_strip_fence(self):
        self.assertEqual(strip_fence("```\nhi\n```"), "hi")


class SamplePairsTest(unittest.TestCase):
    def test_samples_spread_and_accepts_text_tl(self):
        segs = [{"text_jp": f"日{i}", "text_tl": f"V{i}"} for i in range(100)]
        pairs = sample_pairs(segs, max_pairs=10)
        self.assertEqual(len(pairs), 10)
        self.assertEqual(pairs[0]["jp"], "日0")
        self.assertEqual(pairs[0]["tl"], "V0")

    def test_accepts_legacy_text_en(self):
        segs = [{"text_jp": "日", "text_en": "E"}]
        pairs = sample_pairs(segs)
        self.assertEqual(pairs[0]["tl"], "E")


class BuildSystemPromptTest(unittest.TestCase):
    def test_includes_language_and_focus(self):
        prompt = build_system_prompt("Vietnamese", "# Domain: Cooking streams\nChef talk.")
        self.assertIn("Vietnamese", prompt)
        self.assertIn("Cooking streams", prompt)
        self.assertIn('"tl"', prompt)

    def test_no_hardcoded_matsuri(self):
        prompt = build_system_prompt("Vietnamese", "")
        self.assertNotIn("Matsuri", prompt)
        self.assertNotIn("Hololive", prompt)


if __name__ == "__main__":
    unittest.main()
