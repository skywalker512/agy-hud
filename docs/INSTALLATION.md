# Installation, Diagnostics & Self-Upgrade Guide

> **English** · [简体中文](INSTALLATION.zh-CN.md) · [Back to README](../README.md) · [User & Technical Guide](GUIDE.md) · [AGENTS.md](../AGENTS.md)

This guide covers installing, verifying, updating, and troubleshooting **AGY-HUD** on **macOS**, **Linux**, and **Windows**.

> **Pure official Antigravity Sidecar · Zero CDP · Zero `app.asar` patching · 100% local read-only · Zero runtime dependencies**

---

## Prerequisites

| Requirement | Version / Notes |
| :--- | :--- |
| **Node.js** | **22.18+** (`>=22.18.0`, required for built-in `node:sqlite` and native TypeScript stripping) |
| **Google Antigravity** | **Antigravity 2.0** (Desktop App, CLI `agy`, ACP, or IDE) |
| **macOS / Linux Shell Tools** | `curl` or `wget`, plus `tar` (for one-line install only) |
| **Windows Shell** | PowerShell 5.1+ (built-in) or PowerShell 7+ (`pwsh`) |

Verify your Node.js version:

```bash
node -v
# Expected: v22.18.0 or higher (e.g. v22.21.x, v24.x)
```

---

## 1. One-Line Cross-Platform Install

Both one-line installers automatically check Node.js `>= 22.18`, validate GitHub release URLs against a strict allowlist, verify archive paths against zip-slip traversal, run the atomic installer, and finish with `--doctor` verification.

### macOS & Linux

```sh
curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex
```

### AI Agent Install (1 Sentence)

You can also let Antigravity, Claude Code, Codex, or any coding agent run and verify the installation for you using [`AGENTS.md`](../AGENTS.md):

> `Install agy-hud from https://github.com/skywalker512/agy-hud following AGENTS.md and verify the installation.`

### Environment Variables (Optional)

Both `scripts/install.sh` and `scripts/install.ps1` honor the same four optional environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `AGY_HUD_VERSION` | Pin a specific release tag (e.g. `1.2.0` or `v1.2.0`) | Latest GitHub release (falls back to `main`) |
| `AGY_HUD_REF` | Install from a specific git branch or ref (e.g. `main`) | *(unset)* |
| `AGY_HUD_TARGET` | Custom plugin installation directory | `~/.gemini/config/plugins/agy-hud` |
| `AGY_HUD_REPO` | Override GitHub `owner/repo` fork | `skywalker512/agy-hud` |

**Examples:**

```sh
# macOS / Linux — pin a release tag and custom target
AGY_HUD_VERSION=v1.2.0 AGY_HUD_TARGET=/custom/path/agy-hud \
  curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh
```

```powershell
# Windows PowerShell — pin a release tag
$env:AGY_HUD_VERSION = "v1.2.0"
irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex
```

---

## 2. Source Install, Dev Link & CLI Reference

If you cloned the repository locally, `plugin/install.mjs` is a zero-dependency Node.js CLI handling installation, dev linking, updates, diagnostics, and uninstallation:

```bash
git clone https://github.com/skywalker512/agy-hud.git
cd agy-hud
```

### Commands

| Command | Description |
| :--- | :--- |
| `node plugin/install.mjs` *(or `--install`)* | Atomic staged copy into `~/.gemini/config/plugins/agy-hud` (auto-builds `web/` if pre-built UI assets are absent). |
| `node plugin/install.mjs --link` | Links `plugin/` directly into Antigravity's plugin folder for live development hot-reload (`dir` symlink on macOS/Linux, directory `junction` on Windows — no Administrator privileges required). |
| `node plugin/install.mjs --doctor` | Runs 6 environment & installation health checks (see Section 3). |
| `node plugin/install.mjs --check-update` | Checks GitHub (`skywalker512/agy-hud`) for newer SemVer releases without modifying disk. |
| `node plugin/install.mjs --update` | Downloads, verifies, safely extracts, and atomically upgrades the installed plugin with automatic rollback on failure. |
| `node plugin/install.mjs --uninstall` | Cleanly removes the installed plugin directory or dev symlink/junction. |

