#!/usr/bin/env node
/**
 * Cross-platform installer, updater, and environment doctor for the AGY-HUD Antigravity plugin.
 * Zero external runtime dependencies — uses only Node.js built-ins.
 *
 * Usage:
 *   node plugin/install.mjs [--install] [--target <dir>]
 *   node plugin/install.mjs --link [--target <dir>]
 *   node plugin/install.mjs --uninstall [--target <dir>]
 *   node plugin/install.mjs --check-update [--target <dir>] [--json]
 *   node plugin/install.mjs --update [--target <dir>] [--force] [--json]
 *   node plugin/install.mjs --doctor [--target <dir>] [--json]
 */
import { execFileSync } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { arch, homedir, platform, release } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertSafeArchiveEntryPath,
  compareSemver,
  downloadVerifiedArchive,
  extractArchiveSafely,
  extractTarGzSafely,
  extractZipSafely,
  FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  GITHUB_OWNER,
  GITHUB_REPO,
  isAllowedDownloadUrl,
  isSymlinkPath,
  locatePluginPayloadDir,
  parseSemver,
  pathExists,
  PLUGIN_NAME,
  readPluginManifest,
  removeWithRetry,
  renameWithRetry,
  REQUIRED_UI_FILES,
  SKIP_INSTALL_NAMES,
  swapDirectoryAtomically,
  validatePluginPayload,
} from './sidecars/hud_panel/lib/release-core.ts';

export {
  assertSafeArchiveEntryPath,
  compareSemver,
  extractTarGzSafely,
  extractZipSafely,
  GITHUB_OWNER,
  GITHUB_REPO,
  isAllowedDownloadUrl,
  isSymlinkPath,
  parseSemver,
  pathExists,
  PLUGIN_NAME,
  readPluginManifest,
  removeWithRetry,
  renameWithRetry,
  validatePluginPayload,
};

export const MIN_NODE = [22, 18];
export const SKIP_NAMES = SKIP_INSTALL_NAMES;

const __filename = fileURLToPath(import.meta.url);
const defaultSourceDir = dirname(realpathSync(__filename));

export function getDefaultTargetDir(home = homedir()) {
  return join(home, '.gemini', 'config', 'plugins', PLUGIN_NAME);
}

