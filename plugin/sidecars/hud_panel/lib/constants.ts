import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

export const UUID_RE = /^[0-9a-f-]{8,}$/i;
export const LIVE_STREAM_PREVIEW_MAX = 24_000;
export const DETAIL_CONTENT_MAX = 60_000;
export const DETAIL_TOOL_ARGS_MAX = 4_000;
export const DETAIL_COMPACT_MAX = 20_000;
export const DETAIL_PROMPT_MAX = 4_000;
export const SYNC_GRAPH_WARM_LIMIT = 30;
export const QUOTA_TTL_MS = 300_000;

export interface AppDataRoot {
  appDataDir: string;
  conversationsDir: string;
  annotationsDir: string;
  source: string;
}

export interface DiscoveredRootEntry {
  appDataDir: string;
  source: string;
}

export interface ResolveAppDataOptions {
  discoverExternal?: boolean;
  homeDir?: string;
  discoveredRootsPath?: string;
  processCommands?: string;
}

export const MODEL_LIMIT_FALLBACKS: readonly [RegExp, number][] = [
  [/gemini-4/i, 512_000],
  [/gemini-pro-orchestrator/i, 512_000],
  [/gemini-flash-worker/i, 512_000],
  [/gemini-3\.8-flash/i, 256_000],
  [/claude/i, 200_000],
  [/gpt-4o/i, 128_000],
  [/gemini-2\.5-pro/i, 2_097_152],
  [/gemini/i, 1_048_576],
];

export const DEFAULT_PRICING_CONFIG = {
  unpricedSubstrings: ['gpt-oss'],
  rules: [
    { match: ['gemini-4-hydrogen', 'gemini 4 hydrogen', 'hydrogen', 'orchestrator (hydrogen)'], key: 'gemini-4-hydrogen', input: 1.50, output: 7.50, cached: 0.075 },
    { match: ['gemini-3.8-flash', 'gemini-flash-worker-agy'], key: 'gemini-3.8-flash', input: 0.75, output: 3.75, cached: 0.075 },
    { match: ['gemini-4-neon', 'gemini 4 neon', 'gemini-pro-orchestrator-neon', 'orchestrator (neon)', 'neon'], key: 'gemini-4-neon', input: 3.00, output: 15.00, cached: 0.15 },
    {
      match: [
        'gemini-4-carbon',
        'gemini-4-argon',
        'gemini-pro-orchestrator',
        'orchestrator (carbon)',
        'gemini-pro-orchestrator-argon',
        'orchestrator (argon)',
      ],
      gaCutoffIso: '2026-12-01T00:00:00.000Z',
      preview: { key: 'gemini-4-pro-preview', input: 2.00, output: 10.00, cached: 0.10 },
      ga: { key: 'gemini-4-pro-ga', input: 4.00, output: 20.00, cached: 0.20 },
    },
    { match: ['claude-opus-5-5', 'claude-opus-5.5'], key: 'claude-opus-5-5', input: 4.00, output: 20.00, cached: 0.20 },
    { match: ['claude-sonnet-5-5', 'claude-sonnet-5.5'], key: 'claude-sonnet-5-5', input: 2.00, output: 10.00, cached: 0.20 },
  ],
};

export const ACTIVE_STEP_STATUSES = new Set([1, 2, 8, 9, 11]);
export const TERMINAL_STEP_STATUSES = new Set([3, 4, 5, 6, 7]);
export const STEP_STATUS_NAMES = {
  1: 'PENDING',
  2: 'RUNNING',
  8: 'GENERATING',
  9: 'WAITING',
  11: 'QUEUED',
};

export const LS_ACTIVE_STEP_STATUSES = new Map([
  ['CORTEX_STEP_STATUS_PENDING', { code: 1, name: 'PENDING' }],
  ['CORTEX_STEP_STATUS_RUNNING', { code: 2, name: 'RUNNING' }],
  ['CORTEX_STEP_STATUS_GENERATING', { code: 8, name: 'GENERATING' }],
  ['CORTEX_STEP_STATUS_WAITING', { code: 9, name: 'WAITING' }],
  ['CORTEX_STEP_STATUS_QUEUED', { code: 11, name: 'QUEUED' }],
]);

