/**
 * Shared zero-dependency plugin release, verification, archive extraction,
 * and cross-platform atomic swap primitives.
 *
 * Used by both:
 * - `plugin/sidecars/hud_panel/lib/updater.ts` (in-app self-updater)
 * - `plugin/install.mjs` (CLI installer / updater / doctor)
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

export const GITHUB_OWNER = 'skywalker512';
export const GITHUB_REPO = 'agy-hud';
export const PLUGIN_NAME = 'agy-hud';
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

export const REQUIRED_UI_FILES = [
  join('sidecars', 'hud_panel', 'ui', 'index.html'),
  join('sidecars', 'hud_panel', 'ui', 'app.js'),
  join('sidecars', 'hud_panel', 'ui', 'styles.css'),
];

export const REQUIRED_PLUGIN_FILES = [
  'plugin.json',
  join('sidecars', 'hud_panel', 'sidecar.json'),
  join('sidecars', 'hud_panel', 'server.ts'),
  ...REQUIRED_UI_FILES,
];

const REDIRECT_CDN_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: (number | string)[];
  build: string[];
  raw: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  displayName?: string;
}

export interface PayloadValidationResult {
  valid: boolean;
  version: string | null;
  missing: string[];
  errors: string[];
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

  const build: string[] = [];
  if (buildStr !== undefined) {
    for (const part of buildStr.split('.')) {
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
// Timeout-bounded fetch & verified archive download
// ---------------------------------------------------------------------------

export async function fetchWithTimeout(
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
      out[record.slice(0, eqIdx)] = record.slice(eqIdx + 1).replace(/\n$/, '');
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
// Manifest reading, payload location & validation
// ---------------------------------------------------------------------------

export function readPluginManifest(pluginDir: string): PluginManifest | null {
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

export function locatePluginPayloadDir(extractedDir: string): string | null {
  const candidates = [extractedDir, join(extractedDir, 'plugin')];

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

export function validatePluginPayload(payloadDir: string): PayloadValidationResult {
  const missing: string[] = [];
  const errors: string[] = [];

  for (const rel of REQUIRED_PLUGIN_FILES) {
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

// ---------------------------------------------------------------------------
// Cross-platform filesystem helpers & atomic directory swap
// ---------------------------------------------------------------------------

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

export function pathExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isSymlinkPath(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function removeWithRetry(p: string, maxAttempts = 5): void {
  if (!pathExists(p)) return;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(p, { recursive: true, force: true });
      return;
    } catch (err: any) {
      lastErr = err;
      if (!RETRYABLE_FS_CODES.has(err?.code) || attempt === maxAttempts) {
        throw err;
      }
      sleepSync(attempt * 60);
    }
  }
  throw lastErr;
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

export function swapDirectoryAtomically(params: {
  sourcePayloadDir: string;
  targetDir: string;
  tempPrefix?: string;
  beforeSwapHook?: (ctx: { targetDir: string; stagedDir: string; backupDir: string }) => void;
}): { swapped: boolean; ok: boolean; rolledBack: boolean; error?: string } {
  const { sourcePayloadDir, targetDir, tempPrefix = `.${PLUGIN_NAME}-update-`, beforeSwapHook } = params;
  const parent = dirname(targetDir);
  mkdirSync(parent, { recursive: true });

  const workRoot = mkdtempSync(join(parent, tempPrefix));
  const stagedDir = join(workRoot, 'staged');
  const backupDir = join(workRoot, 'backup');
  const existed = pathExists(targetDir);
  const wasSymlink = isSymlinkPath(targetDir);
  let backedUp = false;

  try {
    cpSync(sourcePayloadDir, stagedDir, {
      recursive: true,
      filter: (src) => !SKIP_INSTALL_NAMES.has(basename(src)),
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
    return { swapped: true, ok: true, rolledBack: false };
  } catch (err: any) {
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
    return {
      swapped: false,
      ok: false,
      rolledBack,
      error: err?.message || String(err),
    };
  } finally {
    try {
      removeWithRetry(workRoot);
    } catch {
      /* best-effort cleanup */
    }
  }
}
