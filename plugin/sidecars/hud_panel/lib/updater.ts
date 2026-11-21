/**
 * AGY-HUD Plugin Self-Upgrade & Version Check Engine.
 *
 * Zero external runtime dependencies — uses only Node.js built-ins.
 * Provides:
 * - Pure SemVer 2.0.0 parsing & comparison (including prereleases)
 * - GitHub Releases version check (with tags/manifest fallback & 6h disk+memory cache)
 * - Strict GitHub URL allowlist (including manual redirect verification)
 * - Pure Node.js .tar.gz and .zip extraction with zip-slip & symlink-escape protection
 * - Atomic staged directory swap with automatic backup & rollback on failure
 * - Dev symlink (`--link`) protection & in-flight concurrency lock
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
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
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

import { resolveAppDataDir } from './constants.ts';

export const GITHUB_OWNER = 'skywalker512';
export const GITHUB_REPO = 'agy-hud';
export const PLUGIN_NAME = 'agy-hud';
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const FETCH_TIMEOUT_MS = 10_000;
export const DOWNLOAD_TIMEOUT_MS = 45_000;
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024; // 64 MB
export const MAX_EXTRACTED_FILES = 2_000;
export const MAX_REDIRECT_HOPS = 5;

export const SKIP_INSTALL_NAMES = new Set([
  'install.mjs',
  'test',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  'tsconfig.json',
]);

const REDIRECT_CDN_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: (number | string)[];
  build: string[];
  raw: string;
}

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

export interface PayloadValidationResult {
  valid: boolean;
  version: string | null;
  missing: string[];
  errors: string[];
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
// SemVer 2.0.0 parsing & comparison
// ---------------------------------------------------------------------------

const SEMVER_RE =
  /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const NUMERIC_ID_RE = /^(?:0|[1-9]\d*)$/;

export function parseSemver(raw: string): ParsedSemver | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = SEMVER_RE.exec(trimmed);
  if (!match) return null;

  const [, majStr, minStr, patStr, preStr, buildStr] = match;
  if (
    (majStr.length > 1 && majStr.startsWith('0')) ||
    (minStr.length > 1 && minStr.startsWith('0')) ||
    (patStr.length > 1 && patStr.startsWith('0'))
  ) {
    return null;
  }

  const major = Number(majStr);
  const minor = Number(minStr);
  const patch = Number(patStr);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }

  const prerelease: (number | string)[] = [];
  if (preStr !== undefined) {
    const parts = preStr.split('.');
    for (const part of parts) {
      if (!part) return null;
      if (/^\d+$/.test(part)) {
        if (!NUMERIC_ID_RE.test(part)) return null;
        prerelease.push(Number(part));
      } else {
        prerelease.push(part);
      }
    }
  }

  const build: string[] = [];
  if (buildStr !== undefined) {
    const parts = buildStr.split('.');
    for (const part of parts) {
      if (!part) return null;
      build.push(part);
    }
  }

  return { major, minor, patch, prerelease, build, raw: trimmed };
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  const aHasPre = pa.prerelease.length > 0;
  const bHasPre = pb.prerelease.length > 0;
  if (!aHasPre && !bHasPre) return 0;
  if (!aHasPre && bHasPre) return 1; // 1.2.0 > 1.2.0-rc.1
  if (aHasPre && !bHasPre) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;

    const aNum = typeof ai === 'number';
    const bNum = typeof bi === 'number';
    if (aNum && bNum) return ai < bi ? -1 : 1;
    if (aNum && !bNum) return -1; // numeric < non-numeric per SemVer 2.0.0
    if (!aNum && bNum) return 1;
    return String(ai) < String(bi) ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Strict GitHub URL allowlist
// ---------------------------------------------------------------------------

function hasPathTraversal(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return true;
  return decoded.split('/').some((seg) => seg === '..');
}

export function isAllowedDownloadUrl(
  rawUrl: string,
  options: { isRedirectHop?: boolean; owner?: string; repo?: string } = {},
): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  if (hasPathTraversal(parsed.pathname)) return false;

  const owner = (options.owner || GITHUB_OWNER).toLowerCase();
  const repo = (options.repo || GITHUB_REPO).toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const pathLower = parsed.pathname.toLowerCase();

  if (host === 'github.com' || host === 'codeload.github.com') {
    return pathLower.startsWith(`/${owner}/${repo}/`);
  }
  if (host === 'api.github.com') {
    return pathLower.startsWith(`/repos/${owner}/${repo}/`);
  }
  if (options.isRedirectHop && REDIRECT_CDN_HOSTS.has(host)) {
    return parsed.pathname.length > 1;
  }
  return false;
}

export function isAllowedApiUrl(
  rawUrl: string,
  options: { owner?: string; repo?: string } = {},
): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  if (hasPathTraversal(parsed.pathname)) return false;

  const owner = (options.owner || GITHUB_OWNER).toLowerCase();
  const repo = (options.repo || GITHUB_REPO).toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const pathLower = parsed.pathname.toLowerCase();

  if (host === 'api.github.com') {
    return pathLower.startsWith(`/repos/${owner}/${repo}/`);
  }
  if (host === 'raw.githubusercontent.com') {
    return pathLower.startsWith(`/${owner}/${repo}/`);
  }
  return false;
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

export function readPluginManifest(pluginDir: string): {
  name: string;
  version: string;
  displayName?: string;
} | null {
  try {
    const raw = readFileSync(join(pluginDir, 'plugin.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'string' || !parsed.version.trim()) return null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      version: parsed.version.trim(),
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
    };
  } catch {
    return null;
  }
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

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickReleaseAsset(
  release: any,
  owner: string,
  repo: string,
): { downloadUrl: string; assetKind: 'tar.gz' | 'zip' } | null {
  const assets = Array.isArray(release?.assets) ? release.assets : [];

  // Prefer prebuilt tar.gz / tgz release assets first, then zip assets.
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
// Safe archive download (strict allowlist + manual redirect verification)
// ---------------------------------------------------------------------------

export async function downloadVerifiedArchive(
  initialUrl: string,
  options: {
    owner?: string;
    repo?: string;
    userAgent?: string;
    fetchImpl?: FetchLike;
    maxBytes?: number;
  } = {},
): Promise<{ buffer: Buffer; finalUrl: string; contentType: string }> {
  const owner = options.owner || GITHUB_OWNER;
  const repo = options.repo || GITHUB_REPO;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES;

  if (!isAllowedDownloadUrl(initialUrl, { isRedirectHop: false, owner, repo })) {
    throw new Error(`Refused to download from disallowed URL: ${initialUrl}`);
  }

  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const res = await fetchWithTimeout(
      fetchImpl,
      currentUrl,
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': options.userAgent || `${PLUGIN_NAME}/updater`,
          Accept: 'application/octet-stream, application/gzip, application/zip, */*',
        },
      },
      DOWNLOAD_TIMEOUT_MS,
    );

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.get?.('location');
      if (!location) {
        throw new Error(`Redirect response (${res.status}) missing Location header`);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isAllowedDownloadUrl(nextUrl, { isRedirectHop: true, owner, repo })) {
        throw new Error(`Refused redirect to disallowed URL: ${nextUrl}`);
      }
      currentUrl = nextUrl;
      continue;
    }

    if (!res.ok) {
      throw new Error(`Archive download failed with HTTP ${res.status}`);
    }

    const declaredLen = Number(res.headers?.get?.('content-length') || 0);
    if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
      throw new Error(`Archive exceeds maximum allowed size (${declaredLen} > ${maxBytes} bytes)`);
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength === 0) {
      throw new Error('Downloaded archive is empty');
    }
    if (arrayBuf.byteLength > maxBytes) {
      throw new Error(`Archive exceeds maximum allowed size (${arrayBuf.byteLength} > ${maxBytes} bytes)`);
    }

    return {
      buffer: Buffer.from(arrayBuf),
      finalUrl: currentUrl,
      contentType: res.headers?.get?.('content-type') || '',
    };
  }

  throw new Error(`Exceeded maximum redirect hops (${MAX_REDIRECT_HOPS})`);
}

