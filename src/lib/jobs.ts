import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { buildTranscribeArgs } from "./asr";
import { applyProposalsToDomainDir } from "./applyDomainProposals";
import { config } from "./config";
import type { TermProposal } from "./domain";
import { resolvePackDir } from "./domainPacks";
import { LANGS, resolveTargetLang } from "./lang";
import type { Job } from "./types";

// ---------- global (HMR-safe) singletons ----------

type GlobalState = {
  queue: Promise<void>;
  children: Map<string, ChildProcess>;
};

const g = globalThis as unknown as { __twitcap?: GlobalState };
if (!g.__twitcap) {
  g.__twitcap = { queue: Promise.resolve(), children: new Map() };
}
const state = g.__twitcap;

// ---------- paths & persistence ----------

export function jobDir(id: string) {
  return path.join(config.jobsDir, id);
}

function jobJsonPath(id: string) {
  return path.join(jobDir(id), "job.json");
}

async function saveJob(job: Job) {
  job.updatedAt = Date.now();
  await fsp.writeFile(jobJsonPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

export async function getJob(id: string): Promise<Job | null> {
  try {
    const raw = await fsp.readFile(jobJsonPath(id), "utf8");
    return JSON.parse(raw) as Job;
  } catch {
    return null;
  }
}

export async function listJobs(): Promise<Job[]> {
  try {
    await fsp.mkdir(config.jobsDir, { recursive: true });
    const entries = await fsp.readdir(config.jobsDir, { withFileTypes: true });
    const jobs: Job[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const job = await getJob(e.name);
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

// ---------- job lifecycle ----------

export async function createJob(
  url: string,
  opts: { targetLang?: string; domainPack?: string } = {}
): Promise<Job> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await fsp.mkdir(jobDir(id), { recursive: true });
  const job: Job = {
    id,
    url,
    targetLang: resolveTargetLang(opts.targetLang ?? config.targetLang),
    domainPack: opts.domainPack || config.domainPack,
    status: "queued",
    step: "Waiting in queue",
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    artifacts: {},
  };
  await saveJob(job);
  enqueue(id);
  return job;
}

export async function removeJob(id: string): Promise<boolean> {
  const child = state.children.get(id);
  if (child && !child.killed) child.kill("SIGTERM");
  state.children.delete(id);
  try {
    await fsp.rm(jobDir(id), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Serial queue: one pipeline at a time (ASR/MT are CPU/GPU heavy). */
function enqueue(id: string) {
  state.queue = state.queue
    .then(() => runJob(id))
    .catch((err) => {
      console.error(`[job ${id}] unhandled runner error`, err);
    });
}

// ---------- pipeline runner ----------

const STEP_LABEL = {
  download: "Downloading audio with yt-dlp",
  transcribe: `Transcribing Japanese speech`,
  normalizeJp: "Normalizing Japanese sentences",
  translate: "Translating",
  polish: "Polishing English sentences",
};

async function update(id: string, patch: Partial<Job>) {
  const job = await getJob(id);
  if (!job) return null;
  Object.assign(job, patch);
  await saveJob(job);
  return job;
}

async function runJob(id: string) {
  const job = await getJob(id);
  if (!job) return;
  const dir = jobDir(id);

  try {
    // ---- 1. download -----------------------------------------------------
    await update(id, {
      status: "downloading",
      step: STEP_LABEL.download,
      progress: 0.01,
    });
    await runStep(
      id,
      config.ytdlpBin,
      [
        "-f",
        "bestaudio/best",
        "--no-playlist",
        "--write-info-json",
        "--newline",
        "-o",
        path.join(dir, "audio.%(ext)s"),
        ...config.ytdlpExtraArgs,
        job.url,
      ],
      { from: 0.01, to: 0.15, parseProgress: parseYtdlpProgress }
    );

    const audioFile = await findAudioFile(dir);
    if (!audioFile) throw new Error("yt-dlp finished but no audio file was found");

    let title: string | undefined;
    let duration: number | undefined;
    try {
      const infoRaw = await fsp.readFile(path.join(dir, "audio.info.json"), "utf8");
      const info = JSON.parse(infoRaw);
      title = info.title;
      duration = typeof info.duration === "number" ? info.duration : undefined;
    } catch {
      /* title/duration optional */
    }

    await update(id, {
      title,
      duration,
      artifacts: { ...job.artifacts, audio: audioFile },
    });

    // Domain pack powers ASR biasing, JP mishearing repair, and MT glossary.
    const packDir = config.domainEnabled
      ? resolvePackDir(config.domainDir, job.domainPack || config.domainPack)
      : null;

    // ---- 2. transcribe (JP ASR — transcribe task only) -------------------
    const segmentsJson = "segments.jp.json";
    const jpSrt = "captions.jp.srt";
    const asr = buildTranscribeArgs(
      {
        asrBackend: config.asrBackend,
        pythonBin: config.pythonBin,
        pipelineDir: config.pipelineDir,
        whisperModel: config.whisperModel,
        whisperLanguage: config.whisperLanguage,
        whisperDevice: config.whisperDevice,
        whisperComputeType: config.whisperComputeType,
        whisperMaxCueSeconds: config.whisperMaxCueSeconds,
        whisperMaxCueChars: config.whisperMaxCueChars,
        qwenModel: config.qwenModel,
        qwenAligner: config.qwenAligner,
        qwenDevice: config.qwenDevice,
        qwenDtype: config.qwenDtype,
        qwenChunkSeconds: config.qwenChunkSeconds,
        asrContext: packDir ? buildAsrContext(packDir) : undefined,
      },
      path.join(dir, audioFile),
      path.join(dir, segmentsJson),
      path.join(dir, jpSrt)
    );
    await update(id, {
      status: "transcribing",
      step: `${STEP_LABEL.transcribe} (${asr.label})`,
      progress: 0.15,
    });
    await runStep(id, config.pythonBin, asr.args, {
      from: 0.15,
      to: config.polishJpEnabled ? 0.55 : 0.7,
    });

    // ---- 2b. normalize JP sentences (merge/clean before MT) --------------
    if (config.polishJpEnabled) {
      await update(id, {
        status: "normalizing",
        step: `${STEP_LABEL.normalizeJp} (${config.normalizeJpModel})`,
        progress: 0.55,
      });
      const normalizeArgs = [
        path.join(config.pipelineDir, "normalize_jp.py"),
        path.join(dir, segmentsJson),
        "--ollama",
        config.ollamaBaseUrl,
        "--model",
        config.normalizeJpModel,
        "--chunk-lines",
        String(config.normalizeJpChunkLines),
        "--chunk-chars",
        String(config.normalizeJpChunkChars),
        "--max-cue-seconds",
        String(config.whisperMaxCueSeconds),
        "--max-cue-chars",
        String(config.whisperMaxCueChars),
        "--out-json",
        path.join(dir, segmentsJson),
        "--out-srt",
        path.join(dir, jpSrt),
      ];
      if (packDir) {
        normalizeArgs.push("--domain-dir", packDir);
      }
      await runStep(id, config.pythonBin, normalizeArgs, {
        from: 0.55,
        to: 0.72,
      });
    }

    // ---- 3. translate (Cursor Composer, OpenAI, or local Ollama) ----------
    const lang = LANGS[resolveTargetLang(job.targetLang ?? config.targetLang)];
    const subSrt = `captions.${lang.code}.srt`;
    const subVtt = `captions.${lang.code}.vtt`;
    const subJson = `segments.${lang.code}.json`;
    const translateFrom = config.polishJpEnabled ? 0.72 : 0.7;
    const polishThisJob = config.polishEnabled && lang.code === "en";
    const translateTo = polishThisJob ? 0.9 : 0.98;

    if (config.translateBackend === "cursor" || config.translateBackend === "openai") {
      if (config.translateBackend === "cursor" && !config.cursorApiKey) {
        throw new Error(
          "CURSOR_API_KEY is required for Composer translation. Add it to .env.local."
        );
      }
      if (config.translateBackend === "openai" && !config.openaiApiKey) {
        throw new Error(
          "OPENAI_API_KEY is required for OpenAI translation. Add it to .env.local."
        );
      }
      const mtLabel =
        config.translateBackend === "openai"
          ? `OpenAI ${config.openaiTranslateModel}`
          : `Cursor ${config.cursorTranslateModel}`;
      await update(id, {
        status: "translating",
        step: `${STEP_LABEL.translate} to ${lang.name} (${mtLabel})`,
        progress: translateFrom,
      });
      // Spawn outside Next's webpack bundle — @cursor/sdk breaks Next 14 bundling.
      await runStep(
        id,
        "npx",
        [
          "tsx",
          path.join(process.cwd(), "scripts/translate-cursor.ts"),
          path.join(dir, segmentsJson),
          "--out-srt",
          path.join(dir, subSrt),
          "--out-vtt",
          path.join(dir, subVtt),
          "--out-json",
          path.join(dir, subJson),
        ],
        { from: translateFrom, to: translateTo },
        {
          TRANSLATE_BACKEND: config.translateBackend,
          CURSOR_API_KEY: config.cursorApiKey,
          CURSOR_TRANSLATE_MODEL: config.cursorTranslateModel,
          OPENAI_API_KEY: config.openaiApiKey,
          OPENAI_TRANSLATE_MODEL: config.openaiTranslateModel,
          TARGET_LANG: lang.code,
          TRANSLATE_CHUNK_LINES: String(config.translateChunkLines),
          TRANSLATE_CHUNK_CHARS: String(config.translateChunkChars),
          DOMAIN_ENABLED: config.domainEnabled && packDir ? "1" : "0",
          DOMAIN_PACK_DIR: packDir || "",
        }
      );
    } else {
      await update(id, {
        status: "translating",
        step: `${STEP_LABEL.translate} to ${lang.name} (${config.translateModel})`,
        progress: translateFrom,
      });
      const ollamaArgs = [
        path.join(config.pipelineDir, "translate.py"),
        path.join(dir, segmentsJson),
        "--ollama",
        config.ollamaBaseUrl,
        "--model",
        config.translateModel,
        "--target-lang",
        lang.code,
        "--chunk-lines",
        String(config.translateChunkLines),
        "--chunk-chars",
        String(config.translateChunkChars),
        "--out-srt",
        path.join(dir, subSrt),
        "--out-vtt",
        path.join(dir, subVtt),
        "--out-json",
        path.join(dir, subJson),
      ];
      if (packDir) {
        ollamaArgs.push("--domain-dir", packDir);
      }
      await runStep(id, config.pythonBin, ollamaArgs, {
        from: translateFrom,
        to: translateTo,
      });
    }

    if (polishThisJob) {
      await update(id, {
        status: "polishing",
        step: `${STEP_LABEL.polish} (${config.polishModel})`,
        progress: 0.9,
      });
      await runStep(
        id,
        config.pythonBin,
        [
          path.join(config.pipelineDir, "polish_en.py"),
          path.join(dir, subJson),
          "--ollama",
          config.ollamaBaseUrl,
          "--model",
          config.polishModel,
          "--chunk-lines",
          String(config.polishChunkLines),
          "--chunk-chars",
          String(config.polishChunkChars),
          "--out-srt",
          path.join(dir, subSrt),
          "--out-vtt",
          path.join(dir, subVtt),
          "--out-json",
          path.join(dir, subJson),
        ],
        { from: 0.9, to: 0.98 }
      );
    }

    await update(id, {
      status: "done",
      step: "Done",
      progress: 1,
      artifacts: {
        ...(await getJob(id))?.artifacts,
        audio: audioFile,
        segmentsJson,
        jpSrt,
        subSrt,
        subVtt,
        subJson,
      },
    });

    // Autonomous glossary growth (non-fatal).
    if (config.domainEnabled && packDir) {
      try {
        await growDomainMemory(id, path.join(dir, subJson), lang.code, packDir);
      } catch (err) {
        console.error("[domain] mine/merge failed (non-fatal):", err);
      }
    }
  } catch (err) {
    const message = err instanceof StepError ? err.message : String(err);
    await update(id, {
      status: "error",
      step: "Failed",
      error: message,
      logTail: err instanceof StepError ? err.logTail : undefined,
    });
  } finally {
    state.children.delete(id);
  }
}

// ---------- step execution ----------

class StepError extends Error {
  logTail: string;
  constructor(message: string, logTail: string) {
    super(message);
    this.logTail = logTail;
  }
}

type StepOpts = {
  from: number; // overall progress range start
  to: number; // overall progress range end
  parseProgress?: (line: string) => number | null; // returns 0..1 within step
};

const PROGRESS_RE = /^PROGRESS\s+([0-9.]+)/;

function runStep(
  id: string,
  cmd: string,
  args: string[],
  opts: StepOpts,
  envExtra?: Record<string, string>
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...envExtra },
      shell: false,
    });
    state.children.set(id, child);

    let tail = "";
    let buf = "";
    let lastWrite = 0;

    const onLine = async (line: string) => {
      tail = (tail + line + "\n").slice(-4000);
      let frac: number | null = null;
      const m = PROGRESS_RE.exec(line);
      if (m) frac = parseFloat(m[1]);
      else if (opts.parseProgress) frac = opts.parseProgress(line);

      if (frac != null && isFinite(frac)) {
        const now = Date.now();
        if (now - lastWrite > 500) {
          // throttle disk writes
          lastWrite = now;
          const overall = opts.from + (opts.to - opts.from) * Math.min(frac, 1);
          await update(id, { progress: overall });
        }
      }
    };

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        void onLine(line);
      }
    });
    child.stderr.on("data", (d) => {
      tail = (tail + d.toString()).slice(-4000);
    });

    child.on("error", (e) => {
      state.children.delete(id);
      reject(
        new StepError(
          `Could not start "${cmd}" — is it installed and on PATH? (${e.message})`,
          tail
        )
      );
    });

    child.on("close", (code) => {
      state.children.delete(id);
      if (code === 0) resolve();
      else reject(new StepError(`Step failed (exit ${code}): ${summarize(tail)}`, tail));
    });
  });
}

