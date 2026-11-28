/**
 * Atomic `0600` setup/removal helpers for Antigravity CLI `~/.gemini/antigravity-cli/settings.json`.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type {
  ConfigureStatuslineOptions,
  ConfigureStatuslineResult,
} from './format.ts';

export function getDefaultCliSettingsPath(home = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli', 'settings.json');
}

export function buildStatuslineCommand(options: {
  scriptPath: string;
  homeDir?: string;
  twoLine?: boolean;
  noColor?: boolean;
}): string {
  const absScript = resolve(options.scriptPath);
  const home = resolve(options.homeDir || homedir());
  let formattedPath = absScript;
  if (process.platform !== 'win32' && absScript.startsWith(`${home}/`)) {
    formattedPath = `~/${absScript.slice(home.length + 1)}`;
  }
  const needsQuotes = /\s/.test(formattedPath);
  const quotedPath = needsQuotes ? `"${formattedPath}"` : formattedPath;
  const flags: string[] = [];
  if (options.twoLine) flags.push('--two-line');
  if (options.noColor) flags.push('--no-color');
  return ['node', quotedPath, ...flags].join(' ');
}

function readSettingsJsonSafe(settingsPath: string): Record<string, any> {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, 'utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${settingsPath}`);
  }
  return parsed as Record<string, any>;
}

function writeSettingsJsonAtomically(settingsPath: string, obj: Record<string, any>): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(obj, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      /* ignore chmod errors on restricted FS */
    }
  }
  renameSync(tmpPath, settingsPath);
}

export function isAgyHudStatuslineCommand(cmd: unknown): boolean {
  if (typeof cmd !== 'string') return false;
  return /agy-hud/i.test(cmd) && /statusline\.ts/i.test(cmd);
}

export function inspectCliStatusline(options: {
  settingsPath?: string;
  homeDir?: string;
} = {}): {
  settingsPath: string;
  exists: boolean;
  configured: boolean;
  isAgyHud: boolean;
  enabled: boolean;
  command: string | null;
} {
  const settingsPath = resolve(options.settingsPath || getDefaultCliSettingsPath(options.homeDir));
  if (!existsSync(settingsPath)) {
    return { settingsPath, exists: false, configured: false, isAgyHud: false, enabled: false, command: null };
  }
  try {
    const obj = readSettingsJsonSafe(settingsPath);
    const sl = obj.statusLine;
    if (!sl || typeof sl !== 'object') {
      return { settingsPath, exists: true, configured: false, isAgyHud: false, enabled: false, command: null };
    }
    const cmd = typeof sl.command === 'string' ? sl.command : null;
    const enabled = sl.enabled !== false && Boolean(cmd);
    return {
      settingsPath,
      exists: true,
      configured: Boolean(cmd),
      isAgyHud: isAgyHudStatuslineCommand(cmd),
      enabled,
      command: cmd,
    };
  } catch {
    return { settingsPath, exists: true, configured: false, isAgyHud: false, enabled: false, command: null };
  }
}

export function configureCliStatusline(
  options: ConfigureStatuslineOptions,
): ConfigureStatuslineResult {
  const home = options.homeDir || homedir();
  const settingsPath = resolve(options.settingsPath || getDefaultCliSettingsPath(home));
  const command = buildStatuslineCommand({
    scriptPath: options.scriptPath,
    homeDir: home,
    twoLine: options.twoLine,
    noColor: options.noColor,
  });

  const existing = readSettingsJsonSafe(settingsPath);
  const prevCmd =
    existing.statusLine && typeof existing.statusLine === 'object' && typeof existing.statusLine.command === 'string'
      ? existing.statusLine.command
      : null;

  const nextStatusLine: Record<string, any> = {
    type: 'command',
    command,
    enabled: true,
  };
  if (options.stackWithDefault) {
    nextStatusLine.stack_with_default = true;
  }

  existing.statusLine = nextStatusLine;
  writeSettingsJsonAtomically(settingsPath, existing);

  return {
    ok: true,
    action: 'configured',
    settingsPath,
    command,
    previousCommand: prevCmd,
    message: `Configured Antigravity CLI statusLine in ${settingsPath} -> ${command}`,
  };
}

export function removeCliStatusline(options: {
  settingsPath?: string;
  homeDir?: string;
  force?: boolean;
} = {}): ConfigureStatuslineResult {
  const home = options.homeDir || homedir();
  const settingsPath = resolve(options.settingsPath || getDefaultCliSettingsPath(home));

  if (!existsSync(settingsPath)) {
    return {
      ok: true,
      action: 'noop',
      settingsPath,
      command: null,
      previousCommand: null,
      message: `No Antigravity CLI settings file found at ${settingsPath}; nothing to remove.`,
    };
  }

  const existing = readSettingsJsonSafe(settingsPath);
  const prevCmd =
    existing.statusLine && typeof existing.statusLine === 'object' && typeof existing.statusLine.command === 'string'
      ? existing.statusLine.command
      : null;

  if (!prevCmd) {
    return {
      ok: true,
      action: 'noop',
      settingsPath,
      command: null,
      previousCommand: null,
      message: `No custom statusLine configured in ${settingsPath}.`,
    };
  }

  if (!options.force && !isAgyHudStatuslineCommand(prevCmd)) {
    return {
      ok: false,
      action: 'blocked',
      settingsPath,
      command: prevCmd,
      previousCommand: prevCmd,
      message: `Existing statusLine is managed by another script (${prevCmd}). Re-run with --force to remove it.`,
    };
  }

  delete existing.statusLine;
  writeSettingsJsonAtomically(settingsPath, existing);

  return {
    ok: true,
    action: 'removed',
    settingsPath,
    command: null,
    previousCommand: prevCmd,
    message: `Removed AGY-HUD statusLine from ${settingsPath}.`,
  };
}
