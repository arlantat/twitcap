export type MachineSetup = {
  asrBackend: "faster-whisper";
  whisperModel: "medium" | "large-v3-turbo";
  ollamaModel: "qwen3:8b" | "qwen3:14b";
  /** True if this profile is expected to run without swapping out. */
  fits: boolean;
};

/**
 * Pick models that fit physical RAM. ASR and Ollama run one after the other,
 * so peak is roughly the larger of Whisper + OS, or the Ollama model + OS.
 * 12 GB is OK on the 8B + faster-whisper path; 14B wants ~16 GB.
 */
export function recommendMachineSetup(ramGb: number): MachineSetup {
  const ram = Number.isFinite(ramGb) ? ramGb : 8;
  if (ram < 10) {
    return {
      asrBackend: "faster-whisper",
      whisperModel: "medium",
      ollamaModel: "qwen3:8b",
      fits: ram >= 8,
    };
  }
  if (ram < 16) {
    return {
      asrBackend: "faster-whisper",
      whisperModel: "large-v3-turbo",
      ollamaModel: "qwen3:8b",
      fits: true,
    };
  }
  return {
    asrBackend: "faster-whisper",
    whisperModel: "large-v3-turbo",
    ollamaModel: "qwen3:14b",
    fits: true,
  };
}

export function upsertEnvLocal(
  existing: string,
  values: Record<string, string>
): string {
  const lines = existing.replace(/\r\n/g, "\n").split("\n");
  const seen = new Set<string>();
  const out: string[] = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (!m) return line;
    const key = m[1];
    if (values[key] === undefined) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  let text = out.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  return text;
}
