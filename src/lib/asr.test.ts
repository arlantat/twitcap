import assert from "node:assert/strict";
import test from "node:test";
import { buildTranscribeArgs, resolveAsrBackend } from "./asr";

test("resolveAsrBackend defaults to qwen3", () => {
  assert.equal(resolveAsrBackend(undefined), "qwen3");
  assert.equal(resolveAsrBackend(""), "qwen3");
  assert.equal(resolveAsrBackend("qwen3"), "qwen3");
});

test("resolveAsrBackend accepts whisper and qwen aliases", () => {
  assert.equal(resolveAsrBackend("faster-whisper"), "faster-whisper");
  assert.equal(resolveAsrBackend("whisper"), "faster-whisper");
  assert.equal(resolveAsrBackend("Qwen3-ASR"), "qwen3");
  assert.equal(resolveAsrBackend("qwen"), "qwen3");
});

const baseCfg = {
  pythonBin: "python3",
  pipelineDir: "/app/pipeline",
  whisperModel: "large-v3-turbo",
  whisperLanguage: "ja",
  whisperDevice: "auto",
  whisperComputeType: "int8",
  whisperMaxCueSeconds: 8,
  whisperMaxCueChars: 42,
  qwenModel: "Qwen/Qwen3-ASR-1.7B",
  qwenAligner: "Qwen/Qwen3-ForcedAligner-0.6B",
  qwenDevice: "mps",
  qwenDtype: "float16",
  qwenChunkSeconds: 240,
};

test("buildTranscribeArgs keeps faster-whisper script and flags", () => {
  const out = buildTranscribeArgs(
    { ...baseCfg, asrBackend: "faster-whisper" },
    "/data/audio.mp4",
    "/data/segments.jp.json",
    "/data/captions.jp.srt"
  );
  assert.match(out.script, /transcribe\.py$/);
  assert.equal(out.args[0], out.script);
  assert.ok(out.args.includes("large-v3-turbo"));
  assert.ok(out.args.includes("--compute-type"));
  assert.ok(out.args.includes("--max-cue-seconds"));
  assert.ok(!out.args.includes("transcribe_qwen3.py"));
  assert.match(out.label, /faster-whisper/);
});

test("buildTranscribeArgs selects qwen3 script and aligner flags", () => {
  const out = buildTranscribeArgs(
    { ...baseCfg, asrBackend: "qwen3" },
    "/data/audio.mp4",
    "/data/segments.jp.json",
    "/data/captions.jp.srt"
  );
  assert.match(out.script, /transcribe_qwen3\.py$/);
  assert.equal(out.args[0], out.script);
  assert.ok(out.args.includes("Qwen/Qwen3-ASR-1.7B"));
  assert.ok(out.args.includes("Qwen/Qwen3-ForcedAligner-0.6B"));
  assert.ok(out.args.includes("Japanese"));
  assert.ok(out.args.includes("--chunk-seconds"));
  assert.ok(!out.args.includes("--compute-type"));
  assert.ok(!out.args.includes("--context"));
  assert.match(out.label, /qwen3/);
});

test("buildTranscribeArgs passes ASR context to qwen3 only", () => {
  const qwen = buildTranscribeArgs(
    { ...baseCfg, asrBackend: "qwen3", asrContext: "ひーちゃん、まつりす、名森" },
    "/data/audio.mp4",
    "/data/segments.jp.json",
    "/data/captions.jp.srt"
  );
  const i = qwen.args.indexOf("--context");
  assert.ok(i > 0);
  assert.match(qwen.args[i + 1], /ひーちゃん/);

  const whisper = buildTranscribeArgs(
    { ...baseCfg, asrBackend: "faster-whisper", asrContext: "ひーちゃん" },
    "/data/audio.mp4",
    "/data/segments.jp.json",
    "/data/captions.jp.srt"
  );
  assert.ok(!whisper.args.includes("--context"));
});