### Options

| Flag | Applies To | Description |
| :--- | :--- | :--- |
| `--target <dir>` | All commands | Override default target directory (`~/.gemini/config/plugins/agy-hud`). Useful for testing or enterprise setups. |
| `--source <dir>` | `--install`, `--link`, `--version` | Override source plugin directory. |
| `--force` | `--update` | Allow replacing a `--link` dev symlink with a release copy, or force reinstalling the same version. |
| `--ref <tag>` / `--tag <tag>` | `--update` | Install a specific GitHub release tag (e.g. `--ref v1.3.0`). |
| `--no-build` | `--install` | Fail instead of running `npm --prefix web run build` if pre-built UI files are missing. |
| `--json` | `--doctor`, `--check-update`, `--update` | Emit structured machine-readable JSON to stdout. |
| `-v`, `--version` | Standalone | Print the local `plugin/plugin.json` version. |
| `-h`, `--help` | Standalone | Print full CLI usage. |

> **After Installing**: Restart Antigravity (or reload plugins) if the AGY-HUD icon does not appear in the side pane immediately.

---

## 3. Environment Diagnostics (`--doctor`)

Run `node plugin/install.mjs --doctor` (or `--doctor --json` for scripts/CI) to verify your setup:

```bash
node plugin/install.mjs --doctor
```

`--doctor` executes 6 structured checks:

1. **`platform`** — Reports OS, CPU architecture, and kernel release.
2. **`node`** — Confirms Node.js `>= 22.18` **and** attempts `import('node:sqlite')` to verify `DatabaseSync` is functional.
3. **`antigravity_data`** — Probes `ANTIGRAVITY_APP_DATA_DIR` and `~/.gemini/{antigravity,antigravity-cli,antigravity-acp,antigravity-ide}` for existing `conversations/` stores (`WARN` if Antigravity has never been launched yet).
4. **`agy_cli`** — Checks whether `agy` is available on `PATH` and prints its version (`WARN` only; optional for Desktop App users).
5. **`plugin_install`** — Verifies installation path, `plugin.json` manifest validity, symlink/junction target (if `--link`), and sidecar backend files (`server.ts`, `sidecar.json`).
6. **`ui_bundle`** — Confirms pre-built UI assets (`index.html`, `app.js`, `styles.css`) exist and are non-empty, reporting exact bundle sizes.

---

## 4. In-App Self-Upgrade & Security Model

AGY-HUD includes a built-in, zero-dependency self-upgrade engine (`plugin/sidecars/hud_panel/lib/updater.ts`) exposed via `GET /api/update-status` and `POST /api/update-apply`.

### How In-App Updates Work

- **Non-Intrusive Checks**: On mount, the UI checks `GET /api/update-status` (backed by a **6-hour** memory + disk cache in `update-cache.json`). It queries GitHub Releases first, falling back to SemVer tags and `main/plugin/plugin.json` if no published release exists yet.
- **Zero Clutter When Up to Date**: A compact `↑ vX.Y.Z` pill appears in the top bar **only** when a newer release exists and the plugin is not in `--link` dev mode.
- **1-Click Upgrade (`Account → Plugin & Updates`)**:
  - Displays current version, install mode (`Installed` vs `Dev Symlink`), last-checked timestamp, `[Check]` button, release notes link, and `[Update Now]`.
  - **Smart Reload Detection**: The updater computes a SHA-256 hash of backend files before and after swapping:
    - *UI-only update*: `uiReloadOnly: true` — Antigravity hot-reloads assets seamlessly.
    - *Backend update*: `restartRequired: true` — coordinates with `server.ts`'s `startSelfWatch()` and triggers a graceful sidecar restart (`750 ms` delay) so Antigravity respawns the updated sidecar automatically, showing a `[Reload Now]` prompt.
  - **Dev Symlink Protection**: If installed via `--link` (or running inside a git checkout), in-app self-update is safely disabled (`reason: "dev_symlink"`) so your local work is never overwritten. Use `git pull` instead (or `node plugin/install.mjs --update --force` from CLI to convert to a release copy).

