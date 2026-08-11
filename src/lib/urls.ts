/** Job URL validation + platform detection (yt-dlp handles the download). */

export type UrlValidation = { ok: true } | { ok: false; error: string };

export function validateJobUrl(raw: string): UrlValidation {
  const url = (raw || "").trim();
  if (!url) return { ok: false, error: "Paste a video URL first." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http(s) links are supported." };
  }
  if (!parsed.hostname.includes(".")) {
    return { ok: false, error: "That doesn't look like a valid video URL." };
  }
  return { ok: true };
}

const PLATFORMS: Array<[RegExp, string]> = [
  [/(^|\.)twitcasting\.tv$/i, "TwitCasting"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, "YouTube"],
  [/(^|\.)twitch\.tv$/i, "Twitch"],
  [/(^|\.)nicovideo\.jp$/i, "niconico"],
  [/(^|\.)bilibili\.com$/i, "Bilibili"],
  [/(^|\.)tiktok\.com$/i, "TikTok"],
  [/(^|\.)vimeo\.com$/i, "Vimeo"],
  [/(^|\.)dailymotion\.com$/i, "Dailymotion"],
];

/** Human label for the video source; falls back to the hostname. */
export function detectPlatform(raw: string): string {
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "");
    for (const [re, name] of PLATFORMS) {
      if (re.test(host)) return name;
    }
    return host;
  } catch {
    return "link";
  }
}