export function isNodeVersionSupported(nodeVersion = process.versions.node) {
  const [major, minor] = String(nodeVersion).split('.').map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

export function swapPluginAtomically({ sourcePayloadDir, targetDir, beforeSwapHook }) {
  const res = swapDirectoryAtomically({
    sourcePayloadDir,
    targetDir,
    tempPrefix: `.${PLUGIN_NAME}-stage-`,
    beforeSwapHook,
  });
  return res.ok
    ? { ok: true, rolledBack: false }
    : { ok: false, rolledBack: res.rolledBack, error: res.error };
}

async function fetchLatestReleaseInfo({
  owner = GITHUB_OWNER,
  repo = GITHUB_REPO,
  currentVersion = '0.0.0',
  fetchImpl = globalThis.fetch,
} = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `${PLUGIN_NAME}-installer/${currentVersion}`,
  };

  const latestUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const res = await fetchWithTimeout(fetchImpl, latestUrl, { headers }, FETCH_TIMEOUT_MS);

  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers?.get?.('x-ratelimit-remaining');
    if (res.status === 429 || remaining === '0') {
      throw new Error('GitHub API rate limit exceeded. Try again later.');
    }
  }

  if (res.ok) {
    const releaseData = await res.json();
    const rawTag = String(releaseData?.tag_name || releaseData?.name || '').trim();
    if (!parseSemver(rawTag)) {
      throw new Error(`Invalid SemVer release tag: ${rawTag}`);
    }
    const assets = Array.isArray(releaseData?.assets) ? releaseData.assets : [];
    const tarAsset = assets.find(
      (a) =>
        typeof a?.name === 'string' &&
        typeof a?.browser_download_url === 'string' &&
        /\.(tar\.gz|tgz)$/i.test(a.name) &&
        isAllowedDownloadUrl(a.browser_download_url, { owner, repo }),
    );
    const zipAsset = assets.find(
      (a) =>
        typeof a?.name === 'string' &&
        typeof a?.browser_download_url === 'string' &&
        /\.zip$/i.test(a.name) &&
        isAllowedDownloadUrl(a.browser_download_url, { owner, repo }),
    );
    let downloadUrl = null;
    let assetKind = 'tar.gz';
    if (tarAsset) {
      downloadUrl = tarAsset.browser_download_url;
      assetKind = 'tar.gz';
    } else if (zipAsset) {
      downloadUrl = zipAsset.browser_download_url;
      assetKind = 'zip';
    } else if (
      typeof releaseData?.tarball_url === 'string' &&
      isAllowedDownloadUrl(releaseData.tarball_url, { owner, repo })
    ) {
      downloadUrl = releaseData.tarball_url;
      assetKind = 'tar.gz';
    } else {
      downloadUrl = `https://github.com/${owner}/${repo}/archive/refs/tags/${encodeURIComponent(rawTag)}.tar.gz`;
      assetKind = 'tar.gz';
    }

    return {
      latestVersion: rawTag.replace(/^[vV]/, ''),
      tagName: rawTag,
      releaseUrl:
        typeof releaseData?.html_url === 'string' && releaseData.html_url.startsWith(`https://github.com/${owner}/${repo}/`)
          ? releaseData.html_url
          : `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(rawTag)}`,
      downloadUrl,
      assetKind,
      publishedAt: typeof releaseData?.published_at === 'string' ? releaseData.published_at : null,
      source: 'release',
    };
  }

  if (res.status === 404) {
    // Fallback 1: tags
    const tagsRes = await fetchWithTimeout(
      fetchImpl,
      `https://api.github.com/repos/${owner}/${repo}/tags?per_page=15`,
      { headers },
      FETCH_TIMEOUT_MS,
    );
    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      if (Array.isArray(tags) && tags.length > 0) {
        let bestTag = null;
        for (const t of tags) {
          const name = typeof t?.name === 'string' ? t.name.trim() : '';
          if (parseSemver(name) && (!bestTag || compareSemver(name, bestTag) > 0)) {
            bestTag = name;
          }
        }
        if (bestTag) {
          const encTag = encodeURIComponent(bestTag);
          return {
            latestVersion: bestTag.replace(/^[vV]/, ''),
            tagName: bestTag,
            releaseUrl: `https://github.com/${owner}/${repo}/releases/tag/${encTag}`,
            downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/tags/${encTag}.tar.gz`,
            assetKind: 'tar.gz',
            publishedAt: null,
            source: 'tag',
          };
        }
      }
    }

    // Fallback 2: main branch manifest
    const manRes = await fetchWithTimeout(
      fetchImpl,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/plugin/plugin.json`,
      { headers: { 'User-Agent': `${PLUGIN_NAME}-installer/${currentVersion}` } },
      FETCH_TIMEOUT_MS,
    );
    if (manRes.ok) {
      const manifest = await manRes.json();
      const rawVer = typeof manifest?.version === 'string' ? manifest.version.trim() : '';
      if (parseSemver(rawVer)) {
        return {
          latestVersion: rawVer.replace(/^[vV]/, ''),
          tagName: 'main',
          releaseUrl: `https://github.com/${owner}/${repo}`,
          downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/main.tar.gz`,
          assetKind: 'tar.gz',
          publishedAt: null,
          source: 'manifest',
        };
      }
    }
  }

  throw new Error(`GitHub release check failed (HTTP ${res.status})`);
}

// ---------------------------------------------------------------------------
// Core operations: install, link, uninstall, check-update, update, doctor
// ---------------------------------------------------------------------------

function tryBuildUiIfInSourceRepo(sourceDir, { allowBuild = true, logger = console } = {}) {
  const missingUi = REQUIRED_UI_FILES.filter((rel) => {
    const full = join(sourceDir, rel);
    return !existsSync(full) || statSync(full).size === 0;
  });
  if (missingUi.length === 0) return { ok: true, built: false };

  const repoRoot = dirname(sourceDir);
  const webDir = join(repoRoot, 'web');
  const hasWebPkg = existsSync(join(webDir, 'package.json'));

  if (!hasWebPkg) {
    return {
      ok: false,
      built: false,
      error: `Missing pre-built UI bundle files: ${missingUi.join(', ')}`,
    };
  }
  if (!allowBuild) {
    return {
      ok: false,
      built: false,
      error: `Pre-built UI bundle missing (${missingUi.join(', ')}). Run "npm run build:ui" first.`,
    };
  }

  logger.warn?.(`Pre-built UI bundle missing (${missingUi.join(', ')}). Attempting to build from ${webDir}...`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    if (!existsSync(join(repoRoot, 'node_modules')) && !existsSync(join(webDir, 'node_modules'))) {
      execFileSync(npmCmd, ['--prefix', repoRoot, 'install'], { stdio: 'inherit', timeout: 180_000 });
    }
    execFileSync(npmCmd, ['--prefix', webDir, 'run', 'build'], { stdio: 'inherit', timeout: 120_000 });
  } catch (err) {
    return {
      ok: false,
      built: false,
      error: `UI build failed: ${err?.message || String(err)}`,
    };
  }

  const stillMissing = REQUIRED_UI_FILES.filter((rel) => {
    const full = join(sourceDir, rel);
    return !existsSync(full) || statSync(full).size === 0;
  });
  if (stillMissing.length > 0) {
    return {
      ok: false,
      built: false,
      error: `UI build completed but required assets are still missing: ${stillMissing.join(', ')}`,
    };
  }
  return { ok: true, built: true };
}

export function runInstall({
  sourceDir = defaultSourceDir,
  targetDir = getDefaultTargetDir(),
  link = false,
  allowBuild = true,
  beforeSwapHook,
  logger = console,
} = {}) {
  if (!isNodeVersionSupported()) {
    logger.warn?.(
      `Warning: running Node.js ${process.versions.node}; AGY-HUD sidecar requires Node.js >= ${MIN_NODE.join('.')} (built-in node:sqlite).`,
    );
  }

  const resolvedSource = realpathSync(sourceDir);
  const resolvedTarget = resolve(targetDir);
  const parent = dirname(resolvedTarget);
  mkdirSync(parent, { recursive: true });

  if (link) {
    const uiIndex = join(resolvedSource, 'sidecars', 'hud_panel', 'ui', 'index.html');
    if (!existsSync(uiIndex)) {
      logger.warn?.(
        `Warning: ${uiIndex} not found yet. Build the UI with "npm --prefix web run build" before opening the HUD.`,
      );
    }
    removeWithRetry(resolvedTarget);
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(resolvedSource, resolvedTarget, linkType);
    const manifest = readPluginManifest(resolvedSource);
    return {
      ok: true,
      mode: 'link',
      version: manifest?.version || '0.0.0',
      sourceDir: resolvedSource,
      targetDir: resolvedTarget,
      linkType,
      message: `Linked ${PLUGIN_NAME} plugin (${manifest?.version || 'unknown'}): ${resolvedTarget} -> ${resolvedSource}`,
    };
  }

  const uiCheck = tryBuildUiIfInSourceRepo(resolvedSource, { allowBuild, logger });
  if (!uiCheck.ok) {
    return {
      ok: false,
      mode: 'install',
      sourceDir: resolvedSource,
      targetDir: resolvedTarget,
      message: uiCheck.error,
    };
  }

  const validation = validatePluginPayload(resolvedSource);
  if (!validation.valid) {
    const detail = [...validation.missing.map((m) => `missing ${m}`), ...validation.errors].join('; ');
    return {
      ok: false,
      mode: 'install',
      sourceDir: resolvedSource,
      targetDir: resolvedTarget,
      message: `Source plugin validation failed: ${detail}`,
    };
  }

  if (
    existsSync(resolvedTarget) &&
    !isSymlinkPath(resolvedTarget) &&
    realpathSync(resolvedTarget) === resolvedSource
  ) {
    return {
      ok: true,
      mode: 'install',
      version: validation.version,
      sourceDir: resolvedSource,
      targetDir: resolvedTarget,
      alreadyInPlace: true,
      message: `Plugin (${validation.version}) already resides at target path: ${resolvedTarget}`,
    };
  }

  const swap = swapPluginAtomically({
    sourcePayloadDir: resolvedSource,
    targetDir: resolvedTarget,
    beforeSwapHook,
  });

  if (!swap.ok) {
    return {
      ok: false,
      mode: 'install',
      sourceDir: resolvedSource,
      targetDir: resolvedTarget,
      rolledBack: swap.rolledBack,
      message: swap.rolledBack
        ? `Install failed (${swap.error}); previous installation was restored.`
        : `Install failed: ${swap.error}`,
    };
  }

  return {
    ok: true,
    mode: 'install',
    version: validation.version,
    sourceDir: resolvedSource,
    targetDir: resolvedTarget,
    builtUi: uiCheck.built,
    message: `Installed ${PLUGIN_NAME} v${validation.version} to: ${resolvedTarget}`,
  };
}

export function runUninstall({ targetDir = getDefaultTargetDir() } = {}) {
  const resolvedTarget = resolve(targetDir);
  if (pathExists(resolvedTarget)) {
    const wasLink = isSymlinkPath(resolvedTarget);
    removeWithRetry(resolvedTarget);
    return {
      ok: true,
      removed: true,
      wasLink,
      targetDir: resolvedTarget,
      message: `Removed ${PLUGIN_NAME} ${wasLink ? 'symlink' : 'plugin'} from: ${resolvedTarget}`,
    };
  }
  return {
    ok: true,
    removed: false,
    wasLink: false,
    targetDir: resolvedTarget,
    message: `Plugin directory not found: ${resolvedTarget}`,
  };
}

export async function runCheckUpdate({
  targetDir = getDefaultTargetDir(),
  sourceDir = defaultSourceDir,
  owner = GITHUB_OWNER,
  repo = GITHUB_REPO,
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedTarget = resolve(targetDir);
  const installed = pathExists(resolvedTarget);
  const isLinked = isSymlinkPath(resolvedTarget);
  const targetManifest = installed ? readPluginManifest(resolvedTarget) : null;
  const fallbackManifest = !targetManifest ? readPluginManifest(sourceDir) : null;
  const currentVersion = targetManifest?.version || fallbackManifest?.version || '0.0.0';

  try {
    const latest = await fetchLatestReleaseInfo({ owner, repo, currentVersion, fetchImpl });
    const cmp = compareSemver(latest.latestVersion, currentVersion);
    const updateAvailable = cmp > 0;
    const status = cmp > 0 ? 'update_available' : cmp < 0 ? 'ahead' : 'up_to_date';
    return {
      ok: true,
      status,
      installed,
      isLinked,
      targetDir: resolvedTarget,
      currentVersion,
      latestVersion: latest.latestVersion,
      updateAvailable,
      releaseUrl: latest.releaseUrl,
      downloadUrl: latest.downloadUrl,
      assetKind: latest.assetKind,
      publishedAt: latest.publishedAt,
      source: latest.source,
      message: updateAvailable
        ? `Update available: v${currentVersion} -> v${latest.latestVersion} (${latest.releaseUrl})`
        : `AGY-HUD v${currentVersion} is up to date (latest: v${latest.latestVersion}).`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      installed,
      isLinked,
      targetDir: resolvedTarget,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      downloadUrl: null,
      assetKind: null,
      publishedAt: null,
      error: err?.message || String(err),
      message: `Failed to check for updates: ${err?.message || String(err)}`,
    };
  }
}

export async function runUpdate({
  targetDir = getDefaultTargetDir(),
  force = false,
  owner = GITHUB_OWNER,
  repo = GITHUB_REPO,
  versionTag = '',
  fetchImpl = globalThis.fetch,
  beforeSwapHook,
} = {}) {
  const resolvedTarget = resolve(targetDir);
  const installed = pathExists(resolvedTarget);
  const isLinked = isSymlinkPath(resolvedTarget);
  const currentManifest = installed ? readPluginManifest(resolvedTarget) : null;
  const previousVersion = currentManifest?.version || '0.0.0';

  if (isLinked && !force) {
    return {
      ok: false,
      reason: 'dev_symlink',
      previousVersion,
      newVersion: null,
      targetDir: resolvedTarget,
      message:
        `Refusing to overwrite dev symlink at ${resolvedTarget}. ` +
        'Use "git pull" in your repo, or re-run with --force to replace the symlink with a release copy.',
    };
  }

  let downloadUrl = null;
  let assetKind = 'tar.gz';
  let expectedVersion = null;
  let releaseUrl = null;

  if (versionTag) {
    const cleanTag = versionTag.trim();
    const encTag = encodeURIComponent(cleanTag);
    downloadUrl = `https://github.com/${owner}/${repo}/archive/refs/tags/${encTag}.tar.gz`;
    releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${encTag}`;
    expectedVersion = cleanTag.replace(/^[vV]/, '');
  } else {
    const check = await runCheckUpdate({ targetDir: resolvedTarget, owner, repo, fetchImpl });
    if (!check.ok) {
      return {
        ok: false,
        reason: 'check_failed',
        previousVersion,
        newVersion: null,
        targetDir: resolvedTarget,
        message: check.message,
      };
    }
    if (installed && !check.updateAvailable && !force) {
      return {
        ok: true,
        updated: false,
        reason: 'up_to_date',
        previousVersion,
        newVersion: previousVersion,
        targetDir: resolvedTarget,
        releaseUrl: check.releaseUrl,
        message: `AGY-HUD v${previousVersion} is already up to date.`,
      };
    }
    downloadUrl = check.downloadUrl;
    assetKind = check.assetKind || 'tar.gz';
    expectedVersion = check.latestVersion;
    releaseUrl = check.releaseUrl;
  }

  if (!downloadUrl || !isAllowedDownloadUrl(downloadUrl, { owner, repo })) {
    return {
      ok: false,
      reason: 'disallowed_url',
      previousVersion,
      newVersion: expectedVersion,
      targetDir: resolvedTarget,
      message: `Refused untrusted or missing download URL: ${downloadUrl || '<none>'}`,
    };
  }

  const parent = dirname(resolvedTarget);
  mkdirSync(parent, { recursive: true });
  const extractRoot = mkdtempSync(join(parent, `.${PLUGIN_NAME}-extract-`));

  try {
    let archiveBuf;
    try {
      const downloaded = await downloadVerifiedArchive(downloadUrl, {
        owner,
        repo,
        userAgent: `${PLUGIN_NAME}-installer`,
        fetchImpl,
      });
      archiveBuf = downloaded.buffer;
    } catch (err) {
      return {
        ok: false,
        reason: 'download_failed',
        previousVersion,
        newVersion: expectedVersion,
        targetDir: resolvedTarget,
        message: `Download failed: ${err?.message || String(err)}`,
      };
    }

    try {
      extractArchiveSafely(archiveBuf, extractRoot, assetKind);
    } catch (err) {
      return {
        ok: false,
        reason: 'extract_failed',
        previousVersion,
        newVersion: expectedVersion,
        targetDir: resolvedTarget,
        message: `Safe extraction failed: ${err?.message || String(err)}`,
      };
    }

    const payloadDir = locatePluginPayloadDir(extractRoot);
    if (!payloadDir) {
      return {
        ok: false,
        reason: 'invalid_payload',
        previousVersion,
        newVersion: expectedVersion,
        targetDir: resolvedTarget,
        message: 'Downloaded archive does not contain a valid AGY-HUD plugin directory.',
      };
    }

    const validation = validatePluginPayload(payloadDir);
    if (!validation.valid) {
      const detail = [...validation.missing.map((m) => `missing ${m}`), ...validation.errors].join('; ');
      return {
        ok: false,
        reason: 'invalid_payload',
        previousVersion,
        newVersion: expectedVersion,
        targetDir: resolvedTarget,
        message: `Downloaded package failed validation: ${detail}`,
      };
    }

    const swap = swapPluginAtomically({
      sourcePayloadDir: payloadDir,
      targetDir: resolvedTarget,
      beforeSwapHook,
    });

    if (!swap.ok) {
      return {
        ok: false,
        reason: 'swap_failed',
        previousVersion,
        newVersion: validation.version,
        targetDir: resolvedTarget,
        rolledBack: swap.rolledBack,
        message: swap.rolledBack
          ? `Update swap failed (${swap.error}); automatically rolled back to v${previousVersion}.`
          : `Update swap failed: ${swap.error}`,
      };
    }

    return {
      ok: true,
      updated: true,
      previousVersion,
      newVersion: validation.version,
      targetDir: resolvedTarget,
      releaseUrl,
      message: installed
        ? `Updated ${PLUGIN_NAME} from v${previousVersion} to v${validation.version} at ${resolvedTarget}`
        : `Installed ${PLUGIN_NAME} v${validation.version} to ${resolvedTarget}`,
    };
  } finally {
    try {
      removeWithRetry(extractRoot);
    } catch {
      /* ignore */
    }
  }
}

function findExecutableInPath(binName, envPath = process.env.PATH || '') {
  if (!envPath) return null;
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${binName}${ext}`);
      try {
        accessSync(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

export async function runDoctor({
  targetDir = getDefaultTargetDir(),
  homeDir = homedir(),
  env = process.env,
} = {}) {
  const resolvedTarget = resolve(targetDir);
  const checks = [];

  // 1. OS & Platform
  const osInfo = {
    platform: platform(),
    release: release(),
    arch: arch(),
    homeDir,
  };
  checks.push({
    id: 'platform',
    status: 'pass',
    message: `${osInfo.platform} (${osInfo.arch}, ${osInfo.release})`,
    details: osInfo,
  });

  // 2. Node.js >= 22.18 & node:sqlite
  const nodeSupported = isNodeVersionSupported(process.versions.node);
  let sqliteAvailable = false;
  let sqliteError = null;
  try {
    const mod = await import('node:sqlite');
    sqliteAvailable = typeof mod?.DatabaseSync === 'function';
  } catch (err) {
    sqliteError = err?.message || String(err);
  }
  checks.push({
    id: 'node',
    status: nodeSupported && sqliteAvailable ? 'pass' : 'fail',
    message:
      nodeSupported && sqliteAvailable
        ? `Node.js v${process.versions.node} with built-in node:sqlite`
        : !nodeSupported
          ? `Node.js v${process.versions.node} is older than required >= ${MIN_NODE.join('.')} (upgrade Node.js)`
          : `Node.js v${process.versions.node} is missing built-in node:sqlite (${sqliteError || 'unavailable'})`,
    details: {
      version: process.versions.node,
      execPath: process.execPath,
      minRequired: `${MIN_NODE.join('.')}.0`,
      meetsMinimum: nodeSupported,
      sqliteAvailable,
    },
  });

  // 3. Antigravity data dirs
  const candidateAppDirs = [];
  if (env.ANTIGRAVITY_APP_DATA_DIR) {
    candidateAppDirs.push({ path: env.ANTIGRAVITY_APP_DATA_DIR, source: 'env' });
  }
  for (const name of ['antigravity', 'antigravity-cli', 'antigravity-acp', 'antigravity-ide']) {
    candidateAppDirs.push({ path: join(homeDir, '.gemini', name), source: name });
  }
  const detectedAppDirs = [];
  const seenDirs = new Set();
  for (const cand of candidateAppDirs) {
    const abs = resolve(cand.path);
    if (seenDirs.has(abs)) continue;
    seenDirs.add(abs);
    if (existsSync(abs)) {
      detectedAppDirs.push({
        path: abs,
        source: cand.source,
        hasConversations: existsSync(join(abs, 'conversations')),
      });
    }
  }
  checks.push({
    id: 'antigravity_data',
    status: detectedAppDirs.length > 0 ? 'pass' : 'warn',
    message:
      detectedAppDirs.length > 0
        ? `Detected ${detectedAppDirs.length} Antigravity data director${detectedAppDirs.length === 1 ? 'y' : 'ies'}: ${detectedAppDirs.map((d) => d.path).join(', ')}`
        : `No Antigravity data directory found under ${join(homeDir, '.gemini')} (run Antigravity at least once)`,
    details: { detectedDirs: detectedAppDirs },
  });

  // 4. agy CLI detection
  const agyPath = findExecutableInPath('agy', env.PATH || '');
  let agyVersion = null;
  if (agyPath) {
    try {
      agyVersion = execFileSync(agyPath, ['--version'], {
        encoding: 'utf8',
        timeout: 2_500,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      /* ignore version probe failure */
    }
  }
  checks.push({
    id: 'agy_cli',
    status: agyPath ? 'pass' : 'warn',
    message: agyPath
      ? `Found agy CLI at ${agyPath}${agyVersion ? ` (${agyVersion})` : ''}`
      : 'agy CLI not found on PATH (optional for desktop app users)',
    details: { found: Boolean(agyPath), path: agyPath, version: agyVersion },
  });

  // 5. Plugin installation status & manifest
  const installed = pathExists(resolvedTarget);
  const isLinked = isSymlinkPath(resolvedTarget);
  let linkTarget = null;
  if (isLinked) {
    try {
      linkTarget = realpathSync(resolvedTarget);
    } catch {
      linkTarget = '<broken symlink>';
    }
  }
  const manifest = installed ? readPluginManifest(resolvedTarget) : null;
  const serverPath = join(resolvedTarget, 'sidecars', 'hud_panel', 'server.ts');
  const sidecarJsonPath = join(resolvedTarget, 'sidecars', 'hud_panel', 'sidecar.json');
  const hasBackend = existsSync(serverPath) && existsSync(sidecarJsonPath);

  checks.push({
    id: 'plugin_install',
    status: installed && manifest && hasBackend ? 'pass' : 'fail',
    message:
      installed && manifest && hasBackend
        ? `Installed v${manifest.version} at ${resolvedTarget}${isLinked ? ` (dev symlink -> ${linkTarget})` : ''}`
        : !installed
          ? `Plugin is not installed at ${resolvedTarget}`
          : `Plugin installation at ${resolvedTarget} is incomplete (missing plugin.json or sidecar files)`,
    details: {
      targetDir: resolvedTarget,
      installed,
      isLinked,
      linkTarget,
      version: manifest?.version || null,
      hasBackend,
    },
  });

  // 6. UI bundle presence
  const uiFiles = REQUIRED_UI_FILES.map((rel) => {
    const full = join(resolvedTarget, rel);
    let size = 0;
    let exists = false;
    try {
      const st = statSync(full);
      exists = st.isFile();
      size = st.size;
    } catch {
      /* missing */
    }
    return { file: rel, exists, size };
  });
  const uiComplete = uiFiles.every((f) => f.exists && f.size > 0);
  checks.push({
    id: 'ui_bundle',
    status: uiComplete ? 'pass' : 'fail',
    message: uiComplete
      ? `Pre-built UI bundle verified (${uiFiles.map((f) => `${basename(f.file)} ${(f.size / 1024).toFixed(1)}KB`).join(', ')})`
      : `UI bundle missing or empty: ${uiFiles.filter((f) => !f.exists || f.size === 0).map((f) => f.file).join(', ')}`,
    details: { files: uiFiles },
  });

  const ok = checks.every((c) => c.status !== 'fail');
  return {
    ok,
    plugin: PLUGIN_NAME,
    version: manifest?.version || null,
    targetDir: resolvedTarget,
    checks,
  };
}

// ---------------------------------------------------------------------------
// CLI argument parsing & output formatting
// ---------------------------------------------------------------------------

export function runConfigureStatusline({
  targetDir = getDefaultTargetDir(),
  settingsPath = '',
  twoLine = false,
  noColor = false,
  stackWithDefault = false,
} = {}) {
  const resolvedTarget = resolve(targetDir);
  const scriptPath = join(resolvedTarget, 'sidecars', 'hud_panel', 'statusline.ts');
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      action: 'missing_plugin',
      targetDir: resolvedTarget,
      message: `AGY-HUD statusline script not found at ${scriptPath}. Install AGY-HUD first with "node plugin/install.mjs".`,
    };
  }
  const args = [scriptPath, '--setup-statusline', '--json'];
  if (settingsPath) args.push('--settings', resolve(settingsPath));
  if (twoLine) args.push('--two-line');
  if (noColor) args.push('--no-color');
  if (stackWithDefault) args.push('--stack');

  try {
    const raw = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return JSON.parse(raw);
  } catch (err) {
    if (err?.stdout) {
      try {
        return JSON.parse(String(err.stdout));
      } catch {
        /* fall through */
      }
    }
    return {
      ok: false,
      action: 'error',
      targetDir: resolvedTarget,
      message: err?.message || String(err),
    };
  }
}

export function runRemoveStatusline({
  targetDir = getDefaultTargetDir(),
  sourceDir = defaultSourceDir,
  settingsPath = '',
  force = false,
} = {}) {
  const installedScript = join(resolve(targetDir), 'sidecars', 'hud_panel', 'statusline.ts');
  const fallbackScript = join(resolve(sourceDir), 'sidecars', 'hud_panel', 'statusline.ts');
  const scriptPath = existsSync(installedScript) ? installedScript : fallbackScript;
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      action: 'missing_plugin',
      message: `Could not locate statusline.ts in ${targetDir} or ${sourceDir}.`,
    };
  }
  const args = [scriptPath, '--remove-statusline', '--json'];
  if (settingsPath) args.push('--settings', resolve(settingsPath));
  if (force) args.push('--force');

  try {
    const raw = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return JSON.parse(raw);
  } catch (err) {
    if (err?.stdout) {
      try {
        return JSON.parse(String(err.stdout));
      } catch {
        /* fall through */
      }
    }
    return {
      ok: false,
      action: 'error',
      message: err?.message || String(err),
    };
  }
}

export function parseCliArgs(argv) {
  const opts = {
    command: 'install',
    explicitCommand: null,
    targetDir: null,
    sourceDir: null,
    settingsPath: null,
    versionTag: '',
    force: false,
    json: false,
    allowBuild: true,
    twoLine: false,
    noColor: false,
    stackWithDefault: false,
    help: false,
    showVersion: false,
    error: null,
  };

  const setCommand = (cmd) => {
    if (opts.explicitCommand && opts.explicitCommand !== cmd) {
      opts.error = `Conflicting commands: --${opts.explicitCommand} and --${cmd}`;
      return;
    }
    opts.explicitCommand = cmd;
    opts.command = cmd;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '-v' || arg === '--version') {
      opts.showVersion = true;
    } else if (arg === '--install') {
      setCommand('install');
    } else if (arg === '--link') {
      setCommand('link');
    } else if (arg === '--uninstall') {
      setCommand('uninstall');
    } else if (arg === '--check-update') {
      setCommand('check-update');
    } else if (arg === '--update') {
      setCommand('update');
    } else if (arg === '--doctor') {
      setCommand('doctor');
    } else if (arg === '--statusline') {
      setCommand('statusline');
    } else if (arg === '--uninstall-statusline') {
      setCommand('uninstall-statusline');
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--no-build') {
      opts.allowBuild = false;
    } else if (arg === '--two-line') {
      opts.twoLine = true;
    } else if (arg === '--no-color') {
      opts.noColor = true;
    } else if (arg === '--stack') {
      opts.stackWithDefault = true;
    } else if (arg === '--target') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        opts.error = 'Missing value for --target';
        break;
      }
      opts.targetDir = next;
    } else if (arg.startsWith('--target=')) {
      opts.targetDir = arg.slice('--target='.length);
      if (!opts.targetDir) {
        opts.error = 'Missing value for --target=';
        break;
      }
    } else if (arg === '--settings') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        opts.error = 'Missing value for --settings';
        break;
      }
      opts.settingsPath = next;
    } else if (arg.startsWith('--settings=')) {
      opts.settingsPath = arg.slice('--settings='.length);
      if (!opts.settingsPath) {
        opts.error = 'Missing value for --settings=';
        break;
      }
    } else if (arg === '--source') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        opts.error = 'Missing value for --source';
        break;
      }
      opts.sourceDir = next;
    } else if (arg.startsWith('--source=')) {
      opts.sourceDir = arg.slice('--source='.length);
    } else if (arg === '--ref' || arg === '--tag') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        opts.error = `Missing value for ${arg}`;
        break;
      }
      opts.versionTag = next;
    } else if (arg.startsWith('--ref=')) {
      opts.versionTag = arg.slice('--ref='.length);
    } else {
      opts.error = `Unknown option: ${arg}`;
      break;
    }
  }

  return opts;
}