### Hardened Security Model

Every update — whether triggered from the UI or `node plugin/install.mjs --update` — enforces strict defenses:

| Defense Layer | Guarantee |
| :--- | :--- |
| **Strict HTTPS GitHub Allowlist** | Only `https://` URLs on port 443 without credentials or path traversal are permitted, scoped strictly to `github.com/skywalker512/agy-hud/`, `codeload.github.com/skywalker512/agy-hud/`, and `api.github.com/repos/skywalker512/agy-hud/` (plus `raw.githubusercontent.com/skywalker512/agy-hud/` for manifest fallback). |
| **Manual Redirect Verification** | `redirect: 'manual'` enforces at most **5 redirect hops**, restricting redirect targets to verified GitHub CDN hosts (`objects.githubusercontent.com`, `release-assets.githubusercontent.com`, `github-releases.githubusercontent.com`). |
| **Pure-Node Safe Archive Extraction** | Custom `.tar.gz` and `.zip` extractors reject **zip-slip** (`..`), absolute paths, Windows drive prefixes, null bytes, symlinks, hardlinks, and device/special files. |
| **Resource Caps** | Hard limits of **50 MB** compressed archive, **64 MB** extracted size, **2,000** max files, **10 s** metadata timeout, and **45 s** download timeout. |
| **Payload Verification** | Validates `plugin.json` (name + SemVer), `sidecar.json`, `server.ts`, and non-empty `ui/{index.html,app.js,styles.css}` before touching the live installation. |
| **Atomic Swap & Auto-Rollback** | Stages files in a sibling temp directory, backs up the existing plugin, performs atomic `renameSync` (with `EXDEV` cross-device fallback and Windows `EPERM`/`EBUSY`/`EACCES` retry backoff), and automatically restores the backup if anything fails. |
| **Concurrency Lock** | An in-flight mutex prevents overlapping update requests (`reason: "in_progress"`). |

---

## 5. Troubleshooting

### Node.js version is older than 22.18

Upgrade Node.js to **22.18+** (Node 22 LTS or Node 24+):

- **macOS (Homebrew)**: `brew install node@22 && brew link --overwrite node@22`
- **macOS / Linux (`fnm` / `nvm`)**: `fnm install 22 && fnm use 22` or `nvm install 22 && nvm use 22`
- **Windows (`winget` / `scoop`)**: `winget install OpenJS.NodeJS.LTS` or `scoop install nodejs-lts`

Then re-verify with `node -v` and `node plugin/install.mjs --doctor`.

### Plugin icon does not appear in Antigravity

1. Run `node plugin/install.mjs --doctor` and verify both `plugin_install` and `ui_bundle` show `[PASS]`.
2. Ensure the plugin was installed into `~/.gemini/config/plugins/agy-hud` (or your configured Antigravity plugins path).
3. Fully quit and restart Antigravity (or reload plugins from the Plugins Manager).

### "No conversation database found" in the HUD

- Launch at least one conversation in Antigravity so `~/.gemini/antigravity/conversations/<uuid>.db` is created.
- If you store Antigravity data in a non-standard directory, set `ANTIGRAVITY_APP_DATA_DIR=/path/to/data` before launching Antigravity.

### In-app update fails due to GitHub rate limit or offline environment

- Unauthenticated GitHub API requests share a 60 req/hr limit per IP. Wait briefly and click `[Check]` again, or run the CLI fallback shown directly inside the Update card:
  ```bash
  node plugin/install.mjs --update
  ```
- Behind a corporate proxy or air-gapped network, clone or download the release tarball manually and run `node plugin/install.mjs --install`.

### Windows file-lock (`EPERM` / `EBUSY`) during update

- AGY-HUD automatically retries locked file operations with backoff. If Antigravity holds an open handle on Windows during an update, close the AGY-HUD side pane (or quit Antigravity), run `node plugin/install.mjs --update`, and reopen Antigravity.
