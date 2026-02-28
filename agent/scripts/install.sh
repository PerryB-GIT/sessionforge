#!/bin/sh
# SessionForge Agent — Linux/macOS/Windows (Git Bash) one-line installer
#
# Basic install (prompts for key):
#   curl -fsSL https://sessionforge.dev/install.sh | sh
#
# Fully automated (key inline):
#   curl -fsSL https://sessionforge.dev/install.sh | bash -s -- --key sf_live_xxxxx
#
# Windows (PowerShell — recommended):
#   irm https://sessionforge.dev/install.ps1 | iex
#
# Windows (Git Bash):
#   curl -fsSL https://sessionforge.dev/install.sh | bash -s -- --key sf_live_xxxxx
set -e

REPO="PerryB-GIT/sessionforge"
BINARY="sessionforge"

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { printf "${CYAN}[sessionforge]${RESET} %s\n" "$1"; }
ok()   { printf "${GREEN}[sessionforge]${RESET} %s\n" "$1"; }
err()  { printf "${RED}[sessionforge] ERROR:${RESET} %s\n" "$1" >&2; exit 1; }

# ── Parse flags ────────────────────────────────────────────────────────────────
API_KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key)   API_KEY="$2"; shift 2 ;;
    --key=*) API_KEY="${1#--key=}"; shift ;;
    *)       shift ;;
  esac
done

# ── Detect OS ──────────────────────────────────────────────────────────────────
UNAME=$(uname -s)
case "$UNAME" in
  Linux)                        OS="linux"   ;;
  Darwin)                       OS="darwin"  ;;
  MINGW*|MSYS*|CYGWIN*|WINDOWS) OS="windows" ;;
  *)                            err "Unsupported operating system: $UNAME" ;;
esac

# ── Detect Architecture ────────────────────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)          ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *)               err "Unsupported architecture: $ARCH" ;;
esac

log "Detected platform: ${OS}/${ARCH}"

# ── Fetch latest release ───────────────────────────────────────────────────────
log "Fetching latest release info..."
if command -v curl >/dev/null 2>&1; then
  FETCH="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  FETCH="wget -qO-"
else
  err "Neither curl nor wget found. Please install one and retry."
fi

LATEST_JSON=$($FETCH "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(printf '%s' "$LATEST_JSON" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

[ -z "$VERSION" ] && err "Could not determine latest version. Check your internet connection."
log "Latest version: ${VERSION}"

# ── Windows install path ───────────────────────────────────────────────────────
if [ "$OS" = "windows" ]; then
  BINARY="sessionforge.exe"
  # Resolve %LOCALAPPDATA% or fall back to a sensible default
  if [ -n "$LOCALAPPDATA" ]; then
    # Convert Windows path to POSIX for use in shell (Git Bash handles this)
    INSTALL_DIR=$(cygpath -u "$LOCALAPPDATA/Programs/sessionforge" 2>/dev/null || echo "$LOCALAPPDATA/Programs/sessionforge")
  else
    INSTALL_DIR="$HOME/AppData/Local/Programs/sessionforge"
  fi
  mkdir -p "$INSTALL_DIR"

  ARCHIVE="sessionforge_${OS}_${ARCH}.zip"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE}"
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT

  log "Downloading ${ARCHIVE}..."
  $FETCH "$DOWNLOAD_URL" -o "${TMP_DIR}/${ARCHIVE}"

  log "Extracting..."
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "${TMP_DIR}/${ARCHIVE}" -d "$TMP_DIR"
  else
    err "unzip not found. Install Git for Windows (which includes unzip) and retry."
  fi

  mv "${TMP_DIR}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
  chmod +x "${INSTALL_DIR}/${BINARY}"

  ok "SessionForge Agent ${VERSION} installed to ${INSTALL_DIR}/${BINARY}"

  # ── Add to PATH for this session and advise on permanent PATH ───────────────
  export PATH="$PATH:$INSTALL_DIR"
  SF="${INSTALL_DIR}/${BINARY}"

  if ! command -v sessionforge >/dev/null 2>&1; then
    WINPATH=$(cygpath -w "$INSTALL_DIR" 2>/dev/null || echo "$INSTALL_DIR")
    printf "\n${CYAN}Note:${RESET} To use 'sessionforge' from any terminal, add to your PATH:\n"
    printf "  ${BOLD}%s${RESET}\n" "$WINPATH"
    printf "  (Settings → System → Advanced → Environment Variables → Path → New)\n\n"
  fi

# ── Linux / macOS install path ─────────────────────────────────────────────────
else
  INSTALL_DIR="/usr/local/bin"
  ARCHIVE="sessionforge_${OS}_${ARCH}.tar.gz"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE}"
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT

  log "Downloading ${ARCHIVE}..."
  $FETCH "$DOWNLOAD_URL" | tar xz -C "$TMP_DIR"

  if [ -w "$INSTALL_DIR" ]; then
    SUDO=""
  else
    SUDO="sudo"
    log "Need sudo to install to ${INSTALL_DIR}"
  fi

  $SUDO mv "${TMP_DIR}/${BINARY}" "${INSTALL_DIR}/${BINARY}"
  $SUDO chmod +x "${INSTALL_DIR}/${BINARY}"

  ok "SessionForge Agent ${VERSION} installed to ${INSTALL_DIR}/${BINARY}"

  if ! command -v sessionforge >/dev/null 2>&1; then
    printf "\n${RED}Warning:${RESET} ${INSTALL_DIR} is not in your PATH.\n"
    printf "Add this to your shell profile:\n"
    printf "  export PATH=\"\$PATH:${INSTALL_DIR}\"\n\n"
    SF="${INSTALL_DIR}/${BINARY}"
  else
    SF="sessionforge"
  fi
fi

# ── Authenticate if key was provided ──────────────────────────────────────────
if [ -n "$API_KEY" ]; then
  log "Authenticating with API key..."
  "$SF" auth login --key "$API_KEY" || err "Authentication failed. Check your API key and try again."
  ok "Authenticated successfully."

  # ── Install as system service ────────────────────────────────────────────────
  log "Installing as system service..."
  if [ "$OS" = "windows" ]; then
    if "$SF" service install 2>/dev/null; then
      "$SF" service start 2>/dev/null || true
      ok "Service installed and started."
    else
      log "Service install may require an elevated (Admin) terminal. Run:"
      printf "  ${BOLD}sessionforge service install${RESET}\n"
    fi
  else
    if "$SF" service install 2>/dev/null; then
      "$SF" service start 2>/dev/null || true
      ok "Service installed and started."
    else
      log "Service install requires elevated permissions. Run:"
      printf "  sudo ${SF} service install\n"
    fi
  fi

  printf "\n${GREEN}${BOLD}Setup complete!${RESET}\n"
  "$SF" status
else
  printf "\n${BOLD}Next steps:${RESET}\n"
  printf "  1. Get your API key from ${CYAN}https://sessionforge.dev/dashboard/api-keys${RESET}\n"
  printf "  2. Run: ${BOLD}sessionforge auth login --key sf_live_xxxxx${RESET}\n"
  printf "  3. Run: ${BOLD}sessionforge service install${RESET}  (start on boot)\n"
  printf "  4. Run: ${BOLD}sessionforge status${RESET}           (verify connection)\n\n"
fi
