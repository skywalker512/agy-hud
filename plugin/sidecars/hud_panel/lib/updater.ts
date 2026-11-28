/**
 * AGY-HUD Plugin Self-Upgrade & Version Check Engine.
 *
 * Zero external runtime dependencies — uses only Node.js built-ins.
 * Shared SemVer, URL allowlist, verified download, safe archive extraction,
 * payload validation, and atomic swap primitives live in `./release-core.ts`.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAppDataDir } from './constants.ts';
import {
  assertSafeArchiveEntryPath,
  compareSemver,
  DOWNLOAD_TIMEOUT_MS,
  downloadVerifiedArchive,
  extractArchiveSafely,
  extractTarGzSafely,
  extractZipSafely,
  FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  GITHUB_OWNER,
  GITHUB_REPO,
  isAllowedApiUrl,
  isAllowedDownloadUrl,
  locatePluginPayloadDir,
  MAX_ARCHIVE_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_EXTRACTED_FILES,
  MAX_REDIRECT_HOPS,
  parseSemver,
  PLUGIN_NAME,
  readPluginManifest,
  renameWithRetry,
  SKIP_INSTALL_NAMES,
  swapDirectoryAtomically,
  validatePluginPayload,
  type FetchLike,
  type ParsedSemver,
  type PayloadValidationResult,
} from './release-core.ts';

export {
  assertSafeArchiveEntryPath,
  compareSemver,
  DOWNLOAD_TIMEOUT_MS,
  downloadVerifiedArchive,
  extractArchiveSafely,
  extractTarGzSafely,
  extractZipSafely,
  FETCH_TIMEOUT_MS,
  GITHUB_OWNER,
  GITHUB_REPO,
  isAllowedApiUrl,
  isAllowedDownloadUrl,
  locatePluginPayloadDir,
  MAX_ARCHIVE_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_EXTRACTED_FILES,
  MAX_REDIRECT_HOPS,
  parseSemver,
  PLUGIN_NAME,
  readPluginManifest,
  renameWithRetry,
  SKIP_INSTALL_NAMES,
  swapDirectoryAtomically,
  validatePluginPayload,
};
export type { FetchLike, ParsedSemver, PayloadValidationResult };

export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type UpdateCheckState =
  | 'up_to_date'
  | 'update_available'
  | 'ahead'
  | 'offline'
  | 'rate_limited'
  | 'error';

export type UpdateBlockReason =
  | 'dev_symlink'
  | 'in_progress'
  | 'no_update'
  | 'no_download_url'
  | null;

export interface UpdateStatus {
  ok: boolean;
  status: UpdateCheckState;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  canSelfUpdate: boolean;
  blockReason: UpdateBlockReason;
  isLinked: boolean;
  installPath: string;
  releaseUrl: string | null;
  downloadUrl: string | null;
  assetKind: 'tar.gz' | 'zip' | null;
  releaseNotes: string;
  publishedAt: string | null;
  checkedAtMs: number;
  cached: boolean;
  updating: boolean;
  error: string | null;
}

export interface ApplyUpdateResult {
  ok: boolean;
  previousVersion: string;
  newVersion: string | null;
  restartRequired: boolean;
  uiReloadOnly?: boolean;
  rolledBack?: boolean;
  reason?:
    | 'dev_symlink'
    | 'in_progress'
    | 'up_to_date'
    | 'check_failed'
    | 'no_download_url'
    | 'disallowed_url'
    | 'download_failed'
    | 'extract_failed'
    | 'invalid_payload'
    | 'swap_failed';
  message: string;
}

export interface InstallInspection {
  pluginDir: string;
  realPluginDir: string;
  version: string;
  isLinked: boolean;
  linkTarget: string | null;
}

export interface UpdaterOptions {
  pluginDir?: string;
  defaultPluginDir?: string;
  appDataDir?: string;
  cachePath?: string;
  owner?: string;
  repo?: string;
  force?: boolean;
  nowMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  /** Internal test hook invoked right before swapping stagedDir into targetDir. */
  beforeSwapHook?: (ctx: { targetDir: string; stagedDir: string; backupDir: string }) => void;
}

interface CachedReleaseInfo {
  checkedAtMs: number;
  latestVersion: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  assetKind: 'tar.gz' | 'zip' | null;
  releaseNotes: string;
  publishedAt: string | null;
  source: 'release' | 'tag' | 'manifest';
}

