import { execFile } from "child_process";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { name: string; ok: boolean; detail: string; fix?: string };

function run(cmd: string, args: string[], timeoutMs = 6000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve((stdout || stderr).trim());
    });
  });
}

export async function GET() {
  const checks: Check[] = [];

  // yt-dlp
  try {
    const v = await run(config.ytdlpBin, ["--version"]);
    checks.push({ name: "yt-dlp", ok: true, detail: `v${v.split("\n")[0]}` });
  } catch {
    checks.push({
      name: "yt-dlp",
      ok: false,
      detail: "not found on PATH",
      fix: "pipx install yt-dlp   # or: brew install yt-dlp",
    });
  }

  // python
  let pythonOk = false;
  try {
    const v = await run(config.pythonBin, ["--version"]);
    pythonOk = true;
    checks.push({ name: "Python", ok: true, detail: v });
  } catch {
    checks.push({
      name: "Python",
      ok: false,
      detail: "python3 not found",
      fix: "Install Python 3.10+ (https://www.python.org)",
    });
  }

  // ASR backends (faster-whisper always checked; qwen3 when selected)
  if (pythonOk) {
    try {
      await run(config.pythonBin, ["-c", "import faster_whisper"], 10000);
      checks.push({
        name: "faster-whisper",
        ok: true,
        detail: `model: ${config.whisperModel}${
          config.asrBackend === "faster-whisper" ? " (active)" : ""
        }`,
      });
    } catch {
      checks.push({
        name: "faster-whisper",
        ok: config.asrBackend !== "faster-whisper",
        detail: "not installed",
        fix: "python3 -m pip install -r pipeline/requirements.txt",
      });
    }

    if (config.asrBackend === "qwen3") {
      try {
        await run(
          config.pythonBin,
          ["-c", "import torch; import qwen_asr"],
          15000
        );
        checks.push({
          name: "qwen3-asr",
          ok: true,
          detail: `active: ${config.qwenModel}`,
        });
      } catch {
        checks.push({
          name: "qwen3-asr",
          ok: false,
          detail: "torch/qwen-asr not installed",
          fix: "python3 -m pip install -r pipeline/requirements-qwen3.txt",
        });
      }
    } else {
      checks.push({
        name: "ASR backend",
        ok: true,
        detail: "faster-whisper (set ASR_BACKEND=qwen3 to compare)",
      });
    }
  }

  // Translation backend
  if (config.translateBackend === "cursor") {
    checks.push(
      config.cursorApiKey
        ? {
            name: "Cursor SDK MT",
            ok: true,
            detail: `${config.cursorTranslateModel} (non-fast; Pro+ API key)`,
          }
        : {
            name: "Cursor SDK MT",
            ok: false,
            detail: "CURSOR_API_KEY missing",
            fix: "Add a Pro+ CURSOR_API_KEY to .env.local from https://cursor.com/dashboard/integrations (Hobby/free keys return plan_required), or set OPENAI_API_KEY to use gpt-5-nano",
          }
    );
  } else if (config.translateBackend === "openai") {
    checks.push(
      config.openaiApiKey
        ? {
            name: "OpenAI MT",
            ok: true,
            detail: `${config.openaiTranslateModel} (cheapest chat model)`,
          }
        : {
            name: "OpenAI MT",
            ok: false,
            detail: "OPENAI_API_KEY missing",
            fix: "Add OPENAI_API_KEY to .env.local from https://platform.openai.com/api-keys, or set CURSOR_API_KEY to use Composer 2.5",
          }
    );
  } else {
    try {
      const res = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { models?: { name: string }[] };
      const names = (data.models || []).map((m) => m.name);
      const found = names.some((n) =>
        n.startsWith(config.translateModel.split(":")[0])
      );
      checks.push(
        found
          ? { name: "Ollama MT model", ok: true, detail: config.translateModel }
          : {
              name: "Ollama MT model",
              ok: false,
              detail: `${config.translateModel} not pulled`,
              fix: `ollama pull ${config.translateModel}`,
            }
      );
    } catch {
      checks.push({
        name: "Ollama MT model",
        ok: false,
        detail: `cannot reach ${config.ollamaBaseUrl}`,
        fix: "Install Ollama (https://ollama.com) and run: ollama serve",
      });
    }
  }

  // Ollama still used for JP normalize when enabled
  if (config.polishJpEnabled) {
    try {
      const res = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { models?: { name: string }[] };
      const names = (data.models || []).map((m) => m.name);
      const model = config.normalizeJpModel;
      const found = names.some((n) => n.startsWith(model.split(":")[0]));
      checks.push(
        found
          ? { name: "Ollama JP normalize", ok: true, detail: model }
          : {
              name: "Ollama JP normalize",
              ok: false,
              detail: `${model} not pulled`,
              fix: `ollama pull ${model}`,
            }
      );
    } catch {
      checks.push({
        name: "Ollama JP normalize",
        ok: false,
        detail: `cannot reach ${config.ollamaBaseUrl}`,
        fix: "ollama serve + ollama pull qwen3:14b",
      });
    }
  }

  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
