import path from "path";

export type AsrBackend = "faster-whisper" | "qwen3";

export type AsrConfig = {
  asrBackend: AsrBackend;
  pythonBin: string;
  pipelineDir: string;
  whisperModel: string;
  whisperLanguage: string;
  whisperDevice: string;
  whisperComputeType: string;
  whisperMaxCueSeconds: number;
  whisperMaxCueChars: number;
  qwenModel: string;
  qwenAligner: string;
  qwenDevice: string;
  qwenDtype: string;
  qwenChunkSeconds: number;
};

export function resolveAsrBackend(raw: string | undefined): AsrBackend {
  const v = (raw || "qwen3").trim().toLowerCase();
  if (v === "faster-whisper" || v === "whisper" || v === "fw") {
    return "faster-whisper";
  }
  if (v === "qwen3" || v === "qwen3-asr" || v === "qwen") return "qwen3";
  return "qwen3";
}

/** CLI args for the selected JP ASR script (audio path first, then flags). */
export function buildTranscribeArgs(
  cfg: AsrConfig,
  audioAbsPath: string,
  outJsonAbs: string,
  outSrtAbs: string
): { script: string; args: string[]; label: string } {
  if (cfg.asrBackend === "qwen3") {
    return {
      script: path.join(cfg.pipelineDir, "transcribe_qwen3.py"),
      label: `qwen3 (${cfg.qwenModel})`,
      args: [
        path.join(cfg.pipelineDir, "transcribe_qwen3.py"),
        audioAbsPath,
        "--model",
        cfg.qwenModel,
        "--aligner",
        cfg.qwenAligner,
        "--device",
        cfg.qwenDevice,
        "--dtype",
        cfg.qwenDtype,
        "--chunk-seconds",
        String(cfg.qwenChunkSeconds),
        "--language",
        "Japanese",
        "--out-json",
        outJsonAbs,
        "--out-srt",
        outSrtAbs,
      ],
    };
  }

  return {
    script: path.join(cfg.pipelineDir, "transcribe.py"),
    label: `faster-whisper (${cfg.whisperModel})`,
    args: [
      path.join(cfg.pipelineDir, "transcribe.py"),
      audioAbsPath,
      "--model",
      cfg.whisperModel,
      "--language",
      cfg.whisperLanguage,
      "--device",
      cfg.whisperDevice,
      "--compute-type",
      cfg.whisperComputeType,
      "--max-cue-seconds",
      String(cfg.whisperMaxCueSeconds),
      "--max-cue-chars",
      String(cfg.whisperMaxCueChars),
      "--out-json",
      outJsonAbs,
      "--out-srt",
      outSrtAbs,
    ],
  };
}
