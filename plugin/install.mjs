#!/usr/bin/env node
/**
 * Install, symlink (dev mode), or uninstall the AGY-HUD Antigravity plugin.
 *
 *   node plugin/install.mjs              staged copy into ~/.gemini/config/plugins/agy-hud
 *   node plugin/install.mjs --link       symlink this plugin/ folder for live development
 *   node plugin/install.mjs --uninstall  remove the installed plugin
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_NAME = 'agy-hud';
const MIN_NODE = [22, 18];
const SKIP_NAMES = new Set(['install.mjs', 'test', 'node_modules', '.DS_Store', 'tsconfig.json']);

const sourceDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
const targetDir = join(homedir(), '.gemini', 'config', 'plugins', PLUGIN_NAME);

function warnNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    console.warn(
      `Warning: running Node.js ${process.versions.node}; the AGY-HUD sidecar requires Node.js >= ${MIN_NODE.join('.')} (built-in node:sqlite).`,
    );
  }
}

function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function removeExisting(p) {
  if (pathExists(p)) rmSync(p, { recursive: true, force: true });
}

function install(link) {
  warnNodeVersion();
  const parent = dirname(targetDir);
  mkdirSync(parent, { recursive: true });

  if (link) {
    removeExisting(targetDir);
    symlinkSync(sourceDir, targetDir, process.platform === 'win32' ? 'junction' : 'dir');
    console.log(`Linked ${PLUGIN_NAME} plugin: ${targetDir} -> ${sourceDir}`);
    return;
  }

  if (existsSync(targetDir) && !lstatSync(targetDir).isSymbolicLink() && realpathSync(targetDir) === sourceDir) {
    console.log(`Plugin already resides at target path: ${targetDir}`);
    return;
  }

  const stageRoot = mkdtempSync(join(parent, `.${PLUGIN_NAME}-stage-`));
  const stageDst = join(stageRoot, PLUGIN_NAME);
  try {
    cpSync(sourceDir, stageDst, {
      recursive: true,
      filter: (src) => !SKIP_NAMES.has(basename(src)),
    });
    removeExisting(targetDir);
    renameSync(stageDst, targetDir);
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
  console.log(`Installed ${PLUGIN_NAME} plugin to: ${targetDir}`);
}

function uninstall() {
  if (pathExists(targetDir)) {
    removeExisting(targetDir);
    console.log(`Removed ${PLUGIN_NAME} plugin from: ${targetDir}`);
  } else {
    console.log(`Plugin directory not found: ${targetDir}`);
  }
}

function main(argv) {
  const flags = new Set(argv);
  if (flags.has('-h') || flags.has('--help')) {
    console.log('Usage: node plugin/install.mjs [--link | --uninstall]');
    return;
  }
  const unknown = argv.filter((a) => !['--link', '--uninstall'].includes(a));
  if (unknown.length || (flags.has('--link') && flags.has('--uninstall'))) {
    console.error('Usage: node plugin/install.mjs [--link | --uninstall]');
    process.exitCode = 2;
    return;
  }
  if (flags.has('--uninstall')) uninstall();
  else install(flags.has('--link'));
}

main(process.argv.slice(2));