interface ResolvedRelease {
  latestVersion: string;
  releaseUrl: string;
  downloadUrl: string;
  assetKind: 'tar.gz' | 'zip';
  releaseNotes: string;
  publishedAt: string | null;
  source: 'release' | 'tag' | 'manifest';
}

// Module-level memory cache (keyed by cachePath) and in-flight lock.
const memCache = new Map<string, CachedReleaseInfo>();
let updateInFlight = false;

export function isUpdateInProgress(): boolean {
  return updateInFlight;
}

export function resetUpdaterStateForTests(): void {
  memCache.clear();
  updateInFlight = false;
}

// ---------------------------------------------------------------------------
// Plugin path & install inspection
// ---------------------------------------------------------------------------

export function resolveDefaultPluginDir(): string {
  return join(homedir(), '.gemini', 'config', 'plugins', PLUGIN_NAME);
}

export function resolvePluginRoot(): string {
  // plugin/sidecars/hud_panel/lib/updater.ts -> ../../../ -> plugin/
  return resolve(__dirname, '..', '..', '..');
}

export function resolveUpdateCachePath(appDataDir = resolveAppDataDir()): string {
  const envCache = process.env.AGY_HUD_UPDATE_CACHE_PATH;
  if (envCache) return envCache;
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) return join(execData, 'update-cache.json');
  return join(appDataDir, 'sidecar_data', PLUGIN_NAME, 'hud_panel', 'data', 'update-cache.json');
}

export function inspectInstallState(
  options: { pluginDir?: string; defaultPluginDir?: string } = {},
): InstallInspection {
  const pluginDir = options.pluginDir ? resolve(options.pluginDir) : resolvePluginRoot();
  const defaultPluginDir = options.defaultPluginDir
    ? resolve(options.defaultPluginDir)
    : resolveDefaultPluginDir();

  let realPluginDir = pluginDir;
  try {
    realPluginDir = realpathSync(pluginDir);
  } catch {
    /* keep raw path */
  }

  let isLinked = false;
  let linkTarget: string | null = null;

  try {
    const st = lstatSync(pluginDir);
    if (st.isSymbolicLink()) {
      isLinked = true;
      linkTarget = realPluginDir;
    }
  } catch {
    /* not present */
  }

  // If Node resolved symlinks in import.meta.url, also check whether the canonical
  // Antigravity plugin path is a symlink pointing to our realPluginDir.
  if (!isLinked && !options.pluginDir) {
    try {
      const defStat = lstatSync(defaultPluginDir);
      if (defStat.isSymbolicLink()) {
        const defReal = realpathSync(defaultPluginDir);
        if (defReal === realPluginDir) {
          isLinked = true;
          linkTarget = defReal;
        }
      }
    } catch {
      /* default path does not exist */
    }
    if (!isLinked && existsSync(join(dirname(realPluginDir), '.git'))) {
      isLinked = true;
      linkTarget = realPluginDir;
    }
  }

  const manifest = readPluginManifest(realPluginDir);
  return {
    pluginDir,
    realPluginDir,
    version: manifest?.version || '0.0.0',
    isLinked,
    linkTarget,
  };
}

// ---------------------------------------------------------------------------
// Cache helpers (6h disk + memory)
// ---------------------------------------------------------------------------

function loadDiskCache(cachePath: string): CachedReleaseInfo | null {
  if (!cachePath || !existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.checkedAtMs !== 'number') {
      return null;
    }
    return {
      checkedAtMs: parsed.checkedAtMs,
      latestVersion: typeof parsed.latestVersion === 'string' ? parsed.latestVersion : null,
      releaseUrl: typeof parsed.releaseUrl === 'string' ? parsed.releaseUrl : null,
      downloadUrl: typeof parsed.downloadUrl === 'string' ? parsed.downloadUrl : null,
      assetKind: parsed.assetKind === 'tar.gz' || parsed.assetKind === 'zip' ? parsed.assetKind : null,
      releaseNotes: typeof parsed.releaseNotes === 'string' ? parsed.releaseNotes : '',
      publishedAt: typeof parsed.publishedAt === 'string' ? parsed.publishedAt : null,
      source: parsed.source === 'tag' || parsed.source === 'manifest' ? parsed.source : 'release',
    };
  } catch {
    return null;
  }
}

function saveDiskCache(cachePath: string, entry: CachedReleaseInfo): void {
  if (!cachePath) return;
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf8');
    renameSync(tmp, cachePath);
  } catch {
    /* non-fatal cache write failure */
  }
}

