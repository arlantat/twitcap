#!/usr/bin/env python3
import unittest

from ollama_text import (
    build_chat_payload,
    is_qwen3_model,
    strip_think,
    with_no_think,
)


class StripThinkTest(unittest.TestCase):
    def test_strips_think_blocks(self):
        raw = (
            "<think>\nI should translate carefully.\n</think>\n"
            "0. Good evening.\n"
            "1. I haven't taken a bath yet."
        )
        out = strip_think(raw)
        self.assertNotIn("carefully", out)
        self.assertIn("0. Good evening.", out)
        self.assertIn("1. I haven't taken a bath yet.", out)

    def test_strips_thinking_tags_case_insensitive(self):
        raw = "<Thinking>plan</Thinking>\n2. Hello"
        self.assertEqual(strip_think(raw), "2. Hello")


class NoThinkPromptTest(unittest.TestCase):
    def test_detects_qwen3(self):
        self.assertTrue(is_qwen3_model("qwen3:14b"))
        self.assertFalse(is_qwen3_model("qwen2.5:7b"))

    def test_reinforces_system_for_qwen3_without_no_think_token(self):
        # /no_think alone can leave message.content empty on some Ollama+Qwen3
        # builds; API think=false is the reliable switch.
        msgs = [
            {"role": "system", "content": "Translate."},
            {"role": "user", "content": "0. こんにちは"},
        ]
        out = with_no_think(msgs, "qwen3:14b")
        self.assertNotIn("/no_think", out[-1]["content"])
        self.assertIn("Do not output thinking", out[0]["content"])

    def test_skips_prompt_mutation_for_qwen25(self):
        msgs = [{"role": "user", "content": "hi"}]
        out = with_no_think(msgs, "qwen2.5:7b")
        self.assertEqual(out[-1]["content"], "hi")

    def test_chat_payload_sets_think_false_for_qwen3(self):
        payload = build_chat_payload(
            "qwen3:14b",
            [{"role": "user", "content": "0. hi"}],
            temperature=0.1,
            num_predict=128,
        )
        self.assertIs(payload["think"], False)

    def test_chat_payload_omits_think_for_qwen25(self):
        payload = build_chat_payload(
            "qwen2.5:7b",
            [{"role": "user", "content": "0. hi"}],
            temperature=0.1,
            num_predict=128,
        )
        self.assertNotIn("think", payload)


if __name__ == "__main__":
    unittest.main()