// ---------------------------------------------------------------------------
// Zip-slip / path-traversal safe archive extraction (pure Node.js)
// ---------------------------------------------------------------------------

export function assertSafeArchiveEntryPath(rawEntryPath: string, destRoot: string): string {
  if (typeof rawEntryPath !== 'string' || !rawEntryPath) {
    throw new Error('Archive entry has an empty path');
  }
  if (rawEntryPath.includes('\0')) {
    throw new Error(`Archive entry contains null byte: ${JSON.stringify(rawEntryPath)}`);
  }

  const normalized = rawEntryPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Archive entry uses absolute path: ${rawEntryPath}`);
  }

  const segments = normalized.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) {
    throw new Error(`Archive entry attempts path traversal: ${rawEntryPath}`);
  }

  const resolvedRoot = resolve(destRoot);
  if (segments.length === 0) {
    return resolvedRoot;
  }

  const fullPath = resolve(resolvedRoot, ...segments);
  if (fullPath !== resolvedRoot && !fullPath.startsWith(resolvedRoot + sep)) {
    throw new Error(`Archive entry escapes destination directory: ${rawEntryPath}`);
  }
  return fullPath;
}

function readTarString(buf: Buffer, offset: number, length: number): string {
  let end = offset;
  const max = Math.min(buf.length, offset + length);
  while (end < max && buf[end] !== 0) end++;
  return buf.subarray(offset, end).toString('utf8');
}

function readTarOctal(buf: Buffer, offset: number, length: number): number {
  const raw = readTarString(buf, offset, length).trim();
  if (!raw) return 0;
  // GNU base-256 extension
  if ((buf[offset] & 0x80) !== 0) {
    let val = 0;
    for (let i = 1; i < length; i++) {
      val = val * 256 + buf[offset + i];
    }
    return val;
  }
  const parsed = parseInt(raw, 8);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePaxRecords(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const text = data.toString('utf8');
  let pos = 0;
  while (pos < text.length) {
    const spaceIdx = text.indexOf(' ', pos);
    if (spaceIdx === -1) break;
    const len = parseInt(text.slice(pos, spaceIdx), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(spaceIdx + 1, pos + len);
    const eqIdx = record.indexOf('=');
    if (eqIdx !== -1) {
      const key = record.slice(0, eqIdx);
      const value = record.slice(eqIdx + 1).replace(/\n$/, '');
      out[key] = value;
    }
    pos += len;
  }
  return out;
}

export function extractTarGzSafely(
  gzBuffer: Buffer,
  destDir: string,
  limits: { maxBytes?: number; maxFiles?: number } = {},
): { fileCount: number; totalBytes: number } {
  const maxBytes = limits.maxBytes ?? MAX_EXTRACTED_BYTES;
  const maxFiles = limits.maxFiles ?? MAX_EXTRACTED_FILES;
  const tarBuf = gunzipSync(gzBuffer, { maxOutputLength: maxBytes });

  const resolvedDest = resolve(destDir);
  mkdirSync(resolvedDest, { recursive: true });

  let offset = 0;
  let fileCount = 0;
  let totalBytes = 0;
  let nextPaxPath: string | null = null;
  let nextGnuLongName: string | null = null;

  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    // Check 512-byte zero block (tar EOF marker)
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const rawName = readTarString(header, 0, 100);
    const size = readTarOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156]);
    const prefix = readTarString(header, 345, 155);

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tarBuf.length) {
      throw new Error('Truncated tar archive entry');
    }
    const dataSlice = tarBuf.subarray(dataStart, dataEnd);
    const paddedSize = Math.ceil(size / 512) * 512;
    offset = dataStart + paddedSize;

    // PAX global header ('g') — metadata only
    if (typeFlag === 'g') {
      continue;
    }
    // PAX per-file extended header ('x')
    if (typeFlag === 'x') {
      const pax = parsePaxRecords(dataSlice);
      if (pax.path) nextPaxPath = pax.path;
      continue;
    }
    // GNU LongName ('L')
    if (typeFlag === 'L') {
      nextGnuLongName = dataSlice.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    const entryPath = nextPaxPath ?? nextGnuLongName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    nextPaxPath = null;
    nextGnuLongName = null;

    // Block symlinks, hardlinks, and device nodes to prevent symlink escape attacks
    if (typeFlag === '1' || typeFlag === '2' || typeFlag === '3' || typeFlag === '4' || typeFlag === '6') {
      throw new Error(`Archive contains disallowed link or special file (${typeFlag}): ${entryPath}`);
    }

    const fullPath = assertSafeArchiveEntryPath(entryPath, resolvedDest);

    if (typeFlag === '5' || entryPath.endsWith('/')) {
      mkdirSync(fullPath, { recursive: true });
      continue;
    }

    // Regular file ('0' or '\0')
    if (typeFlag === '0' || typeFlag === '\0') {
      fileCount += 1;
      totalBytes += size;
      if (fileCount > maxFiles) {
        throw new Error(`Archive exceeds maximum file count (${maxFiles})`);
      }
      if (totalBytes > maxBytes) {
        throw new Error(`Archive exceeds maximum extracted size (${maxBytes} bytes)`);
      }
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, dataSlice);
    }
  }

  return { fileCount, totalBytes };
}

export function extractZipSafely(
  zipBuffer: Buffer,
  destDir: string,
  limits: { maxBytes?: number; maxFiles?: number } = {},
): { fileCount: number; totalBytes: number } {
  const maxBytes = limits.maxBytes ?? MAX_EXTRACTED_BYTES;
  const maxFiles = limits.maxFiles ?? MAX_EXTRACTED_FILES;
  const resolvedDest = resolve(destDir);
  mkdirSync(resolvedDest, { recursive: true });

  // Find End of Central Directory (EOCD: 0x06054b50)
  const minEocdOffset = Math.max(0, zipBuffer.length - 65557);
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= minEocdOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP archive: missing end-of-central-directory record');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > zipBuffer.length) {
    throw new Error('Invalid ZIP archive: central directory out of bounds');
  }

  let pos = cdOffset;
  let fileCount = 0;
  let totalBytes = 0;

  for (let idx = 0; idx < totalEntries; idx++) {
    if (pos + 46 > zipBuffer.length || zipBuffer.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('Invalid ZIP archive: corrupt central directory entry');
    }

    const compression = zipBuffer.readUInt16LE(pos + 10);
    const compressedSize = zipBuffer.readUInt32LE(pos + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(pos + 24);
    const nameLen = zipBuffer.readUInt16LE(pos + 28);
    const extraLen = zipBuffer.readUInt16LE(pos + 30);
    const commentLen = zipBuffer.readUInt16LE(pos + 32);
    const extAttr = zipBuffer.readUInt32LE(pos + 38);
    const localHeaderOffset = zipBuffer.readUInt32LE(pos + 42);

    const entryName = zipBuffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    // Detect Unix symlinks in ZIP external attributes (S_IFLNK = 0o120000)
    const unixMode = (extAttr >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new Error(`ZIP archive contains disallowed symlink entry: ${entryName}`);
    }

    const fullPath = assertSafeArchiveEntryPath(entryName, resolvedDest);
    if (entryName.endsWith('/')) {
      mkdirSync(fullPath, { recursive: true });
      continue;
    }

    fileCount += 1;
    if (fileCount > maxFiles) {
      throw new Error(`Archive exceeds maximum file count (${maxFiles})`);
    }
    if (totalBytes + uncompressedSize > maxBytes) {
      throw new Error(`Archive exceeds maximum extracted size (${maxBytes} bytes)`);
    }

    if (
      localHeaderOffset + 30 > zipBuffer.length ||
      zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error(`Invalid ZIP local header for entry: ${entryName}`);
    }

    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuffer.length) {
      throw new Error(`Truncated ZIP entry payload: ${entryName}`);
    }

    const compressedData = zipBuffer.subarray(dataStart, dataEnd);
    let content: Buffer;
    if (compression === 0) {
      content = compressedData;
    } else if (compression === 8) {
      content = inflateRawSync(compressedData, { maxOutputLength: maxBytes - totalBytes });
    } else {
      throw new Error(`Unsupported ZIP compression method (${compression}) for ${entryName}`);
    }

    totalBytes += content.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Archive exceeds maximum extracted size (${maxBytes} bytes)`);
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  return { fileCount, totalBytes };
}