function clearCache(cachePath: string): void {
  memCache.delete(cachePath);
  try {
    if (cachePath && existsSync(cachePath)) {
      rmSync(cachePath, { force: true });
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// GitHub Releases / Tags / Manifest fetcher
// ---------------------------------------------------------------------------

function pickReleaseAsset(
  release: any,
  owner: string,
  repo: string,
): { downloadUrl: string; assetKind: 'tar.gz' | 'zip' } | null {
  const assets = Array.isArray(release?.assets) ? release.assets : [];

  const tarAsset = assets.find(
    (a: any) =>
      typeof a?.name === 'string' &&
      typeof a?.browser_download_url === 'string' &&
      /\.(tar\.gz|tgz)$/i.test(a.name) &&
      isAllowedDownloadUrl(a.browser_download_url, { owner, repo }),
  );
  if (tarAsset) {
    return { downloadUrl: tarAsset.browser_download_url, assetKind: 'tar.gz' };
  }

  const zipAsset = assets.find(
    (a: any) =>
      typeof a?.name === 'string' &&
      typeof a?.browser_download_url === 'string' &&
      /\.zip$/i.test(a.name) &&
      isAllowedDownloadUrl(a.browser_download_url, { owner, repo }),
  );
  if (zipAsset) {
    return { downloadUrl: zipAsset.browser_download_url, assetKind: 'zip' };
  }

  if (
    typeof release?.tarball_url === 'string' &&
    isAllowedDownloadUrl(release.tarball_url, { owner, repo })
  ) {
    return { downloadUrl: release.tarball_url, assetKind: 'tar.gz' };
  }

  if (typeof release?.tag_name === 'string' && release.tag_name.trim()) {
    const tag = encodeURIComponent(release.tag_name.trim());
    const archiveUrl = `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.tar.gz`;
    if (isAllowedDownloadUrl(archiveUrl, { owner, repo })) {
      return { downloadUrl: archiveUrl, assetKind: 'tar.gz' };
    }
  }

  return null;
}

class GitHubFetchError extends Error {
  code: 'rate_limited' | 'offline' | 'error';
  constructor(code: 'rate_limited' | 'offline' | 'error', message: string) {
    super(message);
    this.code = code;
  }
}

async function fetchLatestFromGitHub(params: {
  owner: string;
  repo: string;
  currentVersion: string;
  fetchImpl: FetchLike;
}): Promise<ResolvedRelease> {
  const { owner, repo, currentVersion, fetchImpl } = params;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `${PLUGIN_NAME}/${currentVersion}`,
  };

  const latestUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  if (!isAllowedApiUrl(latestUrl, { owner, repo })) {
    throw new GitHubFetchError('error', 'Disallowed GitHub API URL');
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(fetchImpl, latestUrl, { headers }, FETCH_TIMEOUT_MS);
  } catch (err: any) {
    throw new GitHubFetchError('offline', err?.message || 'Network request failed');
  }

  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers?.get?.('x-ratelimit-remaining');
    if (res.status === 429 || remaining === '0') {
      throw new GitHubFetchError('rate_limited', 'GitHub API rate limit exceeded');
    }
  }

  if (res.ok) {
    const release: any = await res.json();
    const rawTag = String(release?.tag_name || release?.name || '').trim();
    const parsed = parseSemver(rawTag);
    if (!parsed) {
      throw new GitHubFetchError('error', `Invalid release version tag: ${rawTag}`);
    }
    const latestVersion = rawTag.replace(/^[vV]/, '');
    const picked = pickReleaseAsset(release, owner, repo);
    if (!picked) {
      throw new GitHubFetchError('error', 'No verified download archive found in GitHub release');
    }
    const rawBody = typeof release?.body === 'string' ? release.body.trim() : '';
    return {
      latestVersion,
      releaseUrl:
        typeof release?.html_url === 'string' && release.html_url.startsWith(`https://github.com/${owner}/${repo}/`)
          ? release.html_url
          : `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(rawTag)}`,
      downloadUrl: picked.downloadUrl,
      assetKind: picked.assetKind,
      releaseNotes: rawBody.length > 4000 ? `${rawBody.slice(0, 4000)}…` : rawBody,
      publishedAt: typeof release?.published_at === 'string' ? release.published_at : null,
      source: 'release',
    };
  }

  // Fallback 1: If no GitHub Release exists yet (404), inspect tags.
  if (res.status === 404) {
    const tagsUrl = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=15`;
    let tagsRes: Response;
    try {
      tagsRes = await fetchWithTimeout(fetchImpl, tagsUrl, { headers }, FETCH_TIMEOUT_MS);
    } catch (err: any) {
      throw new GitHubFetchError('offline', err?.message || 'Network request failed');
    }
    if (tagsRes.status === 403 || tagsRes.status === 429) {
      throw new GitHubFetchError('rate_limited', 'GitHub API rate limit exceeded');
    }
    if (tagsRes.ok) {
      const tags: any = await tagsRes.json();
      if (Array.isArray(tags) && tags.length > 0) {
        let bestTag: string | null = null;
        for (const t of tags) {
          const name = typeof t?.name === 'string' ? t.name.trim() : '';
          if (!parseSemver(name)) continue;
          if (!bestTag || compareSemver(name, bestTag) > 0) {
            bestTag = name;
          }
        }
        if (bestTag) {
          const latestVersion = bestTag.replace(/^[vV]/, '');
          const encTag = encodeURIComponent(bestTag);
          return {
            latestVersion,
            releaseUrl: `https://github.com/${owner}/${repo}/releases/tag/${encTag}`,
            downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/tags/${encTag}.tar.gz`,
            assetKind: 'tar.gz',
            releaseNotes: '',
            publishedAt: null,
            source: 'tag',
          };
        }
      }
    }

    // Fallback 2: Check main branch plugin/plugin.json manifest.
    const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/plugin/plugin.json`;
    if (isAllowedApiUrl(manifestUrl, { owner, repo })) {
      let manRes: Response;
      try {
        manRes = await fetchWithTimeout(
          fetchImpl,
          manifestUrl,
          { headers: { 'User-Agent': `${PLUGIN_NAME}/${currentVersion}` } },
          FETCH_TIMEOUT_MS,
        );
      } catch (err: any) {
        throw new GitHubFetchError('offline', err?.message || 'Network request failed');
      }
      if (manRes.ok) {
        const manifest: any = await manRes.json();
        const rawVer = typeof manifest?.version === 'string' ? manifest.version.trim() : '';
        if (parseSemver(rawVer)) {
          return {
            latestVersion: rawVer.replace(/^[vV]/, ''),
            releaseUrl: `https://github.com/${owner}/${repo}`,
            downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/main.tar.gz`,
            assetKind: 'tar.gz',
            releaseNotes: '',
            publishedAt: null,
            source: 'manifest',
          };
        }
      }
    }
  }

  throw new GitHubFetchError('error', `GitHub release lookup failed (HTTP ${res.status})`);
}

function buildUpdateStatus(params: {
  inspect: InstallInspection;
  entry: CachedReleaseInfo | null;
  cached: boolean;
  checkedAtMs: number;
  errorCode?: 'offline' | 'rate_limited' | 'error';
  errorMessage?: string | null;
}): UpdateStatus {
  const { inspect, entry, cached, checkedAtMs, errorCode, errorMessage } = params;
  const currentVersion = inspect.version;
  const latestVersion = entry?.latestVersion ?? null;
  const downloadUrl = entry?.downloadUrl ?? null;

  let status: UpdateCheckState;
  let updateAvailable = false;

  if (errorCode) {
    status = errorCode;
    if (latestVersion && compareSemver(latestVersion, currentVersion) > 0) {
      updateAvailable = true;
    }
  } else if (!latestVersion) {
    status = 'error';
  } else {
    const cmp = compareSemver(latestVersion, currentVersion);
    if (cmp > 0) {
      status = 'update_available';
      updateAvailable = true;
    } else if (cmp < 0) {
      status = 'ahead';
    } else {
      status = 'up_to_date';
    }
  }

  let blockReason: UpdateBlockReason = null;
  if (inspect.isLinked) {
    blockReason = 'dev_symlink';
  } else if (updateInFlight) {
    blockReason = 'in_progress';
  } else if (!updateAvailable) {
    blockReason = 'no_update';
  } else if (!downloadUrl) {
    blockReason = 'no_download_url';
  }

  const canSelfUpdate = updateAvailable && blockReason === null;

  return {
    ok: !errorCode,
    status,
    currentVersion,
    latestVersion,
    updateAvailable,
    canSelfUpdate,
    blockReason,
    isLinked: inspect.isLinked,
    installPath: inspect.pluginDir,
    releaseUrl: entry?.releaseUrl ?? null,
    downloadUrl,
    assetKind: entry?.assetKind ?? null,
    releaseNotes: entry?.releaseNotes ?? '',
    publishedAt: entry?.publishedAt ?? null,
    checkedAtMs,
    cached,
    updating: updateInFlight,
    error: errorMessage ?? null,
  };
}

export async function checkForUpdates(options: UpdaterOptions = {}): Promise<UpdateStatus> {
  const owner = options.owner || GITHUB_OWNER;
  const repo = options.repo || GITHUB_REPO;
  const nowMs = options.nowMs ?? Date.now();
  const cacheTtlMs = options.cacheTtlMs ?? UPDATE_CACHE_TTL_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const inspect = inspectInstallState({
    pluginDir: options.pluginDir,
    defaultPluginDir: options.defaultPluginDir,
  });

  const cachePath =
    options.cachePath !== undefined
      ? options.cachePath
      : resolveUpdateCachePath(options.appDataDir);

  const memEntry = cachePath ? memCache.get(cachePath) ?? null : null;
  const diskEntry = !memEntry && cachePath ? loadDiskCache(cachePath) : null;
  const existing = memEntry ?? diskEntry;

  if (!options.force && existing && nowMs - existing.checkedAtMs < cacheTtlMs) {
    if (cachePath && !memEntry) memCache.set(cachePath, existing);
    return buildUpdateStatus({
      inspect,
      entry: existing,
      cached: true,
      checkedAtMs: existing.checkedAtMs,
    });
  }

  try {
    const resolved = await fetchLatestFromGitHub({
      owner,
      repo,
      currentVersion: inspect.version,
      fetchImpl,
    });
    const fresh: CachedReleaseInfo = {
      checkedAtMs: nowMs,
      latestVersion: resolved.latestVersion,
      releaseUrl: resolved.releaseUrl,
      downloadUrl: resolved.downloadUrl,
      assetKind: resolved.assetKind,
      releaseNotes: resolved.releaseNotes,
      publishedAt: resolved.publishedAt,
      source: resolved.source,
    };
    if (cachePath) {
      memCache.set(cachePath, fresh);
      saveDiskCache(cachePath, fresh);
    }
    return buildUpdateStatus({
      inspect,
      entry: fresh,
      cached: false,
      checkedAtMs: nowMs,
    });
  } catch (err: any) {
    const code = err instanceof GitHubFetchError ? err.code : 'error';
    return buildUpdateStatus({
      inspect,
      entry: existing,
      cached: Boolean(existing),
      checkedAtMs: existing?.checkedAtMs ?? nowMs,
      errorCode: code,
      errorMessage: err?.message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Backend change detection & self-update orchestrator
// ---------------------------------------------------------------------------

function collectBackendLibFiles(dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectBackendLibFiles(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
}

function hashBackendFiles(pluginDir: string): string {
  const hash = createHash('sha256');
  const sidecarDir = join(pluginDir, 'sidecars', 'hud_panel');
  const targets = [
    join(sidecarDir, 'sidecar.json'),
    join(sidecarDir, 'server.ts'),
    join(sidecarDir, 'statusline.ts'),
    join(sidecarDir, 'pricing.json'),
  ];
  const libDir = join(sidecarDir, 'lib');
  if (existsSync(libDir)) {
    collectBackendLibFiles(libDir, targets);
  }
  for (const file of targets) {
    hash.update(file.slice(pluginDir.length));
    hash.update('\0');
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update('<missing>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function applySelfUpdate(options: UpdaterOptions = {}): Promise<ApplyUpdateResult> {
  const inspect = inspectInstallState({
    pluginDir: options.pluginDir,
    defaultPluginDir: options.defaultPluginDir,
  });

  if (inspect.isLinked) {
    return {
      ok: false,
      previousVersion: inspect.version,
      newVersion: null,
      restartRequired: false,
      reason: 'dev_symlink',
      message:
        'Self-update is disabled in dev symlink (--link) mode. Pull changes with git instead.',
    };
  }

  if (updateInFlight) {
    return {
      ok: false,
      previousVersion: inspect.version,
      newVersion: null,
      restartRequired: false,
      reason: 'in_progress',
      message: 'A plugin update is already in progress.',
    };
  }

  updateInFlight = true;
  const owner = options.owner || GITHUB_OWNER;
  const repo = options.repo || GITHUB_REPO;
  const cachePath =
    options.cachePath !== undefined
      ? options.cachePath
      : resolveUpdateCachePath(options.appDataDir);

  let extractRoot: string | null = null;

  try {
    const status = await checkForUpdates({ ...options, force: true });
    if (!status.ok && !status.downloadUrl) {
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: status.latestVersion,
        restartRequired: false,
        reason: 'check_failed',
        message: status.error || 'Failed to check for updates.',
      };
    }

    if (!status.updateAvailable && !options.force) {
      return {
        ok: true,
        previousVersion: inspect.version,
        newVersion: inspect.version,
        restartRequired: false,
        reason: 'up_to_date',
        message: `AGY-HUD ${inspect.version} is already up to date.`,
      };
    }

    if (!status.downloadUrl) {
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: status.latestVersion,
        restartRequired: false,
        reason: 'no_download_url',
        message: 'No downloadable release archive found.',
      };
    }

    if (!isAllowedDownloadUrl(status.downloadUrl, { owner, repo })) {
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: status.latestVersion,
        restartRequired: false,
        reason: 'disallowed_url',
        message: `Refused untrusted download URL: ${status.downloadUrl}`,
      };
    }

    let downloaded: { buffer: Buffer; finalUrl: string; contentType: string };
    try {
      downloaded = await downloadVerifiedArchive(status.downloadUrl, {
        owner,
        repo,
        userAgent: `${PLUGIN_NAME}/${inspect.version}`,
        fetchImpl: options.fetchImpl,
      });
    } catch (err: any) {
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: status.latestVersion,
        restartRequired: false,
        reason: 'download_failed',
        message: err?.message || 'Failed to download update archive.',
      };
    }

    const parent = dirname(inspect.pluginDir);
    mkdirSync(parent, { recursive: true });
    extractRoot = mkdtempSync(join(parent, `.${PLUGIN_NAME}-extract-`));

    try {
      extractArchiveSafely(downloaded.buffer, extractRoot, status.assetKind);
    } catch (err: any) {
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: status.latestVersion,
        restartRequired: false,
        reason: 'extract_failed',
        message: err?.message || 'Failed to safely extract update archive.',
      };
    }

    const payloadDir = locatePluginPayloadDir(extractRoot);
    if (!payloadDir) {
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: status.latestVersion,
        restartRequired: false,
        reason: 'invalid_payload',
        message: 'Archive does not contain a valid AGY-HUD plugin directory.',
      };
    }

    const validation = validatePluginPayload(payloadDir);
    if (!validation.valid || !validation.version) {
      const detail = [...validation.missing.map((m) => `missing ${m}`), ...validation.errors].join('; ');
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: status.latestVersion,
        restartRequired: false,
        reason: 'invalid_payload',
        message: `Update package failed verification: ${detail}`,
      };
    }

    const prevBackendHash = hashBackendFiles(inspect.pluginDir);
    const nextBackendHash = hashBackendFiles(payloadDir);
    const restartRequired = prevBackendHash !== nextBackendHash;

    const swap = swapDirectoryAtomically({
      sourcePayloadDir: payloadDir,
      targetDir: inspect.pluginDir,
      beforeSwapHook: options.beforeSwapHook,
    });

    if (!swap.swapped) {
      return {
        ok: false,
        previousVersion: inspect.version,
        newVersion: validation.version,
        restartRequired: false,
        rolledBack: swap.rolledBack,
        reason: 'swap_failed',
        message: swap.rolledBack
          ? `Install swap failed (${swap.error}); automatically rolled back to ${inspect.version}.`
          : `Install swap failed (${swap.error}).`,
      };
    }

    // Clear stale update cache so next GET /api/update-status reflects new version immediately.
    clearCache(cachePath);

    return {
      ok: true,
      previousVersion: inspect.version,
      newVersion: validation.version,
      restartRequired,
      uiReloadOnly: !restartRequired,
      message: restartRequired
        ? `Updated AGY-HUD from ${inspect.version} to ${validation.version}. Sidecar restart required to load new backend.`
        : `Updated AGY-HUD from ${inspect.version} to ${validation.version}. UI assets will hot-reload automatically.`,
    };
  } finally {
    updateInFlight = false;
    if (extractRoot) {
      try {
        rmSync(extractRoot, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
