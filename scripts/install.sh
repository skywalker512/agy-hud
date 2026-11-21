#!/bin/sh
# AGY-HUD one-line installer for macOS and Linux (POSIX sh compatible).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh
#
# Optional environment variables:
#   AGY_HUD_VERSION   Install a specific release tag (e.g. "1.2.0" or "v1.2.0")
#   AGY_HUD_REF       Install from a specific git branch/ref (e.g. "main")
#   AGY_HUD_TARGET    Custom plugin install directory (default: ~/.gemini/config/plugins/agy-hud)
#   AGY_HUD_REPO      Override GitHub owner/repo (default: skywalker512/agy-hud)

set -eu

REPO="${AGY_HUD_REPO:-skywalker512/agy-hud}"
VERSION="${AGY_HUD_VERSION:-}"
REF="${AGY_HUD_REF:-}"
TARGET="${AGY_HUD_TARGET:-}"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=18

log_info() {
  printf '[agy-hud] %s\n' "$1"
}

log_warn() {
  printf '[agy-hud] WARNING: %s\n' "$1" >&2
}

log_err() {
  printf '[agy-hud] ERROR: %s\n' "$1" >&2
}

detect_platform() {
  OS_RAW="$(uname -s 2>/dev/null || echo unknown)"
  ARCH_RAW="$(uname -m 2>/dev/null || echo unknown)"

  case "$OS_RAW" in
    Darwin) OS_NAME="macos" ;;
    Linux)  OS_NAME="linux" ;;
    *)
      OS_NAME="other"
      log_warn "Unrecognized OS '$OS_RAW'; attempting generic Unix install."
      ;;
  esac

  case "$ARCH_RAW" in
    x86_64|amd64)  ARCH_NAME="x64" ;;
    arm64|aarch64) ARCH_NAME="arm64" ;;
    *)             ARCH_NAME="$ARCH_RAW" ;;
  esac

  log_info "Detected platform: ${OS_NAME} (${ARCH_NAME})"
}

print_node_install_help() {
  printf '\n' >&2
  printf 'AGY-HUD requires Node.js >= %s.%s (for built-in node:sqlite).\n' "$MIN_NODE_MAJOR" "$MIN_NODE_MINOR" >&2
  printf 'Install or upgrade Node.js using one of the following:\n' >&2
  if [ "$OS_NAME" = "macos" ]; then
    printf '  • Homebrew:  brew install node@22 && brew link --overwrite node@22\n' >&2
    printf '  • fnm:       brew install fnm && fnm install 22 && fnm use 22\n' >&2
    printf '  • nvm:       nvm install 22 && nvm use 22\n' >&2
  else
    printf '  • nvm:       curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22\n' >&2
    printf '  • fnm:       curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22\n' >&2
    printf '  • Download:  https://nodejs.org/en/download\n' >&2
  fi
  printf '\nThen re-run this installer.\n' >&2
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    log_err "Node.js is not installed or not on PATH."
    print_node_install_help
    exit 1
  fi

  NODE_VER_RAW="$(node -v 2>/dev/null || true)"
  NODE_VER="${NODE_VER_RAW#v}"
  NODE_MAJOR="$(printf '%s' "$NODE_VER" | cut -d. -f1)"
  NODE_MINOR="$(printf '%s' "$NODE_VER" | cut -d. -f2)"

  case "$NODE_MAJOR" in
    ''|*[!0-9]*) NODE_MAJOR=0 ;;
  esac
  case "$NODE_MINOR" in
    ''|*[!0-9]*) NODE_MINOR=0 ;;
  esac

  if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$MIN_NODE_MAJOR" ] && [ "$NODE_MINOR" -lt "$MIN_NODE_MINOR" ]; }; then
    log_err "Found Node.js ${NODE_VER_RAW:-unknown}, which is older than required >= v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}."
    print_node_install_help
    exit 1
  fi

  log_info "Using Node.js ${NODE_VER_RAW} ($(command -v node))"
}