export function extractArchiveSafely(
  buffer: Buffer,
  destDir: string,
  hint: 'tar.gz' | 'zip' | null = null,
): { fileCount: number; totalBytes: number } {
  const isGzipMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const isZipMagic = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  if (hint === 'zip' || (!isGzipMagic && isZipMagic)) {
    return extractZipSafely(buffer, destDir);
  }
  if (hint === 'tar.gz' || isGzipMagic) {
    return extractTarGzSafely(buffer, destDir);
  }
  throw new Error('Unrecognized archive format (expected .tar.gz or .zip)');
}

// ---------------------------------------------------------------------------
// Payload location, validation & backend change detection
// ---------------------------------------------------------------------------

export function locatePluginPayloadDir(extractedDir: string): string | null {
  const candidates = [
    extractedDir,
    join(extractedDir, 'plugin'),
  ];

  // GitHub source archives wrap contents in a single top-level directory.
  try {
    const entries = readdirSync(extractedDir, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    );
    if (entries.length === 1) {
      const top = join(extractedDir, entries[0].name);
      candidates.push(top, join(top, 'plugin'));
    }
  } catch {
    /* ignore */
  }

  for (const dir of candidates) {
    if (existsSync(join(dir, 'plugin.json')) && existsSync(join(dir, 'sidecars', 'hud_panel'))) {
      return dir;
    }
  }
  return null;
}