const USAGE = `AGY-HUD Cross-Platform Plugin Installer & Updater

Usage:
  node plugin/install.mjs [command] [options]

Commands:
  --install               Atomic staged copy into ~/.gemini/config/plugins/agy-hud (default)
  --link                  Symlink/junction plugin folder for live development
  --uninstall             Remove the installed plugin cleanly
  --check-update          Check GitHub (${GITHUB_OWNER}/${GITHUB_REPO}) for newer releases
  --update                Download, verify, and atomically upgrade installed plugin
  --doctor                Run full environment & installation diagnostics
  --statusline            Configure Antigravity CLI /statusline in ~/.gemini/antigravity-cli/settings.json
  --uninstall-statusline  Remove AGY-HUD from Antigravity CLI settings.json

Options:
  --target <dir>          Custom plugin installation directory (for testing / enterprise)
  --settings <path>       Custom Antigravity CLI settings.json path (for --statusline)
  --two-line              Use 2-line rich layout when configuring --statusline
  --no-color              Disable ANSI colors when configuring --statusline
  --stack                 Stack below built-in status line when configuring --statusline
  --force                 Allow --update to replace a --link dev symlink, or force --uninstall-statusline
  --no-build              Do not auto-build web UI if pre-built bundle is missing
  --ref <tag>             Specific release tag to install during --update (e.g. v1.3.0)
  --json                  Output machine-readable JSON
  -v, --version           Print local plugin version
  -h, --help              Show this help message`;

