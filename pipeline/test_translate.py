#!/usr/bin/env python3
import unittest

from translate import reflow_sentence


class ReflowSentenceTest(unittest.TestCase):
    def test_splits_by_jp_weight(self):
        pieces = reflow_sentence(
            "Mọi người bình tĩnh ăn bánh mì đi nha nhé", [10, 10]
        )
        self.assertEqual(len(pieces), 2)
        self.assertTrue(pieces[0] and pieces[1])
        self.assertEqual(" ".join(pieces), "Mọi người bình tĩnh ăn bánh mì đi nha nhé")

    def test_single_cue_whole_sentence(self):
        self.assertEqual(reflow_sentence("Xin chào.", [5]), ["Xin chào."])

    def test_scarce_words_leave_trailing_cues_empty(self):
        pieces = reflow_sentence("Ừ.", [4, 4, 4])
        self.assertEqual(pieces[0], "Ừ.")
        self.assertEqual(pieces[1], "")
        self.assertEqual(pieces[2], "")

    def test_uneven_weights(self):
        long = "một hai ba bốn năm sáu bảy tám chín mười"
        pieces = reflow_sentence(long, [30, 10])
        self.assertGreater(len(pieces[0].split()), len(pieces[1].split()))


if __name__ == "__main__":
    unittest.main()