const REQUIRED_PAYLOAD_FILES = [
  'plugin.json',
  join('sidecars', 'hud_panel', 'sidecar.json'),
  join('sidecars', 'hud_panel', 'server.ts'),
  join('sidecars', 'hud_panel', 'ui', 'index.html'),
  join('sidecars', 'hud_panel', 'ui', 'app.js'),
  join('sidecars', 'hud_panel', 'ui', 'styles.css'),
];

export function validatePluginPayload(payloadDir: string): PayloadValidationResult {
  const missing: string[] = [];
  const errors: string[] = [];

  for (const rel of REQUIRED_PAYLOAD_FILES) {
    const full = join(payloadDir, rel);
    if (!existsSync(full)) {
      missing.push(rel);
      continue;
    }
    try {
      const st = lstatSync(full);
      if (!st.isFile() || st.size === 0) {
        errors.push(`Required file is empty or invalid: ${rel}`);
      }
    } catch {
      missing.push(rel);
    }
  }

  let version: string | null = null;
  if (!missing.includes('plugin.json')) {
    const manifest = readPluginManifest(payloadDir);
    if (!manifest) {
      errors.push('plugin.json is invalid JSON or missing version');
    } else {
      if (manifest.name && manifest.name !== PLUGIN_NAME) {
        errors.push(`Unexpected plugin name in plugin.json: ${manifest.name}`);
      }
      if (!parseSemver(manifest.version)) {
        errors.push(`Invalid SemVer version in plugin.json: ${manifest.version}`);
      } else {
        version = manifest.version;
      }
    }
  }

  if (!missing.includes(join('sidecars', 'hud_panel', 'sidecar.json'))) {
    try {
      const sidecar = JSON.parse(readFileSync(join(payloadDir, 'sidecars', 'hud_panel', 'sidecar.json'), 'utf8'));
      if (!sidecar || typeof sidecar.command !== 'string') {
        errors.push('sidecar.json is missing required command field');
      }
    } catch {
      errors.push('sidecar.json is invalid JSON');
    }
  }

  return {
    valid: missing.length === 0 && errors.length === 0 && version !== null,
    version,
    missing,
    errors,
  };
}

