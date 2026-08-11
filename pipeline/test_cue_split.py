#!/usr/bin/env python3
import unittest

from cue_split import normalize_cues, repair_cue_timing, words_to_cues


class NormalizeCuesTest(unittest.TestCase):
    def test_clamps_whisper_mega_cue(self):
        cues = normalize_cues(
            [
                {
                    "id": 0,
                    "start": 313.55,
                    "end": 1028.53,
                    "text": "後から言うのは簡単だけど、作るのは別問題だよね。",
                }
            ],
            max_duration=8.0,
            max_chars=42,
        )
        self.assertGreaterEqual(len(cues), 1)
        for c in cues:
            self.assertLessEqual(c["end"] - c["start"], 20.0)
            # Late-packed near ASR end — must not cover leading silence at 313.
            self.assertGreater(c["start"], 900.0)

    def test_splits_on_jp_punctuation(self):
        cues = normalize_cues(
            [
                {
                    "id": 0,
                    "start": 0.0,
                    "end": 6.0,
                    "text": "こんばんは。まだお風呂入ってないわ。",
                }
            ]
        )
        self.assertEqual(len(cues), 2)
        self.assertIn("こんばんは", cues[0]["text"])
        self.assertIn("お風呂", cues[1]["text"])
        self.assertAlmostEqual(cues[0]["start"], 0.0)
        self.assertLess(cues[0]["end"], cues[1]["end"])

    def test_words_to_cues_respects_max_duration(self):
        words = []
        t = 0.0
        for i, tok in enumerate(["今日", "は", "いい", "天気", "です", "ね", "。"] * 8):
            words.append({"text": tok, "start": t, "end": t + 0.3})
            t += 0.3
        cues = words_to_cues(words, max_duration=4.0, max_chars=30)
        self.assertGreater(len(cues), 1)
        for c in cues:
            self.assertLessEqual(c["end"] - c["start"], 6.0)

    def test_tags_output_cues_with_source_segment_index(self):
        """Each display cue must know which input sentence it came from."""
        cues = normalize_cues(
            [
                {"id": 0, "start": 0.0, "end": 6.0, "text": "こんばんは。まだお風呂入ってないわ。"},
                {"id": 1, "start": 6.0, "end": 8.0, "text": "はい。"},
            ]
        )
        self.assertGreaterEqual(len(cues), 3)
        srcs = [c["src"] for c in cues]
        self.assertEqual(srcs[:2], [0, 0])
        self.assertEqual(srcs[-1], 1)

    def test_normalize_expands_collapsed_timestamps_before_split(self):
        """42 chars jammed into 0.35s must expand so speech is readable on timeline."""
        text = "やすくそうになってる人も多いけど綾子先生はねいいイラスト作る人じゃないと"
        cues = normalize_cues(
            [{"id": 0, "start": 100.0, "end": 100.35, "text": text}],
            max_duration=8.0,
            max_chars=42,
        )
        self.assertGreaterEqual(len(cues), 1)
        total = cues[-1]["end"] - cues[0]["start"]
        # ~8 chars/sec → need several seconds, not 0.35s
        self.assertGreaterEqual(total, 3.0)
        for c in cues:
            self.assertGreaterEqual(c["end"] - c["start"], 0.35)


