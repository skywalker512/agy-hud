#!/usr/bin/env node
/**
 * AGY-HUD Antigravity CLI `/statusline` & Read-Only Telemetry Inspector.
 *
 * Modes:
 *   1. Default (`/statusline` mode): reads Antigravity CLI JSON state from stdin,
 *      enriches with read-only SQLite telemetry (GEN TPS, TTFT, Cache TTL, Headroom),
 *      and prints a width-adaptive ANSI statusline. Always exits 0 so the CLI never
 *      disables the statusline on transient locks.
 *   2. `--inspect [--calls N] [--conversation <uuid>] [--json]`:
 *      prints a structured read-only Markdown or JSON telemetry snapshot (used by `/agy-hud` skill).
 *   3. `--setup-statusline` / `--remove-statusline` / `--status`:
 *      atomically manages `statusLine` in `~/.gemini/antigravity-cli/settings.json` (mode 0600).
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildInspectReport,
  configureCliStatusline,
  formatInspectMarkdown,
  inspectCliStatusline,
  parseStatuslineStdin,
  readFastConversationSnapshot,
  removeCliStatusline,
  renderStatusline,
} from './lib/statusline-core.ts';

const __filename = fileURLToPath(import.meta.url);

interface ParsedArgs {
  mode: 'statusline' | 'inspect' | 'setup' | 'remove' | 'status';
  json: boolean;
  twoLine: boolean;
  noColor: boolean;
  stackWithDefault: boolean;
  force: boolean;
  width?: number;
  callsLimit?: number;
  conversationId?: string;
  appDataDir?: string;
  settingsPath?: string;
  help: boolean;
}

const HELP_TEXT = `AGY-HUD CLI Statusline & Read-Only Telemetry Inspector

Usage:
  node statusline.ts [options]                      Render /statusline (reads CLI JSON from stdin)
  node statusline.ts --inspect [--json] [--calls N] Print full read-only telemetry report
  node statusline.ts --setup-statusline             Configure ~/.gemini/antigravity-cli/settings.json
  node statusline.ts --remove-statusline            Remove AGY-HUD from CLI settings.json
  node statusline.ts --status                       Show current CLI statusLine configuration

Options:
  --two-line              Render 2-line rich terminal statusline
  --no-color              Disable ANSI colors (also respects NO_COLOR=1)
  --width <cols>          Override terminal width for layout
  --stack                 Set stack_with_default: true during --setup-statusline
  --conversation <uuid>   Target a specific conversation ID for --inspect
  --calls <n>             Number of recent calls to display in --inspect (default: 8)
  --data-dir <dir>        Override Antigravity app data directory
  --settings <path>       Override Antigravity CLI settings.json path
  --json                  Output machine-readable JSON
  --force                 Force --remove-statusline even if non-AGY-HUD command
  -h, --help              Show this help`;

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    mode: 'statusline',
    json: false,
    twoLine: process.env.AGY_HUD_STATUSLINE_LINES === '2',
    noColor: Boolean(process.env.NO_COLOR),
    stackWithDefault: false,
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
    } else if (arg === '--inspect') {
      out.mode = 'inspect';
    } else if (arg === '--setup-statusline') {
      out.mode = 'setup';
    } else if (arg === '--remove-statusline') {
      out.mode = 'remove';
    } else if (arg === '--status') {
      out.mode = 'status';
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--two-line') {
      out.twoLine = true;
    } else if (arg === '--no-color') {
      out.noColor = true;
    } else if (arg === '--stack') {
      out.stackWithDefault = true;
    } else if (arg === '--force') {
      out.force = true;
    } else if (arg === '--width') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        i++;
        const n = Number(next);
        if (Number.isFinite(n) && n > 0) out.width = Math.floor(n);
      }
    } else if (arg.startsWith('--width=')) {
      const n = Number(arg.slice('--width='.length));
      if (Number.isFinite(n) && n > 0) out.width = Math.floor(n);
    } else if (arg === '--calls') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        i++;
        const n = Number(next);
        if (Number.isFinite(n) && n > 0) out.callsLimit = Math.floor(n);
      }
    } else if (arg.startsWith('--calls=')) {
      const n = Number(arg.slice('--calls='.length));
      if (Number.isFinite(n) && n > 0) out.callsLimit = Math.floor(n);
    } else if (arg === '--conversation') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        i++;
        out.conversationId = next;
      }
    } else if (arg.startsWith('--conversation=')) {
      out.conversationId = arg.slice('--conversation='.length);
    } else if (arg === '--data-dir') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        i++;
        out.appDataDir = next;
      }
    } else if (arg.startsWith('--data-dir=')) {
      out.appDataDir = arg.slice('--data-dir='.length);
    } else if (arg === '--settings') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        i++;
        out.settingsPath = next;
      }
    } else if (arg.startsWith('--settings=')) {
      out.settingsPath = arg.slice('--settings='.length);
    }
  }

  return out;
}

function readStdinBounded(timeoutMs = 250): Promise<string> {
  return new Promise((resolvePromise) => {
    if (process.stdin.isTTY) {
      resolvePromise('');
      return;
    }
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    };

    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();

    process.stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  if (args.mode === 'status') {
    const info = inspectCliStatusline({ settingsPath: args.settingsPath });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
    } else {
      process.stdout.write(
        info.configured
          ? `statusLine: ${info.command} (${info.enabled ? 'enabled' : 'disabled'}, ${info.isAgyHud ? 'AGY-HUD' : 'custom'})\n`
          : `statusLine: not configured (${info.settingsPath})\n`,
      );
    }
    return 0;
  }

  if (args.mode === 'setup') {
    const res = configureCliStatusline({
      settingsPath: args.settingsPath,
      scriptPath: __filename,
      twoLine: args.twoLine,
      noColor: args.noColor,
      stackWithDefault: args.stackWithDefault,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      process.stdout.write(`${res.message}\n`);
    }
    return res.ok ? 0 : 1;
  }

  if (args.mode === 'remove') {
    const res = removeCliStatusline({
      settingsPath: args.settingsPath,
      force: args.force,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      process.stdout.write(`${res.message}\n`);
    }
    return res.ok ? 0 : 1;
  }

  if (args.mode === 'inspect') {
    const report = await buildInspectReport({
      appDataDir: args.appDataDir,
      conversationId: args.conversationId,
      callsLimit: args.callsLimit,
      includeLiveQuota: true,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatInspectMarkdown(report)}\n`);
    }
    return 0;
  }

  // Default mode: Antigravity CLI `/statusline` renderer (must always exit 0)
  try {
    const rawStdin = await readStdinBounded(250);
    const payload = parseStatuslineStdin(rawStdin);
    const convId = args.conversationId || payload?.conversation_id || payload?.session_id || '';
    const dbSnap = readFastConversationSnapshot({
      conversationId: convId,
      appDataDir: args.appDataDir,
    });
    const width =
      args.width ??
      (typeof payload?.terminal_width === 'number' && payload.terminal_width > 20
        ? payload.terminal_width
        : process.stdout.columns || 100);

    const line = renderStatusline({
      payload,
      dbSnap,
      width,
      color: !args.noColor,
      twoLine: args.twoLine,
    });
    process.stdout.write(`${line}\n`);
  } catch {
    process.stdout.write('AGY-HUD\n');
  }
  return 0;
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return process.argv[1] === __filename;
  }
}

if (isEntrypoint()) {
  runCli().then((code) => {
    process.exit(code);
  }).catch(() => {
    process.exit(0);
  });
}