check_tools() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
  else
    log_err "Neither 'curl' nor 'wget' is available. Please install one and re-run."
    exit 1
  fi

  if ! command -v tar >/dev/null 2>&1; then
    log_err "'tar' is required to extract the release archive."
    exit 1
  fi
}

fetch_to_stdout() {
  URL="$1"
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL -H "User-Agent: agy-hud-installer" "$URL"
  else
    wget -qO- --header="User-Agent: agy-hud-installer" "$URL"
  fi
}

download_file() {
  URL="$1"
  OUT="$2"
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL -H "User-Agent: agy-hud-installer" -o "$OUT" "$URL"
  else
    wget -qO "$OUT" --header="User-Agent: agy-hud-installer" "$URL"
  fi
}

validate_github_url() {
  URL="$1"
  node -e '
    const [u, repo] = process.argv.slice(1);
    try {
      const p = new URL(u);
      const r = repo.toLowerCase();
      const h = p.hostname.toLowerCase();
      const decoded = decodeURIComponent(p.pathname);
      if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").some((s) => s === "..")) {
        process.exit(1);
      }
      const path = p.pathname.toLowerCase();
      const portOk = !p.port || p.port === "443";
      const ok = p.protocol === "https:" && portOk && !p.username && !p.password && (
        ((h === "github.com" || h === "codeload.github.com") && path.startsWith("/" + r + "/")) ||
        (h === "api.github.com" && path.startsWith("/repos/" + r + "/"))
      );
      process.exit(ok ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$URL" "$REPO"
}

resolve_archive_url() {
  if [ -n "$VERSION" ]; then
    case "$VERSION" in
      v*|V*) TAG="$VERSION" ;;
      *)     TAG="v${VERSION}" ;;
    esac
    ARCHIVE_URL="https://github.com/${REPO}/archive/refs/tags/${TAG}.tar.gz"
    log_info "Selected version tag: ${TAG}"
    return
  fi

  if [ -n "$REF" ]; then
    ARCHIVE_URL="https://github.com/${REPO}/archive/${REF}.tar.gz"
    log_info "Selected git ref: ${REF}"
    return
  fi

  log_info "Checking latest GitHub release for ${REPO}..."
  RELEASE_JSON=""
  if RELEASE_JSON="$(fetch_to_stdout "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null)"; then
    PARSED_URL="$(printf '%s' "$RELEASE_JSON" | node -e '
      const fs = require("node:fs");
      const repo = (process.argv[1] || "").toLowerCase();
      try {
        const rel = JSON.parse(fs.readFileSync(0, "utf8"));
        const assets = Array.isArray(rel.assets) ? rel.assets : [];
        const isAllowed = (u) => {
          if (typeof u !== "string") return false;
          try {
            const p = new URL(u);
            const h = p.hostname.toLowerCase();
            const path = p.pathname.toLowerCase();
            return p.protocol === "https:" && (
              ((h === "github.com" || h === "codeload.github.com") && path.startsWith("/" + repo + "/")) ||
              (h === "api.github.com" && path.startsWith("/repos/" + repo + "/"))
            );
          } catch { return false; }
        };
        const tarAsset = assets.find((a) => typeof a?.name === "string" && /\.(tar\.gz|tgz)$/i.test(a.name) && isAllowed(a.browser_download_url));
        if (tarAsset) { console.log(tarAsset.browser_download_url); process.exit(0); }
        if (isAllowed(rel.tarball_url)) { console.log(rel.tarball_url); process.exit(0); }
        if (typeof rel.tag_name === "string" && rel.tag_name) {
          console.log(`https://github.com/${process.argv[1]}/archive/refs/tags/${encodeURIComponent(rel.tag_name)}.tar.gz`);
          process.exit(0);
        }
      } catch {}
    ' "$REPO" 2>/dev/null || true)"
    if [ -n "$PARSED_URL" ]; then
      ARCHIVE_URL="$PARSED_URL"
      return
    fi
  fi

  log_info "No published release found (or GitHub API unavailable); falling back to main branch archive."
  ARCHIVE_URL="https://github.com/${REPO}/archive/refs/heads/main.tar.gz"
}

