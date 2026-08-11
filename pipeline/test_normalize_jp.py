#!/usr/bin/env python3
"""TDD for JP ASR normalize / merge helpers."""

import unittest

from normalize_jp import (
    apply_normalized_batch,
    parse_range_lines,
    rebuild_segments,
)


class ParseRangeLinesTest(unittest.TestCase):
    def test_parses_single_id(self):
        parsed = parse_range_lines("12. こんばんは。\n13. まだお風呂。")
        self.assertEqual(
            parsed,
            [
                (12, 12, "こんばんは。"),
                (13, 13, "まだお風呂。"),
            ],
        )

    def test_parses_merge_range(self):
        parsed = parse_range_lines("12-14. トイレ行ってくるね。")
        self.assertEqual(parsed, [(12, 14, "トイレ行ってくるね。")])

    def test_parses_colon_and_paren_separators(self):
        parsed = parse_range_lines("1: あ\n2) い\n3-4. う")
        self.assertEqual(
            parsed,
            [
                (1, 1, "あ"),
                (2, 2, "い"),
                (3, 4, "う"),
            ],
        )

    def test_ignores_junk_lines(self):
        parsed = parse_range_lines("thinking: nope\n5. 実文\n")
        self.assertEqual(parsed, [(5, 5, "実文")])


class ApplyNormalizedBatchTest(unittest.TestCase):
    def _segs(self):
        return [
            {"id": 10, "start": 1.0, "end": 2.0, "text": "こんに"},
            {"id": 11, "start": 2.0, "end": 3.5, "text": "ちはまだ"},
            {"id": 12, "start": 3.5, "end": 5.0, "text": "お風呂"},
        ]

    def test_merge_range_rebuilds_timing(self):
        batch = self._segs()
        out = apply_normalized_batch(
            batch,
            [(10, 12, "こんにちは。まだお風呂。")],
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["text"], "こんにちは。まだお風呂。")
        self.assertAlmostEqual(out[0]["start"], 1.0)
        self.assertAlmostEqual(out[0]["end"], 5.0)
        self.assertEqual(out[0]["id_start"], 10)
        self.assertEqual(out[0]["id_end"], 12)

    def test_missing_ids_keep_originals(self):
        batch = self._segs()
        # Model only returned first cue — rest must be kept as originals.
        out = apply_normalized_batch(batch, [(10, 10, "こんにちは。")])
        texts = [o["text"] for o in out]
        self.assertEqual(texts[0], "こんにちは。")
        self.assertIn("ちはまだ", texts)
        self.assertIn("お風呂", texts)
        # All original time span still covered
        starts = sorted(o["start"] for o in out)
        ends = sorted(o["end"] for o in out)
        self.assertAlmostEqual(starts[0], 1.0)
        self.assertAlmostEqual(ends[-1], 5.0)

    def test_empty_parse_keeps_all_originals(self):
        batch = self._segs()
        out = apply_normalized_batch(batch, [])
        self.assertEqual(len(out), 3)
        self.assertEqual(out[0]["text"], "こんに")

    def test_rejects_overlapping_or_out_of_batch_ranges(self):
        batch = self._segs()
        # 9 is not in batch; 11-12 overlaps after taking 10-11
        out = apply_normalized_batch(
            batch,
            [
                (9, 9, "無視"),
                (10, 11, "こんにちはまだ"),
                (11, 12, "重複は無視"),
            ],
        )
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["text"], "こんにちはまだ")
        self.assertEqual(out[1]["text"], "お風呂")


class RebuildSegmentsTest(unittest.TestCase):
    def test_renumbers_and_preserves_order(self):
        pieces = [
            {"start": 0.0, "end": 1.0, "text": "あ"},
            {"start": 1.0, "end": 2.5, "text": "い"},
        ]
        out = rebuild_segments(pieces)
        self.assertEqual([s["id"] for s in out], [0, 1])
        self.assertEqual(out[0]["text"], "あ")
        self.assertEqual(out[1]["text"], "い")


if __name__ == "__main__":
    unittest.main()