function hashBackendFiles(pluginDir: string): string {
  const hash = createHash('sha256');
  const sidecarDir = join(pluginDir, 'sidecars', 'hud_panel');
  const targets = [
    join(sidecarDir, 'sidecar.json'),
    join(sidecarDir, 'server.ts'),
    join(sidecarDir, 'pricing.json'),
  ];
  const libDir = join(sidecarDir, 'lib');
  if (existsSync(libDir)) {
    const libFiles = readdirSync(libDir)
      .filter((n) => n.endsWith('.ts') || n.endsWith('.json'))
      .sort();
    for (const f of libFiles) {
      targets.push(join(libDir, f));
    }
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

// ---------------------------------------------------------------------------
// Cross-platform atomic swap & rollback
// ---------------------------------------------------------------------------

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

export function renameWithRetry(src: string, dst: string, maxAttempts = 5): void {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      renameSync(src, dst);
      return;
    } catch (err: any) {
      lastErr = err;
      if (err?.code === 'EXDEV') {
        cpSync(src, dst, { recursive: true });
        rmSync(src, { recursive: true, force: true });
        return;
      }
      if (!RETRYABLE_FS_CODES.has(err?.code) || attempt === maxAttempts) {
        throw err;
      }
      sleepSync(attempt * 60);
    }
  }
  throw lastErr;
}

