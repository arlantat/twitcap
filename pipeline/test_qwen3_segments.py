#!/usr/bin/env python3
import unittest

from qwen3_segments import merge_time_stamps


class MergeTimeStampsTest(unittest.TestCase):
    def test_merges_tokens_and_splits_on_punctuation(self):
        stamps = [
            {"text": "こんにちは", "start": 0.0, "end": 0.4},
            {"text": "、", "start": 0.4, "end": 0.5},
            {"text": "今日", "start": 0.5, "end": 0.8},
            {"text": "は", "start": 0.8, "end": 0.9},
            {"text": "いい", "start": 0.9, "end": 1.1},
            {"text": "天気", "start": 1.1, "end": 1.4},
            {"text": "です", "start": 1.4, "end": 1.7},
            {"text": "。", "start": 1.7, "end": 1.8},
            {"text": "ね", "start": 2.0, "end": 2.2},
            {"text": "。", "start": 2.2, "end": 2.3},
        ]
        cues = merge_time_stamps(stamps, max_chars=80, max_duration=10.0)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0]["text"], "こんにちは、今日はいい天気です。")
        self.assertEqual(cues[0]["start"], 0.0)
        self.assertEqual(cues[0]["end"], 1.8)
        self.assertEqual(cues[1]["text"], "ね。")
        self.assertEqual(cues[1]["start"], 2.0)

    def test_offsets_are_preserved(self):
        stamps = [
            {"text": "あ", "start": 240.0, "end": 240.3},
            {"text": "。", "start": 240.3, "end": 240.4},
        ]
        cues = merge_time_stamps(stamps)
        self.assertEqual(cues[0]["start"], 240.0)
        self.assertEqual(cues[0]["end"], 240.4)


if __name__ == "__main__":
    unittest.main()
