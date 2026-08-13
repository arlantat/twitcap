#!/usr/bin/env bash
# One-shot install for TwitCap (macOS / Debian-family Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '\n==> %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"

install_macos() {
  if ! have brew; then
    log "Installing Homebrew (may ask for your password)"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  fi
  log "Installing Node, Python, ffmpeg, yt-dlp, Ollama via Homebrew"
  brew install node python ffmpeg yt-dlp ollama
}

install_linux() {
  if have apt-get; then
    log "Installing OS packages (sudo)"
    sudo apt-get update -y
    sudo apt-get install -y python3 python3-venv python3-pip ffmpeg curl ca-certificates
  else
    echo "Install python3, pip, ffmpeg, Node.js 18+, and yt-dlp, then re-run." >&2
  fi
  if ! have node; then
    log "Installing Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  if ! have yt-dlp; then
    log "Installing yt-dlp"
    python3 -m pip install --user -U yt-dlp || true
  fi
  if ! have ollama; then
    log "Installing Ollama"
    curl -fsSL https://ollama.com/install.sh | sh
  fi
}

if [[ "$OS" == "Darwin" ]]; then
  install_macos
elif [[ "$OS" == "Linux" ]]; then
  install_linux
else
  echo "Use macOS, Linux, or Windows via WSL." >&2
  exit 1
fi

have node || { echo "Node.js is required (https://nodejs.org)." >&2; exit 1; }
have python3 || { echo "Python 3.10+ is required." >&2; exit 1; }

log "npm install"
npm install

log "Python virtualenv + faster-whisper"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r pipeline/requirements.txt

log "Writing .env.local for this machine RAM"
npx tsx scripts/write-machine-env.ts

OLLAMA_MODEL="$(grep -E '^NORMALIZE_JP_MODEL=' .env.local | cut -d= -f2- || true)"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:8b}"

if have ollama; then
  log "Starting Ollama and pulling ${OLLAMA_MODEL}"
  if [[ "$OS" == "Darwin" ]]; then
    brew services start ollama >/dev/null 2>&1 || true
  fi
  if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    ollama serve >/dev/null 2>&1 &
    sleep 3
  fi
  ollama pull "$OLLAMA_MODEL"
else
  echo "Install Ollama from https://ollama.com then run: ollama pull ${OLLAMA_MODEL}" >&2
fi

if ! grep -qE '^OPENAI_API_KEY=.+' .env.local && ! grep -qE '^CURSOR_API_KEY=.+' .env.local; then
  if [[ -t 0 ]]; then
    printf '\nPaste an OpenAI API key (or press Enter to skip): '
    read -r KEY || true
    if [[ -n "${KEY}" ]]; then
      npx tsx scripts/write-machine-env.ts --openai-key "$KEY"
    fi
  fi
fi

log "Done"
echo
echo "  1. OpenAI translation: OPENAI_API_KEY in .env.local (asked above if missing)"
echo "  2. TwitCasting: add YTDLP_EXTRA_ARGS=--cookies-from-browser \"chrome:Profile 1\""
echo "  3. npm run dev:lan"
echo
