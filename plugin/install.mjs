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
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { arch, homedir, platform, release } from 'node:os';
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

export const PLUGIN_NAME = 'agy-hud';
export const GITHUB_OWNER = 'skywalker512';
export const GITHUB_REPO = 'agy-hud';
export const MIN_NODE = [22, 18];
export const SKIP_NAMES = new Set([
  'install.mjs',
  'test',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  'tsconfig.json',
]);

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 2_000;
const MAX_REDIRECT_HOPS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const REDIRECT_CDN_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

const REQUIRED_UI_FILES = [
  join('sidecars', 'hud_panel', 'ui', 'index.html'),
  join('sidecars', 'hud_panel', 'ui', 'app.js'),
  join('sidecars', 'hud_panel', 'ui', 'styles.css'),
];

const REQUIRED_PLUGIN_FILES = [
  'plugin.json',
  join('sidecars', 'hud_panel', 'sidecar.json'),
  join('sidecars', 'hud_panel', 'server.ts'),
  ...REQUIRED_UI_FILES,
];

const __filename = fileURLToPath(import.meta.url);
const defaultSourceDir = dirname(realpathSync(__filename));

export function getDefaultTargetDir(home = homedir()) {
  return join(home, '.gemini', 'config', 'plugins', PLUGIN_NAME);
}

// ---------------------------------------------------------------------------
// SemVer 2.0.0 parsing & comparison
// ---------------------------------------------------------------------------

const SEMVER_RE = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const NUMERIC_ID_RE = /^(?:0|[1-9]\d*)$/;

export function parseSemver(raw) {
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
  const prerelease = [];
  if (preStr !== undefined) {
    for (const part of preStr.split('.')) {
      if (!part) return null;
      if (/^\d+$/.test(part)) {
        if (!NUMERIC_ID_RE.test(part)) return null;
        prerelease.push(Number(part));
      } else {
        prerelease.push(part);
      }
    }
  }
  const build = buildStr !== undefined ? buildStr.split('.').filter(Boolean) : [];
  return { major, minor, patch, prerelease, build, raw: trimmed };
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  const aPre = pa.prerelease.length > 0;
  const bPre = pb.prerelease.length > 0;
  if (!aPre && !bPre) return 0;
  if (!aPre && bPre) return 1;
  if (aPre && !bPre) return -1;
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
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;
    return String(ai) < String(bi) ? -1 : 1;
  }
  return 0;
}

