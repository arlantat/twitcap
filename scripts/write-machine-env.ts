#!/usr/bin/env npx tsx
/**
 * Merge RAM-based pipeline defaults into .env.local (does not overwrite secrets).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { recommendMachineSetup, upsertEnvLocal } from "../src/lib/machineSetup";

function ramGb(): number {
  return os.totalmem() / 1024 ** 3;
}

function pythonBin(): string {
  const venv = path.join(process.cwd(), ".venv", "bin", "python");
  if (fs.existsSync(venv)) return ".venv/bin/python";
  const win = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
  if (fs.existsSync(win)) return ".venv/Scripts/python.exe";
  return "python3";
}

const gb = ramGb();
const rec = recommendMachineSetup(gb);
const envPath = path.join(process.cwd(), ".env.local");
const example = path.join(process.cwd(), ".env.example");
let current = "";
if (fs.existsSync(envPath)) current = fs.readFileSync(envPath, "utf8");
else if (fs.existsSync(example)) current = fs.readFileSync(example, "utf8");

const extra: Record<string, string> = {};
const keyIdx = process.argv.indexOf("--openai-key");
if (keyIdx >= 0 && process.argv[keyIdx + 1]) {
  extra.OPENAI_API_KEY = process.argv[keyIdx + 1];
}

const next = upsertEnvLocal(current, {
  ASR_BACKEND: rec.asrBackend,
  WHISPER_MODEL: rec.whisperModel,
  WHISPER_COMPUTE_TYPE: "int8",
  TRANSLATE_MODEL: rec.ollamaModel,
  NORMALIZE_JP_MODEL: rec.ollamaModel,
  DOMAIN_MINE_MODEL: rec.ollamaModel,
  PYTHON_BIN: pythonBin(),
  ...extra,
});
fs.writeFileSync(envPath, next, "utf8");

console.log(
  JSON.stringify(
    {
      ramGb: Math.round(gb * 10) / 10,
      ...rec,
      env: ".env.local",
      pythonBin: pythonBin(),
    },
    null,
    2
  )
);