export function swapDirectoryAtomically(params: {
  sourcePayloadDir: string;
  targetDir: string;
  beforeSwapHook?: (ctx: { targetDir: string; stagedDir: string; backupDir: string }) => void;
}): { swapped: boolean; rolledBack: boolean; error?: string } {
  const { sourcePayloadDir, targetDir, beforeSwapHook } = params;
  const parent = dirname(targetDir);
  mkdirSync(parent, { recursive: true });

  const workRoot = mkdtempSync(join(parent, `.${PLUGIN_NAME}-update-`));
  const stagedDir = join(workRoot, 'staged');
  const backupDir = join(workRoot, 'backup');
  const hadExisting = existsSync(targetDir);
  let backedUp = false;

  try {
    cpSync(sourcePayloadDir, stagedDir, {
      recursive: true,
      filter: (src) => !SKIP_INSTALL_NAMES.has(basename(src)),
    });

    if (hadExisting) {
      renameWithRetry(targetDir, backupDir);
      backedUp = true;
    }

    if (beforeSwapHook) {
      beforeSwapHook({ targetDir, stagedDir, backupDir });
    }

    renameWithRetry(stagedDir, targetDir);
    return { swapped: true, rolledBack: false };
  } catch (err: any) {
    let rolledBack = false;
    if (backedUp && existsSync(backupDir)) {
      try {
        if (existsSync(targetDir)) {
          rmSync(targetDir, { recursive: true, force: true });
        }
        renameWithRetry(backupDir, targetDir);
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }
    return {
      swapped: false,
      rolledBack,
      error: err?.message || String(err),
    };
  } finally {
    try {
      rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// ---------------------------------------------------------------------------
// Self-update orchestrator
// ---------------------------------------------------------------------------

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