export function isNodeVersionSupported(nodeVersion = process.versions.node) {
  const [major, minor] = String(nodeVersion).split('.').map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

// ---------------------------------------------------------------------------
// Cross-platform filesystem helpers (atomic replace + Windows EPERM retry)
// ---------------------------------------------------------------------------

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

export function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isSymlinkPath(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function removeWithRetry(p, maxAttempts = 5) {
  if (!pathExists(p)) return;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(p, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      if (!RETRYABLE_FS_CODES.has(err?.code) || attempt === maxAttempts) {
        throw err;
      }
      sleepSync(attempt * 60);
    }
  }
  throw lastErr;
}

export function renameWithRetry(src, dst, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      renameSync(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      if (err?.code === 'EXDEV') {
        cpSync(src, dst, { recursive: true });
        removeWithRetry(src);
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

export function readPluginManifest(dir) {
  try {
    const raw = readFileSync(join(dir, 'plugin.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'string' || !parsed.version.trim()) return null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      version: parsed.version.trim(),
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : 'AGY-HUD',
    };
  } catch {
    return null;
  }
}

export function validatePluginPayload(dir) {
  const missing = [];
  const errors = [];

  for (const rel of REQUIRED_PLUGIN_FILES) {
    const full = join(dir, rel);
    if (!existsSync(full)) {
      missing.push(rel);
      continue;
    }
    try {
      const st = lstatSync(full);
      if (!st.isFile() || st.size === 0) {
        errors.push(`Empty or non-file asset: ${rel}`);
      }
    } catch {
      missing.push(rel);
    }
  }

  let version = null;
  if (!missing.includes('plugin.json')) {
    const manifest = readPluginManifest(dir);
    if (!manifest) {
      errors.push('plugin.json is invalid JSON or missing version');
    } else {
      if (manifest.name && manifest.name !== PLUGIN_NAME) {
        errors.push(`Unexpected plugin name: ${manifest.name}`);
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
      const sidecar = JSON.parse(readFileSync(join(dir, 'sidecars', 'hud_panel', 'sidecar.json'), 'utf8'));
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

export function swapPluginAtomically({ sourcePayloadDir, targetDir, beforeSwapHook }) {
  const parent = dirname(targetDir);
  mkdirSync(parent, { recursive: true });
  const workRoot = mkdtempSync(join(parent, `.${PLUGIN_NAME}-stage-`));
  const stagedDir = join(workRoot, 'staged');
  const backupDir = join(workRoot, 'backup');

  const existed = pathExists(targetDir);
  const wasSymlink = isSymlinkPath(targetDir);
  let backedUp = false;

  try {
    cpSync(sourcePayloadDir, stagedDir, {
      recursive: true,
      filter: (src) => !SKIP_NAMES.has(basename(src)),
    });

    if (existed) {
      if (wasSymlink) {
        removeWithRetry(targetDir);
      } else {
        renameWithRetry(targetDir, backupDir);
        backedUp = true;
      }
    }

    if (typeof beforeSwapHook === 'function') {
      beforeSwapHook({ targetDir, stagedDir, backupDir });
    }

    renameWithRetry(stagedDir, targetDir);
    return { ok: true, rolledBack: false };
  } catch (err) {
    let rolledBack = false;
    if (backedUp && pathExists(backupDir)) {
      try {
        removeWithRetry(targetDir);
        renameWithRetry(backupDir, targetDir);
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }
    return { ok: false, rolledBack, error: err?.message || String(err) };
  } finally {
    try {
      removeWithRetry(workRoot);
    } catch {
      /* ignore cleanup errors */
    }
  }
}

// ---------------------------------------------------------------------------
// Strict GitHub URL allowlist & archive download/extraction
// ---------------------------------------------------------------------------

function hasPathTraversal(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return true;
  return decoded.split('/').some((seg) => seg === '..');
}

export function isAllowedDownloadUrl(rawUrl, options = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  let parsed;
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

export function assertSafeArchiveEntryPath(rawEntryPath, destRoot) {
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
  if (segments.length === 0) return resolvedRoot;
  const fullPath = resolve(resolvedRoot, ...segments);
  if (fullPath !== resolvedRoot && !fullPath.startsWith(resolvedRoot + sep)) {
    throw new Error(`Archive entry escapes destination directory: ${rawEntryPath}`);
  }
  return fullPath;
}

function readTarString(buf, offset, length) {
  let end = offset;
  const max = Math.min(buf.length, offset + length);
  while (end < max && buf[end] !== 0) end++;
  return buf.subarray(offset, end).toString('utf8');
}

function readTarOctal(buf, offset, length) {
  const raw = readTarString(buf, offset, length).trim();
  if (!raw) return 0;
  if ((buf[offset] & 0x80) !== 0) {
    let val = 0;
    for (let i = 1; i < length; i++) val = val * 256 + buf[offset + i];
    return val;
  }
  const parsed = parseInt(raw, 8);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePaxRecords(data) {
  const out = {};
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
      out[record.slice(0, eqIdx)] = record.slice(eqIdx + 1).replace(/\n$/, '');
    }
    pos += len;
  }
  return out;
}

export function extractTarGzSafely(gzBuffer, destDir) {
  const tarBuf = gunzipSync(gzBuffer, { maxOutputLength: MAX_EXTRACTED_BYTES });
  const resolvedDest = resolve(destDir);
  mkdirSync(resolvedDest, { recursive: true });

  let offset = 0;
  let fileCount = 0;
  let totalBytes = 0;
  let nextPaxPath = null;
  let nextGnuLongName = null;

  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
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
    if (dataEnd > tarBuf.length) throw new Error('Truncated tar archive entry');
    const dataSlice = tarBuf.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (typeFlag === 'g') continue;
    if (typeFlag === 'x') {
      const pax = parsePaxRecords(dataSlice);
      if (pax.path) nextPaxPath = pax.path;
      continue;
    }
    if (typeFlag === 'L') {
      nextGnuLongName = dataSlice.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    const entryPath = nextPaxPath ?? nextGnuLongName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    nextPaxPath = null;
    nextGnuLongName = null;

    if (typeFlag === '1' || typeFlag === '2' || typeFlag === '3' || typeFlag === '4' || typeFlag === '6') {
      throw new Error(`Archive contains disallowed link or special file (${typeFlag}): ${entryPath}`);
    }

    const fullPath = assertSafeArchiveEntryPath(entryPath, resolvedDest);
    if (typeFlag === '5' || entryPath.endsWith('/')) {
      mkdirSync(fullPath, { recursive: true });
      continue;
    }

    if (typeFlag === '0' || typeFlag === '\0') {
      fileCount += 1;
      totalBytes += size;
      if (fileCount > MAX_EXTRACTED_FILES) throw new Error(`Archive exceeds max file count (${MAX_EXTRACTED_FILES})`);
      if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error(`Archive exceeds max size (${MAX_EXTRACTED_BYTES} bytes)`);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, dataSlice);
    }
  }
  return { fileCount, totalBytes };
}

export function extractZipSafely(zipBuffer, destDir) {
  const resolvedDest = resolve(destDir);
  mkdirSync(resolvedDest, { recursive: true });

  const minEocdOffset = Math.max(0, zipBuffer.length - 65557);
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= minEocdOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Invalid ZIP archive: missing EOCD record');

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > zipBuffer.length) throw new Error('Invalid ZIP archive: central directory out of bounds');

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
    if (fileCount > MAX_EXTRACTED_FILES) throw new Error(`Archive exceeds max file count (${MAX_EXTRACTED_FILES})`);
    if (totalBytes + uncompressedSize > MAX_EXTRACTED_BYTES) {
      throw new Error(`Archive exceeds max size (${MAX_EXTRACTED_BYTES} bytes)`);
    }

    if (localHeaderOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for entry: ${entryName}`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuffer.length) throw new Error(`Truncated ZIP entry payload: ${entryName}`);

    const compressedData = zipBuffer.subarray(dataStart, dataEnd);
    let content;
    if (compression === 0) content = compressedData;
    else if (compression === 8) content = inflateRawSync(compressedData, { maxOutputLength: MAX_EXTRACTED_BYTES - totalBytes });
    else throw new Error(`Unsupported ZIP compression method (${compression}) for ${entryName}`);

    totalBytes += content.length;
    if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error(`Archive exceeds max size (${MAX_EXTRACTED_BYTES} bytes)`);

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return { fileCount, totalBytes };
}

function extractArchiveSafely(buffer, destDir, hint = null) {
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (hint === 'zip' || (!isGzip && isZip)) return extractZipSafely(buffer, destDir);
  if (hint === 'tar.gz' || isGzip) return extractTarGzSafely(buffer, destDir);
  throw new Error('Unrecognized archive format (expected .tar.gz or .zip)');
}

function locatePluginPayloadDir(extractedDir) {
  const candidates = [extractedDir, join(extractedDir, 'plugin')];
  try {
    const dirs = readdirSync(extractedDir, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    );
    if (dirs.length === 1) {
      const top = join(extractedDir, dirs[0].name);
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

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

async function downloadVerifiedArchive(initialUrl, { owner = GITHUB_OWNER, repo = GITHUB_REPO, fetchImpl = globalThis.fetch } = {}) {
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
          'User-Agent': `${PLUGIN_NAME}-installer`,
          Accept: 'application/octet-stream, application/gzip, application/zip, */*',
        },
      },
      DOWNLOAD_TIMEOUT_MS,
    );

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.get?.('location');
      if (!location) throw new Error(`Redirect (${res.status}) missing Location header`);
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isAllowedDownloadUrl(nextUrl, { isRedirectHop: true, owner, repo })) {
        throw new Error(`Refused redirect to disallowed URL: ${nextUrl}`);
      }
      currentUrl = nextUrl;
      continue;
    }

    if (!res.ok) throw new Error(`Download failed with HTTP ${res.status}`);
    const contentLen = Number(res.headers?.get?.('content-length') || 0);
    if (Number.isFinite(contentLen) && contentLen > MAX_ARCHIVE_BYTES) {
      throw new Error(`Archive exceeds maximum size (${contentLen} bytes)`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('Downloaded archive is empty');
    if (buf.length > MAX_ARCHIVE_BYTES) throw new Error(`Archive exceeds maximum size (${buf.length} bytes)`);
    return buf;
  }
  throw new Error(`Exceeded maximum redirects (${MAX_REDIRECT_HOPS})`);
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
      error: `Pre-built UI bundle missing (${missingUi.join(', ')}). Run "npm --prefix web run build" first.`,
    };
  }

  logger.warn?.(`Pre-built UI bundle missing (${missingUi.join(', ')}). Attempting to build from ${webDir}...`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    if (!existsSync(join(webDir, 'node_modules'))) {
      execFileSync(npmCmd, ['--prefix', webDir, 'install'], { stdio: 'inherit', timeout: 180_000 });
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
      archiveBuf = await downloadVerifiedArchive(downloadUrl, { owner, repo, fetchImpl });
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
