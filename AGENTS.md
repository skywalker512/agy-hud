# AGY-HUD — AI Agent Installation & Verification Guide

Use these instructions when a user asks you to install, verify, update, or remove **AGY-HUD** (the native telemetry side-pane plugin for Google Antigravity 2.0).

## Safety & Architecture Guarantees

- **Pure official Antigravity Sidecar**: Installs strictly into `~/.gemini/config/plugins/agy-hud` (or a custom `--target` path).
- **Do NOT** patch `app.asar`, inject JavaScript into Electron, launch Antigravity with `--remote-debugging-port` (CDP), or install global npm packages.
- **Zero runtime dependencies**: Runs natively on Node.js `22.18+` (`node:sqlite`, read-only `?mode=ro`).

---

## Step 1: Check Prerequisites

Verify Node.js `>= 22.18.0` and built-in `node:sqlite`:

```bash
node -v
node -e "import('node:sqlite').then(() => console.log('node:sqlite OK'))"
```

If `node` is missing or older than `22.18.0`, install Node.js 22 LTS (or 24+) before continuing:

- **macOS (Homebrew)**: `brew install node@22 && brew link --overwrite node@22`
- **macOS / Linux (`fnm` / `nvm`)**: `fnm install 22 && fnm use 22` or `nvm install 22 && nvm use 22`
- **Windows (`winget` / `scoop`)**: `winget install OpenJS.NodeJS.LTS` or `scoop install nodejs-lts`

---

## Step 2: Install AGY-HUD

### Option A — Remote One-Line Install (Recommended when not inside this repo)

The official installers validate Node.js `>= 22.18`, verify GitHub URLs and archive safety, perform an atomic install into `~/.gemini/config/plugins/agy-hud`, and automatically run `--doctor`.

- **macOS / Linux**:
  ```sh
  curl -fsSL https://h.512.pub | sh
  ```
- **Windows (PowerShell 5.1+ / PowerShell 7+)**:
  ```powershell
  irm https://h.512.pub | iex
  ```

*(Direct GitHub raw fallbacks: `https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh` and `install.ps1`.)*

Optional environment variables supported by both scripts:
- `AGY_HUD_VERSION` — pin a release tag (e.g. `v1.2.0`)
- `AGY_HUD_REF` — install from a git branch/ref (e.g. `main`)
- `AGY_HUD_TARGET` — custom plugin install directory
- `AGY_HUD_REPO` — override GitHub `owner/repo`

### Option B — Local Repository Install (When already inside a clone of `agy-hud`)

```bash
# Official Antigravity CLI validation & install
agy plugin validate --strict ./plugin
agy plugin install ./plugin

# Or atomic copy-install via built-in installer (recommended for regular users)
node plugin/install.mjs

# Or symlink/junction for local plugin development & live reload
node plugin/install.mjs --link

# Optional: enable the AGY-HUD terminal /statusline for Antigravity CLI (`agy`)
node plugin/install.mjs --statusline
```

---

## Step 3: Verify Installation

- **If running from a local repo clone**:
  ```bash
  node plugin/install.mjs --doctor
  ```
  Confirm `node`, `plugin_install`, and `ui_bundle` all report `[PASS]`. (`antigravity_data` or `agy_cli` may report `[WARN]` if Antigravity has not been opened yet or only the Desktop App is installed.)

- **If installed via the remote one-liner** (the script already runs `--doctor`; you can also double-check installed files directly):
  - **macOS / Linux**:
    ```bash
    ls -la ~/.gemini/config/plugins/agy-hud/plugin.json \
           ~/.gemini/config/plugins/agy-hud/sidecars/hud_panel/server.ts \
           ~/.gemini/config/plugins/agy-hud/sidecars/hud_panel/ui/index.html \
           ~/.gemini/config/plugins/agy-hud/sidecars/hud_panel/ui/app.js \
           ~/.gemini/config/plugins/agy-hud/sidecars/hud_panel/ui/styles.css
    ```
  - **Windows (PowerShell)**:
    ```powershell
    Test-Path "$HOME\.gemini\config\plugins\agy-hud\plugin.json",
              "$HOME\.gemini\config\plugins\agy-hud\sidecars\hud_panel\server.ts",
              "$HOME\.gemini\config\plugins\agy-hud\sidecars\hud_panel\ui\index.html"
    ```

---

## Step 4: Tell the User How to Open It

Once verification passes, report the installed version and path, and let the user know:

1. Restart **Google Antigravity** (or reload plugins in the Plugins Manager) if the **AGY-HUD** icon does not appear in the side pane right away.
2. Open the **AGY-HUD** side pane — it automatically syncs Antigravity's light/dark/high-contrast theme and detects EN / 中文.

---

## Updating & Uninstalling

- **Update** (in-app): Open **Account → Plugin & Updates → Update Now**.
- **Update** (CLI from repo): `node plugin/install.mjs --update` (or re-run the remote one-liner).
- **Uninstall** (from repo): `node plugin/install.mjs --uninstall`
- **Uninstall** (without repo): remove `~/.gemini/config/plugins/agy-hud` (or `%USERPROFILE%\.gemini\config\plugins\agy-hud` on Windows).
