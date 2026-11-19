# Changelog

## Unreleased

- **Plugin-only**: Removed the Python desktop pill, `--cli` / `--watch` modes, and `pyproject.toml`. AGY-HUD now ships only as the Antigravity app side-pane plugin.
- **Node installer**: `plugin/install_plugin.py` is replaced by `node plugin/install.mjs` (same `--link` / `--uninstall` flags), so installing needs only Node.js 22.5+.
- **Docs**: READMEs are now maintained in English and Simplified Chinese only.

## v1.1.0 — Live Streaming, Target Stability & Phase Diagnostics

- **Per-Call Phase & Tool-Stall Diagnostics**: Separates post-TTFT thinking time (`THK`) from tool-call argument streaming time (`TOOL GEN` / `TC-WAIT`) on tool-invoking turns, and clamps `TOOL TIME` start timestamps to planner completion so multi-tool streaming no longer inflates tool execution totals.
- **Unfrozen Live Streaming & Auto-Scroll**: Raised `THINKING` / `REPLY` detail caps from `1,200` to `60,000` chars with a `24,000`-char sliding tail window during live streaming, fixed live ETag signatures to track raw unclipped char lengths, warmed Language Server model aliases (`-high` / `-low`) on startup, and added sticky bottom auto-scroll during live generation.
- **Deterministic Conversation Targeting**: Eliminated `Calls` count oscillation (`3 ↔ 6`) during early turns by removing stale startup `app.config.conversationId` fallbacks, preserving zero-byte WAL checkpoint timestamps, ranking idle conversations by true protobuf step / LS activity timestamps (preferring `main` over `subagent` sessions), and serializing frontend `poll()` requests with `AbortController` + sequence guards.
- **Accurate Sustained `AVG GEN` & Hardened Runtime**: Excluded single-packet `BUF` responses from `avgGenTps` / `avg_gen_tps` in both Node and Python telemetry stores so weighted averages never exceed `PEAK TPS`, restricted LS TLS/HTTP fallbacks strictly to loopback hosts, extracted pricing rules into `pricing.json` with background DB indexing, made `desktop.cli --cli` / `--watch` independent of `tkinter` (`--data-dir` + `ANTIGRAVITY_APP_DATA_DIR`), added macOS right-click bindings (`<Button-2>`, `<Control-Button-1>`), and added zero-dependency Node + Python unit test suites.

## v1.0.0 — Initial Public Release

- Pure-stdlib Python desktop floating HUD pill (`desktop/`) with CLI and `--watch` modes.
- Native Antigravity 2.0 auxiliary side-pane UI plugin (`plugin/`) powered by `node:sqlite`.
- Read-only SQLite + WAL mtime polling (`?mode=ro`) and wire-type protobuf decoder.
- Separate `GEN TPS` vs `E2E TPS` (including TTFT) tracking with millisecond single-packet `BUF` spike detection.
- Raw model identifier priority (`f1.f19`, e.g. `GEMINI-3.8-FLASH-K`) and real protobuf context budget (`f1.f9.f10.f4`).
- Default crisp English abbreviation HUD with live `EN / 中文` switcher in both UIs.