function formatDoctorHuman(report) {
  const lines = [`AGY-HUD Doctor (${report.targetDir})`, ''];
  for (const c of report.checks) {
    const tag = c.status === 'pass' ? '[PASS]' : c.status === 'warn' ? '[WARN]' : '[FAIL]';
    lines.push(`  ${tag} ${c.id}: ${c.message}`);
  }
  lines.push('');
  lines.push(
    report.ok
      ? 'Overall: HEALTHY (ready for Antigravity)'
      : 'Overall: ISSUES DETECTED (resolve [FAIL] items above)',
  );
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseCliArgs(argv);

  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  if (opts.showVersion) {
    const manifest = readPluginManifest(opts.sourceDir || defaultSourceDir);
    console.log(manifest?.version || '0.0.0');
    return 0;
  }

  if (opts.error) {
    console.error(`Error: ${opts.error}\n`);
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }

  const targetDir = opts.targetDir ? resolve(opts.targetDir) : getDefaultTargetDir();
  const sourceDir = opts.sourceDir ? resolve(opts.sourceDir) : defaultSourceDir;

  if (opts.command === 'doctor') {
    const report = await runDoctor({ targetDir });
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatDoctorHuman(report));
    if (!report.ok) process.exitCode = 1;
    return report.ok ? 0 : 1;
  }

  if (opts.command === 'check-update') {
    const res = await runCheckUpdate({ targetDir, sourceDir });
    if (opts.json) console.log(JSON.stringify(res, null, 2));
    else console.log(res.message);
    if (!res.ok) process.exitCode = 1;
    return res.ok ? 0 : 1;
  }

  if (opts.command === 'update') {
    const res = await runUpdate({
      targetDir,
      force: opts.force,
      versionTag: opts.versionTag || process.env.AGY_HUD_VERSION || '',
    });
    if (opts.json) console.log(JSON.stringify(res, null, 2));
    else if (res.ok) console.log(res.message);
    else console.error(res.message);
    if (!res.ok) process.exitCode = 1;
    return res.ok ? 0 : 1;
  }

  if (opts.command === 'uninstall') {
    const res = runUninstall({ targetDir });
    if (opts.json) console.log(JSON.stringify(res, null, 2));
    else console.log(res.message);
    return 0;
  }

  if (opts.command === 'statusline') {
    const res = runConfigureStatusline({
      targetDir,
      settingsPath: opts.settingsPath || '',
      twoLine: opts.twoLine,
      noColor: opts.noColor,
      stackWithDefault: opts.stackWithDefault,
    });
    if (opts.json) console.log(JSON.stringify(res, null, 2));
    else if (res.ok) console.log(res.message);
    else console.error(res.message);
    if (!res.ok) process.exitCode = 1;
    return res.ok ? 0 : 1;
  }

  if (opts.command === 'uninstall-statusline') {
    const res = runRemoveStatusline({
      targetDir,
      sourceDir,
      settingsPath: opts.settingsPath || '',
      force: opts.force,
    });
    if (opts.json) console.log(JSON.stringify(res, null, 2));
    else if (res.ok) console.log(res.message);
    else console.error(res.message);
    if (!res.ok) process.exitCode = 1;
    return res.ok ? 0 : 1;
  }

  const res = runInstall({
    sourceDir,
    targetDir,
    link: opts.command === 'link',
    allowBuild: opts.allowBuild,
  });
  if (opts.json) console.log(JSON.stringify(res, null, 2));
  else if (res.ok) console.log(res.message);
  else console.error(res.message);
  if (!res.ok) process.exitCode = 1;
  return res.ok ? 0 : 1;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return process.argv[1] === __filename;
  }
}

if (isEntrypoint()) {
  main().catch((err) => {
    console.error(err?.message || String(err));
    process.exitCode = 1;
  });
}
