import path from "path";
import { resolveAsrBackend, type AsrBackend } from "./asr";
import { resolveTargetLang } from "./lang";

const root = process.cwd();

function resolveFromRoot(p: string) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

/** Split env args; supports double/single quotes (e.g. chrome:"Profile 1"). */
export function parseExtraArgs(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out.filter(Boolean);
}

export const config = {
  jobsDir: resolveFromRoot(process.env.JOBS_DIR || "./data/jobs"),

  ytdlpBin: process.env.YTDLP_BIN || "yt-dlp",
  ytdlpExtraArgs: parseExtraArgs(process.env.YTDLP_EXTRA_ARGS || ""),

  pythonBin: process.env.PYTHON_BIN || "python3",

  /** faster-whisper | qwen3 — both JP-transcribe-only paths stay available. */
  asrBackend: resolveAsrBackend(process.env.ASR_BACKEND) as AsrBackend,

  whisperModel: process.env.WHISPER_MODEL || "large-v3-turbo",
  whisperDevice: process.env.WHISPER_DEVICE || "auto",
  whisperComputeType: process.env.WHISPER_COMPUTE_TYPE || "int8",
  whisperLanguage: "ja", // product decision: JP transcribe first, never task=translate
  whisperMaxCueSeconds: parseFloat(process.env.WHISPER_MAX_CUE_SECONDS || "8"),
  whisperMaxCueChars: parseInt(process.env.WHISPER_MAX_CUE_CHARS || "42", 10),

  qwenModel: process.env.QWEN_ASR_MODEL || "Qwen/Qwen3-ASR-1.7B",
  qwenAligner: process.env.QWEN_ALIGNER_MODEL || "Qwen/Qwen3-ForcedAligner-0.6B",
  qwenDevice: process.env.QWEN_ASR_DEVICE || "auto",
  qwenDtype: process.env.QWEN_ASR_DTYPE || "auto",
  qwenChunkSeconds: parseInt(process.env.QWEN_ASR_CHUNK_SECONDS || "240", 10),

  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(
    /\/+$/,
    ""
  ),
  /**
   * cursor = Composer 2.5 via @cursor/sdk (default, best coherent EN)
   * ollama = local TRANSLATE_MODEL
   */
  translateBackend: (process.env.TRANSLATE_BACKEND || "cursor").toLowerCase() ===
  "ollama"
    ? ("ollama" as const)
    : ("cursor" as const),
  cursorApiKey: (process.env.CURSOR_API_KEY || "").trim(),
  /** Composer 2.5 non-fast (omit fast param). */
  cursorTranslateModel: process.env.CURSOR_TRANSLATE_MODEL || "composer-2.5",
  translateModel: process.env.TRANSLATE_MODEL || "qwen3:14b",
  translateChunkLines: parseInt(process.env.TRANSLATE_CHUNK_LINES || "15", 10),
  translateChunkChars: parseInt(process.env.TRANSLATE_CHUNK_CHARS || "1200", 10),

  /** Merge/clean JP ASR into clear sentences before MT (recommended with Qwen). */
  polishJpEnabled: (process.env.POLISH_JP || "1") !== "0",
  normalizeJpModel:
    process.env.NORMALIZE_JP_MODEL ||
    process.env.TRANSLATE_MODEL ||
    "qwen3:14b",
  normalizeJpChunkLines: parseInt(process.env.NORMALIZE_JP_CHUNK_LINES || "20", 10),
  normalizeJpChunkChars: parseInt(process.env.NORMALIZE_JP_CHUNK_CHARS || "1800", 10),

  /** Optional EN rewrite; default off when JP normalize is the primary cleanup. */
  polishEnabled: (process.env.POLISH_EN || "0") !== "0",
  polishModel: process.env.POLISH_MODEL || process.env.TRANSLATE_MODEL || "qwen3:14b",
  polishChunkLines: parseInt(process.env.POLISH_CHUNK_LINES || "20", 10),
  polishChunkChars: parseInt(process.env.POLISH_CHUNK_CHARS || "1800", 10),

  pipelineDir: path.join(root, "pipeline"),

  /** Caption target language (vi default; en supported). Per-job override in the UI. */
  targetLang: resolveTargetLang(process.env.TARGET_LANG),

  /** Domain memory root (packs live in <domainDir>/packs/<slug>). */
  domainEnabled: (process.env.DOMAIN_ENABLED || "1") !== "0",
  domainDir: resolveFromRoot(process.env.DOMAIN_DIR || "./domain"),
  /** Default pack slug for new jobs. */
  domainPack: process.env.DOMAIN_PACK || "matsuri",
  domainMineModel:
    process.env.DOMAIN_MINE_MODEL ||
    process.env.TRANSLATE_MODEL ||
    "qwen3:14b",
};