class RepairCueTimingTest(unittest.TestCase):
    def test_expands_undersized_cues_to_speech_duration(self):
        repaired = repair_cue_timing(
            [
                {
                    "id": 0,
                    "start": 10.0,
                    "end": 10.35,
                    "text": "こんにちは、まだお風呂に入ってないわ。",
                }
            ]
        )
        self.assertEqual(len(repaired), 1)
        dur = repaired[0]["end"] - repaired[0]["start"]
        self.assertGreaterEqual(dur, 2.5)
        self.assertLessEqual(dur, 8.0)

    def test_removes_overlaps_by_sequencing(self):
        repaired = repair_cue_timing(
            [
                {"id": 0, "start": 5.0, "end": 8.0, "text": "あいうえお"},
                {"id": 1, "start": 6.0, "end": 9.0, "text": "かきくけこ"},
                {"id": 2, "start": 6.0, "end": 6.35, "text": "さしすせそ"},
            ]
        )
        for a, b in zip(repaired, repaired[1:]):
            self.assertLessEqual(a["end"], b["start"] + 1e-6)
            self.assertLess(a["start"], b["start"] + 1e-6)
        self.assertAlmostEqual(repaired[0]["start"], 5.0)

    def test_collapsed_cluster_gets_sequential_readable_spans(self):
        repaired = repair_cue_timing(
            [
                {
                    "id": 0,
                    "start": 342.88,
                    "end": 343.23,
                    "text": "マグカップとかでだってさいらっしゃった",
                },
                {
                    "id": 1,
                    "start": 342.88,
                    "end": 343.23,
                    "text": "教えてくれよあとよくなんかラクラセなのさ",
                },
                {
                    "id": 2,
                    "start": 342.88,
                    "end": 343.23,
                    "text": "上手く走るみたいな天井まっすぐそれ以外は",
                },
            ]
        )
        self.assertEqual(len(repaired), 3)
        for c in repaired:
            self.assertGreaterEqual(c["end"] - c["start"], 1.5)
        for a, b in zip(repaired, repaired[1:]):
            self.assertLessEqual(a["end"], b["start"] + 1e-6)

    def test_spaced_asr_starts_do_not_cascade_lag(self):
        """When ASR starts are spaced, mid-chain cues must stay near those anchors."""
        segs = []
        for i in range(12):
            start = 100.0 + i * 3.0
            segs.append(
                {
                    "id": i,
                    "start": start,
                    "end": start + 0.35,
                    "text": "あいうえおかきくけこ",  # 10 chars → ~1.6s need
                }
            )
        repaired = repair_cue_timing(segs, max_duration=8.0)
        self.assertEqual(len(repaired), 12)
        mid = repaired[6]
        # Original ASR start was 118.0; must not lag more than ~0.5s
        self.assertLessEqual(abs(mid["start"] - 118.0), 0.5)
        for a, b in zip(repaired, repaired[1:]):
            self.assertLessEqual(a["end"], b["start"] + 1e-6)

    def test_next_asr_start_caps_previous_end(self):
        repaired = repair_cue_timing(
            [
                {
                    "id": 0,
                    "start": 10.0,
                    "end": 10.2,
                    "text": "あいうえおかきくけこさしすせそたちつてと",  # long → wants ~3s
                },
                {"id": 1, "start": 11.0, "end": 11.5, "text": "はい"},
            ],
            max_duration=8.0,
        )
        self.assertLessEqual(repaired[0]["end"], repaired[1]["start"] + 1e-6)
        self.assertAlmostEqual(repaired[1]["start"], 11.0, places=2)

    def test_sane_asr_voice_bounds_preserved(self):
        """When ASR span is sane, keep voice start/end — do not invent reading time."""
        repaired = repair_cue_timing(
            [
                {
                    "id": 0,
                    "start": 10.0,
                    "end": 12.4,
                    "text": "はい",
                }
            ]
        )
        self.assertEqual(len(repaired), 1)
        self.assertAlmostEqual(repaired[0]["start"], 10.0, places=2)
        self.assertAlmostEqual(repaired[0]["end"], 12.4, places=2)

    def test_collapsed_cluster_leaves_long_silence_empty(self):
        """Do not march collapsed cues through a long quiet gap before next speech."""
        repaired = repair_cue_timing(
            [
                {
                    "id": 0,
                    "start": 100.0,
                    "end": 100.35,
                    "text": "あいうえおかきくけこ",
                },
                {
                    "id": 1,
                    "start": 100.0,
                    "end": 100.35,
                    "text": "さしすせそたちつてと",
                },
                {
                    "id": 2,
                    "start": 100.0,
                    "end": 100.35,
                    "text": "なにぬねのはひふへほ",
                },
                {
                    "id": 3,
                    "start": 130.0,
                    "end": 132.0,
                    "text": "次の話をはじめます",
                },
            ],
            max_duration=8.0,
        )
        cluster = repaired[:3]
        nxt = repaired[3]
        self.assertAlmostEqual(nxt["start"], 130.0, places=1)
        for c in cluster:
            self.assertLessEqual(c["end"], 108.0)
        for t in (112.0, 120.0, 125.0):
            covering = [c for c in repaired if c["start"] <= t <= c["end"]]
            self.assertEqual(covering, [], f"silence at {t} covered by {covering}")


if __name__ == "__main__":
    unittest.main()