export const LS_TERMINAL_STEP_STATUSES = new Set([
  'CORTEX_STEP_STATUS_UNSPECIFIED',
  'CORTEX_STEP_STATUS_DONE',
  'CORTEX_STEP_STATUS_ERROR',
  'CORTEX_STEP_STATUS_CANCELLED',
  'CORTEX_STEP_STATUS_CANCELED',
  'CORTEX_STEP_STATUS_SKIPPED',
  'CORTEX_STEP_STATUS_REJECTED',
  'CORTEX_STEP_STATUS_COMPLETED',
]);

export const KNOWN_LS_PLACEHOLDERS = new Map([
  ['MODEL_PLACEHOLDER_M18', { model: 'gemini-3-flash-preview', modelId: 'gemini-3-flash-preview', modelDisplay: 'Gemini 3 Flash' }],
  ['MODEL_PLACEHOLDER_M20', { model: 'gemini-3.5-flash-low', modelId: 'gemini-3.5-flash-low', modelDisplay: 'Gemini 3.5 Flash (Medium)' }],
  ['MODEL_PLACEHOLDER_M36', { model: 'gemini-3.1-pro-low-thinking', modelId: 'gemini-3.1-pro-low-thinking', modelDisplay: 'Gemini 3.1 Pro (Low)' }],
  ['MODEL_PLACEHOLDER_M37', { model: 'gemini-4-carbon', modelId: 'gemini-4-carbon', modelDisplay: 'Gemini 4 Carbon' }],
  ['MODEL_PLACEHOLDER_M50', { model: 'gemini-3.1-flash-lite-preview', modelId: 'gemini-3.1-flash-lite-preview', modelDisplay: 'Gemini 3.1 Flash Lite' }],
  ['MODEL_PLACEHOLDER_M71', { model: 'gemini-3.6-flash-high', modelId: 'gemini-3.6-flash-high', modelDisplay: 'Gemini 3.6 Flash (High)' }],
  ['MODEL_PLACEHOLDER_M72', { model: 'gemini-3.6-flash-medium', modelId: 'gemini-3.6-flash-medium', modelDisplay: 'Gemini 3.6 Flash (Medium)' }],
  ['MODEL_PLACEHOLDER_M73', { model: 'gemini-3.6-flash-low', modelId: 'gemini-3.6-flash-low', modelDisplay: 'Gemini 3.6 Flash (Low)' }],
  ['MODEL_PLACEHOLDER_M149', { model: 'gemini-3.5-flash', modelId: 'gemini-3.5-flash', modelDisplay: 'Gemini 3.5 Flash (High)' }],
  ['MODEL_PLACEHOLDER_M187', { model: 'gemini-3.5-flash-extra-low', modelId: 'gemini-3.5-flash-extra-low', modelDisplay: 'Gemini 3.5 Flash (Low)' }],
  ['MODEL_PLACEHOLDER_M298', { model: 'gemini-3.7-flash-high', modelId: 'gemini-3.7-flash-high', modelDisplay: 'Gemini 3.7 Flash (High)' }],
  ['MODEL_PLACEHOLDER_M299', { model: 'gemini-3.7-flash-medium', modelId: 'gemini-3.7-flash-medium', modelDisplay: 'Gemini 3.7 Flash (Medium)' }],
  ['MODEL_PLACEHOLDER_M300', { model: 'gemini-3.7-flash-low', modelId: 'gemini-3.7-flash-low', modelDisplay: 'Gemini 3.7 Flash (Low)' }],
  ['MODEL_PLACEHOLDER_M318', { model: 'gemini-3.8-flash-high', modelId: 'gemini-3.8-flash-high', modelDisplay: 'Gemini 3.8 Flash (High)' }],
  ['MODEL_PLACEHOLDER_M319', { model: 'gemini-3.8-flash-medium', modelId: 'gemini-3.8-flash-medium', modelDisplay: 'Gemini 3.8 Flash (Medium)' }],
  ['MODEL_PLACEHOLDER_M320', { model: 'gemini-3.8-flash-low', modelId: 'gemini-3.8-flash-low', modelDisplay: 'Gemini 3.8 Flash (Low)' }],
  ['MODEL_PLACEHOLDER_M400', { model: 'claude-opus-5-5-low', modelId: 'claude-opus-5-5-low', modelDisplay: 'Claude Opus 5.5 (Low)' }],
  ['MODEL_PLACEHOLDER_M401', { model: 'claude-opus-5-5-medium', modelId: 'claude-opus-5-5-medium', modelDisplay: 'Claude Opus 5.5 (Medium)' }],
  ['MODEL_PLACEHOLDER_M402', { model: 'claude-opus-5-5-high', modelId: 'claude-opus-5-5-high', modelDisplay: 'Claude Opus 5.5 (High)' }],
  ['MODEL_PLACEHOLDER_M403', { model: 'claude-sonnet-5-5-low', modelId: 'claude-sonnet-5-5-low', modelDisplay: 'Claude Sonnet 5.5 (Low)' }],
  ['MODEL_PLACEHOLDER_M404', { model: 'claude-sonnet-5-5-medium', modelId: 'claude-sonnet-5-5-medium', modelDisplay: 'Claude Sonnet 5.5 (Medium)' }],
  ['MODEL_PLACEHOLDER_M405', { model: 'claude-sonnet-5-5-high', modelId: 'claude-sonnet-5-5-high', modelDisplay: 'Claude Sonnet 5.5 (High)' }],
  ['MODEL_PLACEHOLDER_M406', { model: 'claude-opus-5-5-max', modelId: 'claude-opus-5-5-max', modelDisplay: 'Claude Opus 5.5 (Max)' }],
  ['MODEL_PLACEHOLDER_M407', { model: 'claude-sonnet-5-5-max', modelId: 'claude-sonnet-5-5-max', modelDisplay: 'Claude Sonnet 5.5 (Max)' }],
  ['MODEL_PLACEHOLDER_M417', { model: 'gemini-4-argon-high', modelId: 'gemini-4-argon-high', modelDisplay: 'Gemini 4 Argon (High)' }],
  ['MODEL_PLACEHOLDER_M418', { model: 'gemini-4-argon-medium', modelId: 'gemini-4-argon-medium', modelDisplay: 'Gemini 4 Argon (Medium)' }],
  ['MODEL_PLACEHOLDER_M419', { model: 'gemini-4-argon-low', modelId: 'gemini-4-argon-low', modelDisplay: 'Gemini 4 Argon (Low)' }],
  ['MODEL_PLACEHOLDER_M427', { model: 'gemini-4-carbon-high', modelId: 'gemini-4-carbon-high', modelDisplay: 'Gemini 4 Carbon (High)' }],
  ['MODEL_PLACEHOLDER_M437', { model: 'gemini-4-carbon-medium', modelId: 'gemini-4-carbon-medium', modelDisplay: 'Gemini 4 Carbon (Medium)' }],
  ['MODEL_PLACEHOLDER_M438', { model: 'gemini-4-carbon-low', modelId: 'gemini-4-carbon-low', modelDisplay: 'Gemini 4 Carbon (Low)' }],
  ['MODEL_PLACEHOLDER_M461', { model: 'gemini-4-hydrogen-high', modelId: 'gemini-4-hydrogen-high', modelDisplay: 'Gemini 4 Hydrogen (High)' }],
  ['MODEL_PLACEHOLDER_M462', { model: 'gemini-4-hydrogen-medium', modelId: 'gemini-4-hydrogen-medium', modelDisplay: 'Gemini 4 Hydrogen (Medium)' }],
  ['MODEL_PLACEHOLDER_M463', { model: 'gemini-4-hydrogen-low', modelId: 'gemini-4-hydrogen-low', modelDisplay: 'Gemini 4 Hydrogen (Low)' }],
  ['MODEL_PLACEHOLDER_M532', { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (High)' }],
  ['MODEL_PLACEHOLDER_M533', { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (Medium)' }],
  ['MODEL_PLACEHOLDER_M534', { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (Low)' }],
  ['MODEL_PLACEHOLDER_M535', { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (XHigh)' }],
  ['MODEL_PLACEHOLDER_M537', { model: 'gemini-pro-orchestrator-neon', modelId: 'gemini-pro-orchestrator-neon', modelDisplay: 'Orchestrator (Neon)' }],
  ['MODEL_PLACEHOLDER_M667', { model: 'gemini-pro-orchestrator', modelId: 'gemini-pro-orchestrator', modelDisplay: 'Orchestrator (Carbon)' }],
  ['MODEL_PLACEHOLDER_M681', { model: 'gemini-pro-orchestrator-argon', modelId: 'gemini-pro-orchestrator-argon', modelDisplay: 'Orchestrator (Argon)' }],
]);

export const KNOWN_MODEL_ENUMS = new Map([
  [1037, { model: 'gemini-4-carbon', modelId: 'gemini-4-carbon', modelDisplay: 'Gemini 4 Carbon' }],
  [1318, { model: 'gemini-3.8-flash-n', modelId: 'gemini-3.8-flash-n', modelDisplay: 'Gemini 3.8 Flash (High)' }],
  [1320, { model: 'gemini-3.8-flash', modelId: 'gemini-3.8-flash', modelDisplay: 'Gemini 3.8 Flash (Low)' }],
  [1402, { model: 'claude-opus-5-5-high', modelId: 'claude-opus-5-5-high', modelDisplay: 'Claude Opus 5.5 (High)' }],
  [1405, { model: 'claude-sonnet-5-5-high', modelId: 'claude-sonnet-5-5-high', modelDisplay: 'Claude Sonnet 5.5 (High)' }],
  [1417, { model: 'gemini-4-argon', modelId: 'gemini-4-argon', modelDisplay: 'Gemini 4 Argon (High)' }],
  [1418, { model: 'gemini-4-argon', modelId: 'gemini-4-argon', modelDisplay: 'Gemini 4 Argon (Medium)' }],
  [1419, { model: 'gemini-4-argon', modelId: 'gemini-4-argon', modelDisplay: 'Gemini 4 Argon (Low)' }],
  [1427, { model: 'gemini-4-carbon', modelId: 'gemini-4-carbon', modelDisplay: 'Gemini 4 Carbon (High)' }],
  [1437, { model: 'gemini-4-carbon', modelId: 'gemini-4-carbon', modelDisplay: 'Gemini 4 Carbon (Medium)' }],
  [1438, { model: 'gemini-4-carbon', modelId: 'gemini-4-carbon', modelDisplay: 'Gemini 4 Carbon (Low)' }],
  [1461, { model: 'gemini-4-hydrogen', modelId: 'gemini-4-hydrogen', modelDisplay: 'Gemini 4 Hydrogen (High)' }],
  [1525, { model: 'gemini-4-hydrogen', modelId: 'gemini-4-hydrogen', modelDisplay: 'Gemini 4 Hydrogen (High)' }],
  [1526, { model: 'gemini-4-hydrogen', modelId: 'gemini-4-hydrogen', modelDisplay: 'Gemini 4 Hydrogen (Medium)' }],
  [1527, { model: 'gemini-4-hydrogen', modelId: 'gemini-4-hydrogen', modelDisplay: 'Gemini 4 Hydrogen (Low)' }],
  [1528, { model: 'gemini-4-hydrogen', modelId: 'gemini-4-hydrogen', modelDisplay: 'Gemini 4 Hydrogen (XHigh)' }],
  [1532, { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (High)' }],
  [1533, { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (Medium)' }],
  [1534, { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (Low)' }],
  [1535, { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (XHigh)' }],
  [1537, { model: 'gemini-pro-orchestrator-neon', modelId: 'gemini-pro-orchestrator-neon', modelDisplay: 'Orchestrator (Neon)' }],
  [1667, { model: 'gemini-pro-orchestrator', modelId: 'gemini-pro-orchestrator', modelDisplay: 'Orchestrator (Carbon)' }],
  [1669, { model: 'gemini-flash-worker-agy', modelId: 'gemini-flash-worker-agy', modelDisplay: 'Gemini 4 Hydrogen (Orchestrator)' }],
  [1681, { model: 'gemini-pro-orchestrator-argon', modelId: 'gemini-pro-orchestrator-argon', modelDisplay: 'Orchestrator (Argon)' }],
]);

export function localDayKey(ms) {
  if (!ms || ms <= 0) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoMs(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function clipText(str, maxLen) {
  if (!str) return '';
  const clean = str.trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
}

export function clipLiveStreamText(str, maxLen = LIVE_STREAM_PREVIEW_MAX) {
  if (!str) return { text: '', totalChars: 0, truncatedHead: false };
  const clean = str.trim();
  const totalChars = clean.length;
  if (totalChars <= maxLen) {
    return { text: clean, totalChars, truncatedHead: false };
  }
  return {
    text: `…${clean.slice(-(maxLen - 1))}`,
    totalChars,
    truncatedHead: true,
  };
}

export function mergeIntervalDurationSec(intervals) {
  if (!intervals.length) return 0;
  intervals.sort((a, b) => a[0] - b[0]);
  let totalMs = 0;
  let [curStart, curEnd] = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e;
    } else {
      totalMs += Math.max(0, curEnd - curStart);
      curStart = s;
      curEnd = e;
    }
  }
  totalMs += Math.max(0, curEnd - curStart);
  return totalMs / 1000;
}

export function statSafe(path) {
  try {
    const s = statSync(path);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return { mtimeMs: 0, size: 0 };
  }
}

export function resolveAppDataDir() {
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) {
    for (let d = execData; d !== dirname(d); d = dirname(d)) {
      if (basename(d) === 'sidecar_data') {
        const root = dirname(d);
        if (existsSync(join(root, 'conversations'))) return root;
      }
    }
  }
  const envApp = process.env.ANTIGRAVITY_APP_DATA_DIR;
  if (envApp && existsSync(join(envApp, 'conversations'))) return envApp;
  return join(homedir(), '.gemini', 'antigravity');
}

const KNOWN_SIBLING_APP_DIRS = [
  { dirName: 'antigravity', source: 'app' },
  { dirName: 'antigravity-cli', source: 'cli' },
  { dirName: 'antigravity-acp', source: 'cli' },
  { dirName: 'antigravity-ide', source: 'ide' },
];

const PROCESS_SCAN_TTL_MS = process.platform === 'win32' ? 10_000 : 5_000;
let processScanCache: { atMs: number; entries: DiscoveredRootEntry[] } = { atMs: 0, entries: [] };

function isPathAbsolute(p) {
  return Boolean(p) && (isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p));
}

function isDefaultGeminiRoot(primaryDir) {
  const defaultGemini = join(homedir(), '.gemini');
  try {
    return realpathSync(dirname(primaryDir)) === realpathSync(defaultGemini);
  } catch {
    return resolve(dirname(primaryDir)) === resolve(defaultGemini);
  }
}

function extractCliFlag(line, flagPattern) {
  const re = new RegExp(`(?:^|\\s)${flagPattern}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(.+?))(?=\\s+--?[a-zA-Z]|\\s*$)`);
  const m = re.exec(line);
  if (!m) return '';
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

export function parseProcessCommandLines(stdout: string, homeDir = homedir()): DiscoveredRootEntry[] {
  if (!stdout) return [];
  const results: DiscoveredRootEntry[] = [];
  const seen = new Set<string>();
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^CommandLine=/i.test(line)) {
      line = line.slice('CommandLine='.length).trim();
    }
    const head = line.split(/\s+-/, 1)[0].trim();
    const binMatch = /(?:^|[\\/]|["'])(agy|language_server(?:_[^\s\\"']+)?)(?:\.exe)?(?=["']?(?:\s|$))/i.exec(head);
    if (!binMatch) continue;
    const isAgyCli = binMatch[1].toLowerCase() === 'agy';

    const rawGeminiDir = extractCliFlag(line, '--gemini[-_]dir');
    const rawAppDataDir = extractCliFlag(line, '--app[-_]data[-_]dir');
    if (!rawGeminiDir && !rawAppDataDir) continue;

    let geminiDir = join(homeDir, '.gemini');
    if (rawGeminiDir) {
      geminiDir = isPathAbsolute(rawGeminiDir) ? rawGeminiDir : join(homeDir, rawGeminiDir);
    }

    const effectiveAppDir = rawAppDataDir || (isAgyCli ? 'antigravity-cli' : 'antigravity');
    const appDataDir = isPathAbsolute(effectiveAppDir) ? effectiveAppDir : join(geminiDir, effectiveAppDir);
    if (seen.has(appDataDir)) continue;
    seen.add(appDataDir);
    results.push({
      appDataDir,
      source: isAgyCli ? 'cli' : inferAppDataSource(appDataDir),
    });
  }
  return results;
}

function readLinuxProcCommandLines(): string | null {
  const lines: string[] = [];
  let pids: string[];
  try {
    pids = readdirSync('/proc');
  } catch {
    return null;
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const raw = readFileSync(`/proc/${pid}/cmdline`);
      if (!raw || !raw.length) continue;
      const args = raw.toString('utf8').split('\0').filter(Boolean);
      if (!args.length) continue;
      if (!/(?:^|\/)(?:agy|language_server[^/]*)$/i.test(args[0])) continue;
      lines.push(args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '));
    } catch {
      /* process exited or permission denied */
    }
  }
  return lines.join('\n');
}

function discoverRunningProcessAppDataDirs(homeDir = homedir()) {
  const now = Date.now();
  if (now - processScanCache.atMs < PROCESS_SCAN_TTL_MS) {
    return processScanCache.entries;
  }
  let stdout = '';
  try {
    if (process.platform === 'win32') {
      try {
        stdout = execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Get-CimInstance Win32_Process -Filter \"Name like 'agy%' or Name like 'language_server%'\" | ForEach-Object { $_.CommandLine }",
          ],
          { encoding: 'utf8', timeout: 1500, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        );
      } catch {
        stdout = execFileSync(
          'wmic',
          ['process', 'where', "name like 'agy%' or name like 'language_server%'", 'get', 'CommandLine', '/VALUE'],
          { encoding: 'utf8', timeout: 1500, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        );
      }
    } else if (process.platform === 'linux') {
      const procOut = readLinuxProcCommandLines();
      if (procOut !== null) {
        stdout = procOut;
      } else {
        stdout = execFileSync('ps', ['-ax', '-o', 'command='], {
          encoding: 'utf8',
          timeout: 800,
          maxBuffer: 2 * 1024 * 1024,
        });
      }
    } else {
      stdout = execFileSync('ps', ['-ax', '-o', 'command='], {
        encoding: 'utf8',
        timeout: 800,
        maxBuffer: 2 * 1024 * 1024,
      });
    }
  } catch {
    stdout = '';
  }
  const entries = parseProcessCommandLines(stdout, homeDir);
  processScanCache = { atMs: now, entries };
  return entries;
}

export function resolveDiscoveredRootsPath(appDataDir = resolveAppDataDir()) {
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) return join(execData, 'discovered-roots.json');
  return join(appDataDir, 'sidecar_data', 'agy-hud', 'hud_panel', 'data', 'discovered-roots.json');
}

function loadDiscoveredRoots(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const list = Array.isArray(parsed?.roots) ? parsed.roots : [];
    return list.filter((r) => r && typeof r.appDataDir === 'string' && r.appDataDir);
  } catch {
    return [];
  }
}

function saveDiscoveredRoots(filePath, roots) {
  if (!filePath) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, roots }, null, 2), 'utf8');
    renameSync(tmp, filePath);
  } catch {
    /* non-fatal persistence failure */
  }
}

export function inferAppDataSource(appDataDir) {
  const base = basename(String(appDataDir || '')).toLowerCase();
  if (base.includes('cli') || base.includes('acp')) return 'cli';
  if (base.includes('ide')) return 'ide';
  return 'app';
}

export function resolveAllAppDataDirs(
  primaryDir = resolveAppDataDir(),
  options: ResolveAppDataOptions = {},
): AppDataRoot[] {
  const out: AppDataRoot[] = [];
  const seen = new Set<string>();
  const pushDir = (dirPath: string, explicitSource = '') => {
    if (!dirPath) return;
    const convDir = join(dirPath, 'conversations');
    if (dirPath !== primaryDir && !existsSync(convDir)) return;
    let canonical = dirPath;
    try {
      canonical = realpathSync(dirPath);
    } catch {
      /* keep raw path when directory does not exist yet */
    }
    if (seen.has(canonical)) return;
    seen.add(canonical);
    out.push({
      appDataDir: dirPath,
      conversationsDir: convDir,
      annotationsDir: join(dirPath, 'annotations'),
      source: explicitSource || inferAppDataSource(dirPath),
    });
  };

  pushDir(primaryDir);

  const extraEnv = process.env.ANTIGRAVITY_EXTRA_DATA_DIRS || '';
  if (extraEnv.trim()) {
    for (const part of extraEnv.split(delimiter)) {
      const trimmed = part.trim();
      if (trimmed) pushDir(trimmed);
    }
    return out;
  }

  const base = basename(primaryDir);
  if (KNOWN_SIBLING_APP_DIRS.some((s) => s.dirName === base)) {
    const parent = dirname(primaryDir);
    for (const sib of KNOWN_SIBLING_APP_DIRS) {
      pushDir(join(parent, sib.dirName), sib.source);
    }
  }

  const discoverExternal = options.discoverExternal !== undefined
    ? Boolean(options.discoverExternal)
    : (process.env.ANTIGRAVITY_DISABLE_EXTERNAL_DISCOVERY !== '1' && isDefaultGeminiRoot(primaryDir));

  if (discoverExternal) {
    const homeDir = options.homeDir || homedir();
    const rootsPath = options.discoveredRootsPath !== undefined
      ? options.discoveredRootsPath
      : resolveDiscoveredRootsPath(primaryDir);
    const savedRoots = loadDiscoveredRoots(rootsPath);
    const procEntries = typeof options.processCommands === 'string'
      ? parseProcessCommandLines(options.processCommands, homeDir)
      : discoverRunningProcessAppDataDirs(homeDir);

    const baseKnownCount = out.length;
    for (const item of procEntries) {
      pushDir(item.appDataDir, item.source);
    }
    for (const item of savedRoots) {
      pushDir(item.appDataDir, item.source || '');
    }

    if (rootsPath) {
      const externalRoots = out.slice(baseKnownCount).map((r) => ({
        appDataDir: r.appDataDir,
        source: r.source,
      }));
      const prevSig = savedRoots.map((r) => `${r.appDataDir}|${r.source || ''}`).join('\n');
      const nextSig = externalRoots.map((r) => `${r.appDataDir}|${r.source}`).join('\n');
      if (prevSig !== nextSig) {
        saveDiscoveredRoots(rootsPath, externalRoots);
      }
    }
  }

  return out;
}

export function resolveQuotaCalibrationPath(appDataDir = resolveAppDataDir()) {
  const envCal = process.env.AGY_HUD_CALIBRATION_PATH;
  if (envCal) return envCal;
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) return join(execData, 'quota-calibration.json');
  const dataSub = join(appDataDir, 'sidecar_data', 'agy-hud', 'hud_panel', 'data', 'quota-calibration.json');
  if (existsSync(dataSub)) return dataSub;
  return join(appDataDir, 'sidecar_data', 'agy-hud', 'hud_panel', 'quota-calibration.json');
}

export function resolveQuotaFitPath(appDataDir = resolveAppDataDir()) {
  const envFit = process.env.AGY_HUD_QUOTA_FIT_PATH;
  if (envFit) return envFit;
  const envCal = process.env.AGY_HUD_CALIBRATION_PATH;
  if (envCal) return join(dirname(envCal), 'quota-model-fit.json');
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) return join(execData, 'quota-model-fit.json');
  const dataSub = join(appDataDir, 'sidecar_data', 'agy-hud', 'hud_panel', 'data', 'quota-model-fit.json');
  if (existsSync(dataSub)) return dataSub;
  return join(appDataDir, 'sidecar_data', 'agy-hud', 'hud_panel', 'quota-model-fit.json');
}

export function resolveGeminiPulsePath(appDataDir = resolveAppDataDir()) {
  const envPath = process.env.AGY_HUD_GEMINI_PULSE_PATH;
  if (envPath) return envPath;
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) return join(execData, 'gemini-pulse-cache.json');
  return join(appDataDir, 'sidecar_data', 'agy-hud', 'hud_panel', 'data', 'gemini-pulse-cache.json');
}

export function resolveTranscriptPaths(
  appDataDir: string,
  convId: string,
  allAppDirs: (string | AppDataRoot)[] | null = null,
) {
  const buildFor = (rootDir) => {
    const logsDir = join(rootDir, 'brain', convId, '.system_generated', 'logs');
    const jsonlPath = join(logsDir, 'transcript.jsonl');
    const jsonlFullPath = join(logsDir, 'transcript_full.jsonl');
    return {
      jsonlPath,
      jsonlFullPath,
      jsonlExists: existsSync(jsonlPath),
      jsonlFullExists: existsSync(jsonlFullPath),
    };
  };
  const primary = buildFor(appDataDir);
  if (primary.jsonlExists || primary.jsonlFullExists || !Array.isArray(allAppDirs)) {
    return primary;
  }
  for (const entry of allAppDirs) {
    const dir = typeof entry === 'string' ? entry : entry?.appDataDir;
    if (!dir || dir === appDataDir) continue;
    const alt = buildFor(dir);
    if (alt.jsonlExists || alt.jsonlFullExists) return alt;
  }
  return primary;
}