main() {
  detect_platform
  check_node
  check_tools
  resolve_archive_url

  if ! validate_github_url "$ARCHIVE_URL"; then
    log_err "Refused to download from untrusted URL: ${ARCHIVE_URL}"
    exit 1
  fi

  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agy-hud-install.XXXXXX")"
  trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

  ARCHIVE_PATH="${TMP_DIR}/agy-hud.tar.gz"
  EXTRACT_DIR="${TMP_DIR}/extract"
  mkdir -p "$EXTRACT_DIR"

  log_info "Downloading ${ARCHIVE_URL}..."
  download_file "$ARCHIVE_URL" "$ARCHIVE_PATH"

  log_info "Verifying & extracting archive..."
  if ! tar -tzf "$ARCHIVE_PATH" | node -e '
    const fs = require("node:fs");
    const lines = fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
    for (const raw of lines) {
      const norm = raw.replace(/\\/g, "/");
      if (norm.startsWith("/") || /^[A-Za-z]:/.test(norm) || norm.split("/").some((s) => s === "..")) {
        process.stderr.write("Refused unsafe archive entry: " + raw + "\n");
        process.exit(1);
      }
    }
  '; then
    log_err "Archive failed path safety validation."
    exit 1
  fi
  tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

  INSTALLER_PATH=""
  if [ -f "${EXTRACT_DIR}/plugin/install.mjs" ]; then
    INSTALLER_PATH="${EXTRACT_DIR}/plugin/install.mjs"
    SRC_ROOT="$EXTRACT_DIR"
  elif [ -f "${EXTRACT_DIR}/install.mjs" ]; then
    INSTALLER_PATH="${EXTRACT_DIR}/install.mjs"
    SRC_ROOT="$EXTRACT_DIR"
  else
    for d in "$EXTRACT_DIR"/*; do
      if [ -d "$d" ] && [ -f "${d}/plugin/install.mjs" ]; then
        INSTALLER_PATH="${d}/plugin/install.mjs"
        SRC_ROOT="$d"
        break
      elif [ -d "$d" ] && [ -f "${d}/install.mjs" ]; then
        INSTALLER_PATH="${d}/install.mjs"
        SRC_ROOT="$d"
        break
      fi
    done
  fi

  if [ -z "$INSTALLER_PATH" ]; then
    log_err "Could not locate plugin/install.mjs inside downloaded archive."
    exit 1
  fi

  PLUGIN_DIR="$(dirname "$INSTALLER_PATH")"
  if [ ! -f "${PLUGIN_DIR}/sidecars/hud_panel/ui/index.html" ]; then
    if [ -f "${SRC_ROOT}/web/package.json" ] && command -v npm >/dev/null 2>&1; then
      log_info "Pre-built UI bundle not found in archive; building web UI..."
      npm --prefix "${SRC_ROOT}/web" install --no-audit --no-fund
      npm --prefix "${SRC_ROOT}/web" run build
    else
      log_err "Pre-built UI bundle is missing and cannot be built automatically."
      exit 1
    fi
  fi

  log_info "Running AGY-HUD plugin installer..."
  if [ -n "$TARGET" ]; then
    node "$INSTALLER_PATH" --install --target "$TARGET"
    log_info "Verifying installation..."
    node "$INSTALLER_PATH" --doctor --target "$TARGET"
  else
    node "$INSTALLER_PATH" --install
    log_info "Verifying installation..."
    node "$INSTALLER_PATH" --doctor
  fi

  printf '\n'
  log_info "AGY-HUD installation complete!"
  printf 'Next steps:\n'
  printf '  1. Restart Antigravity (or reload plugins) if it is currently running.\n'
  printf '  2. Open the AGY-HUD panel in the Antigravity side pane.\n'
  printf '  3. Future updates can be applied directly inside AGY-HUD or via:\n'
  printf '     curl -fsSL https://raw.githubusercontent.com/%s/main/scripts/install.sh | sh\n' "$REPO"
}

main "$@"