function summarize(tail: string) {
  const lines = tail.trim().split("\n").filter(Boolean);
  return lines.slice(-3).join(" | ") || "unknown error";
}

function parseYtdlpProgress(line: string): number | null {
  const m = /\[download\]\s+([0-9.]+)%/.exec(line);
  return m ? parseFloat(m[1]) / 100 : null;
}

async function findAudioFile(dir: string): Promise<string | null> {
  const files = await fsp.readdir(dir);
  const audio = files.find(
    (f) =>
      f.startsWith("audio.") &&
      !f.endsWith(".json") &&
      !f.endsWith(".part") &&
      !f.endsWith(".ytdl")
  );
  return audio ?? null;
}

/** JP terms from the pack glossary + profile heading — biases Qwen3-ASR. */
function buildAsrContext(packDir: string): string | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(packDir, "glossary.json"), "utf8")
    ) as { terms?: Array<{ jp?: string }> };
    const terms = (raw.terms || [])
      .map((t) => String(t.jp || "").trim())
      .filter(Boolean)
      .slice(0, 40);
    if (!terms.length) return undefined;
    return `配信内の固有名詞: ${terms.join("、")}`;
  } catch {
    return undefined;
  }
}

/** Post-job Ollama mine → auto-merge / pending queue. Never throws to caller. */
async function growDomainMemory(
  jobId: string,
  subJsonPath: string,
  lang: string,
  packDir: string
): Promise<void> {
  const proposalsPath = path.join(jobDir(jobId), "glossary.proposals.json");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      config.pythonBin,
      [
        path.join(config.pipelineDir, "mine_glossary.py"),
        subJsonPath,
        "--ollama",
        config.ollamaBaseUrl,
        "--model",
        config.domainMineModel,
        "--lang",
        lang,
        "--domain-dir",
        packDir,
        "--out-proposals",
        proposalsPath,
        "--job-id",
        jobId,
      ],
      { env: process.env, shell: false }
    );
    let errTail = "";
    child.stderr.on("data", (d) => {
      errTail = (errTail + d.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mine_glossary exit ${code}: ${errTail}`));
    });
  });

  const raw = JSON.parse(await fsp.readFile(proposalsPath, "utf8")) as {
    proposals?: TermProposal[];
  };
  const stats = applyProposalsToDomainDir(packDir, raw.proposals || [], {
    lang,
    jobId,
  });
  console.log(
    `[domain] job ${jobId} (${lang}): +${stats.autoAdded} auto, ${stats.bumped} bumped, ${stats.enqueued} pending (total pending ${stats.pendingCount})`
  );
  if (stats.pendingCount > 0) {
    console.log(
      `[domain] ${stats.pendingCount} term(s) need interview — run: npm run domain:resolve`
    );
  }
}

/** Resolve an artifact filename safely inside the job dir. */
export function artifactPath(id: string, filename: string): string | null {
  const base = path.basename(filename); // traversal guard
  const p = path.join(jobDir(id), base);
  return fs.existsSync(p) ? p : null;
}
