import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateRawSync, gzipSync } from 'node:zlib';

import {
  applySelfUpdate,
  assertSafeArchiveEntryPath,
  checkForUpdates,
  compareSemver,
  extractTarGzSafely,
  extractZipSafely,
  inspectInstallState,
  isAllowedApiUrl,
  isAllowedDownloadUrl,
  parseSemver,
  resetUpdaterStateForTests,
  validatePluginPayload,
} from '../lib/updater.ts';

// ---------------------------------------------------------------------------
// Synthetic archive builders (tar.gz & zip) for self-contained tests
// ---------------------------------------------------------------------------

function createTarHeader(name: string, size: number, typeFlag = '0'): Buffer {
  const header = Buffer.alloc(512, 0);
  Buffer.from(name, 'utf8').copy(header, 0, 0, Math.min(100, Buffer.byteLength(name)));
  Buffer.from('0000644\0', 'ascii').copy(header, 100);
  Buffer.from('0000000\0', 'ascii').copy(header, 108);
  Buffer.from('0000000\0', 'ascii').copy(header, 116);
  Buffer.from(`${size.toString(8).padStart(11, '0')}\0`, 'ascii').copy(header, 124);
  Buffer.from(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 'ascii').copy(header, 136);
  Buffer.from('        ', 'ascii').copy(header, 148);
  header[156] = typeFlag.charCodeAt(0);
  Buffer.from('ustar\0', 'ascii').copy(header, 257);
  Buffer.from('00', 'ascii').copy(header, 263);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  Buffer.from(`${sum.toString(8).padStart(6, '0')}\0 `, 'ascii').copy(header, 148);
  return header;
}

function buildTarGz(entries: { name: string; content?: string | Buffer; typeFlag?: string }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const typeFlag = entry.typeFlag ?? '0';
    const data = entry.content !== undefined
      ? (Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8'))
      : Buffer.alloc(0);
    chunks.push(createTarHeader(entry.name, data.length, typeFlag));
    if (data.length > 0) {
      chunks.push(data);
      const rem = data.length % 512;
      if (rem !== 0) chunks.push(Buffer.alloc(512 - rem, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0)); // EOF two zero blocks
  return gzipSync(Buffer.concat(chunks));
}

function buildZip(entries: { name: string; content?: string | Buffer; compress?: boolean; unixMode?: number }[]): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawData = entry.content !== undefined
      ? (Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8'))
      : Buffer.alloc(0);
    const useDeflate = Boolean(entry.compress && rawData.length > 0);
    const compData = useDeflate ? deflateRawSync(rawData) : rawData;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc32 ignored by extractor
    local.writeUInt32LE(compData.length, 18);
    local.writeUInt32LE(rawData.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compData);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4); // Unix
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(compData.length, 20);
    cd.writeUInt32LE(rawData.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    cdParts.push(cd, nameBuf);

    offset += local.length + nameBuf.length + compData.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

function createPluginFixtureDir(
  dir: string,
  version: string,
  opts: { serverBody?: string; uiHtml?: string; includeUi?: boolean } = {},
) {
  mkdirSync(join(dir, 'sidecars', 'hud_panel', 'lib'), { recursive: true });
  mkdirSync(join(dir, 'sidecars', 'hud_panel', 'ui'), { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({ name: 'agy-hud', displayName: 'AGY-HUD', version }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(dir, 'sidecars', 'hud_panel', 'sidecar.json'),
    JSON.stringify({ command: 'node', args: ['server.ts'] }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(dir, 'sidecars', 'hud_panel', 'server.ts'),
    opts.serverBody ?? `// agy-hud server v${version}\nexport const v = '${version}';\n`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'sidecars', 'hud_panel', 'lib', 'constants.ts'),
    `export const VERSION_MARKER = '${version}';\n`,
    'utf8',
  );
  if (opts.includeUi !== false) {
    writeFileSync(
      join(dir, 'sidecars', 'hud_panel', 'ui', 'index.html'),
      opts.uiHtml ?? `<!doctype html><title>AGY-HUD ${version}</title>`,
      'utf8',
    );
    writeFileSync(join(dir, 'sidecars', 'hud_panel', 'ui', 'app.js'), `console.log('${version}');`, 'utf8');
    writeFileSync(join(dir, 'sidecars', 'hud_panel', 'ui', 'styles.css'), `body { content: '${version}'; }`, 'utf8');
  }
}

function buildPluginTarEntries(
  prefix: string,
  version: string,
  opts: { serverBody?: string; uiHtml?: string; includeUi?: boolean } = {},
) {
  const entries = [
    {
      name: `${prefix}plugin/plugin.json`,
      content: JSON.stringify({ name: 'agy-hud', displayName: 'AGY-HUD', version }),
    },
    {
      name: `${prefix}plugin/sidecars/hud_panel/sidecar.json`,
      content: JSON.stringify({ command: 'node', args: ['server.ts'] }),
    },
    {
      name: `${prefix}plugin/sidecars/hud_panel/server.ts`,
      content: opts.serverBody ?? `// agy-hud server v${version}\nexport const v = '${version}';\n`,
    },
    {
      name: `${prefix}plugin/sidecars/hud_panel/lib/constants.ts`,
      content: `export const VERSION_MARKER = '${version}';\n`,
    },
  ];
  if (opts.includeUi !== false) {
    entries.push(
      {
        name: `${prefix}plugin/sidecars/hud_panel/ui/index.html`,
        content: opts.uiHtml ?? `<!doctype html><title>AGY-HUD ${version}</title>`,
      },
      { name: `${prefix}plugin/sidecars/hud_panel/ui/app.js`, content: `console.log('${version}');` },
      { name: `${prefix}plugin/sidecars/hud_panel/ui/styles.css`, content: `body { content: '${version}'; }` },
    );
  }
  return entries;
}

function binaryResponse(buf: Buffer, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(buf), { status, headers });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// ---------------------------------------------------------------------------
// 1. SemVer tests
// ---------------------------------------------------------------------------

test('parseSemver & compareSemver follow SemVer 2.0.0 including prereleases and build metadata', () => {
  assert.equal(parseSemver('v1.2.3')?.major, 1);
  assert.equal(parseSemver('01.2.3'), null);
  assert.equal(parseSemver('not-a-version'), null);

  assert.equal(compareSemver('1.2.0', '1.2.0'), 0);
  assert.equal(compareSemver('v1.2.0+build.123', '1.2.0+build.999'), 0);
  assert.equal(compareSemver('1.3.0', '1.2.9'), 1);
  assert.equal(compareSemver('1.2.0', '2.0.0'), -1);

  // SemVer 2.0.0 precedence chain
  const ordered = [
    '1.0.0-1',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.equal(
      compareSemver(ordered[i], ordered[i + 1]),
      -1,
      `expected ${ordered[i]} < ${ordered[i + 1]}`,
    );
    assert.equal(
      compareSemver(ordered[i + 1], ordered[i]),
      1,
      `expected ${ordered[i + 1]} > ${ordered[i]}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Strict GitHub URL allowlist tests
// ---------------------------------------------------------------------------

test('isAllowedDownloadUrl and isAllowedApiUrl enforce strict GitHub repo allowlist', () => {
  // Allowed initial download URLs
  assert.equal(
    isAllowedDownloadUrl('https://github.com/skywalker512/agy-hud/releases/download/v1.3.0/agy-hud.tar.gz'),
    true,
  );
  assert.equal(
    isAllowedDownloadUrl('https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.3.0'),
    true,
  );
  assert.equal(
    isAllowedDownloadUrl('https://codeload.github.com/skywalker512/agy-hud/tar.gz/refs/tags/v1.3.0'),
    true,
  );

  // CDN hosts only allowed on verified redirect hops
  assert.equal(
    isAllowedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/123', {
      isRedirectHop: false,
    }),
    false,
  );
  assert.equal(
    isAllowedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/123', {
      isRedirectHop: true,
    }),
    true,
  );
  assert.equal(
    isAllowedDownloadUrl('https://release-assets.githubusercontent.com/assets/abc', {
      isRedirectHop: true,
    }),
    true,
  );

  // Disallowed URLs
  assert.equal(isAllowedDownloadUrl('http://github.com/skywalker512/agy-hud/archive/main.tar.gz'), false);
  assert.equal(isAllowedDownloadUrl('https://evil.com/skywalker512/agy-hud/archive/main.tar.gz'), false);
  assert.equal(isAllowedDownloadUrl('https://github.com.evil.com/skywalker512/agy-hud/a.tar.gz'), false);
  assert.equal(isAllowedDownloadUrl('https://github.com/otheruser/agy-hud/archive/main.tar.gz'), false);
  assert.equal(isAllowedDownloadUrl('https://user:pass@github.com/skywalker512/agy-hud/a.tar.gz'), false);
  assert.equal(isAllowedDownloadUrl('https://github.com:8443/skywalker512/agy-hud/a.tar.gz'), false);
  assert.equal(isAllowedDownloadUrl('https://github.com/skywalker512/agy-hud/../../evil/repo'), false);
  assert.equal(isAllowedDownloadUrl('https://github.com/skywalker512/agy-hud/%2e%2e/evil'), false);
  assert.equal(isAllowedDownloadUrl('file:///etc/passwd'), false);

  // API URLs
  assert.equal(isAllowedApiUrl('https://api.github.com/repos/skywalker512/agy-hud/releases/latest'), true);
  assert.equal(isAllowedApiUrl('https://raw.githubusercontent.com/skywalker512/agy-hud/main/plugin/plugin.json'), true);
  assert.equal(isAllowedApiUrl('https://raw.githubusercontent.com/evil/agy-hud/main/plugin/plugin.json'), false);
});

// ---------------------------------------------------------------------------
// 3. Zip-slip & symlink-escape protection tests
// ---------------------------------------------------------------------------

test('extractTarGzSafely and extractZipSafely block path traversal, absolute paths, and symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-archive-sec-'));
  try {
    // Path validation unit checks
    assert.throws(() => assertSafeArchiveEntryPath('../outside.txt', root), /path traversal/i);
    assert.throws(() => assertSafeArchiveEntryPath('foo/../../outside.txt', root), /path traversal/i);
    assert.throws(() => assertSafeArchiveEntryPath('/etc/passwd', root), /absolute path/i);
    assert.throws(() => assertSafeArchiveEntryPath('C:\\Windows\\system.ini', root), /absolute path/i);
    assert.throws(() => assertSafeArchiveEntryPath('a\0b.txt', root), /null byte/i);

    // Malicious tar.gz: zip-slip
    const evilTarTraverse = buildTarGz([{ name: 'agy-hud/../../pwned.txt', content: 'boom' }]);
    assert.throws(() => extractTarGzSafely(evilTarTraverse, join(root, 'out1')), /path traversal/i);

    // Malicious tar.gz: symlink
    const evilTarSymlink = buildTarGz([{ name: 'agy-hud/link', typeFlag: '2', content: '' }]);
    assert.throws(() => extractTarGzSafely(evilTarSymlink, join(root, 'out2')), /disallowed link/i);

    // Malicious zip: zip-slip
    const evilZipTraverse = buildZip([{ name: '../escape.txt', content: 'boom' }]);
    assert.throws(() => extractZipSafely(evilZipTraverse, join(root, 'out3')), /path traversal/i);

    // Malicious zip: Unix symlink
    const evilZipSymlink = buildZip([{ name: 'agy-hud/link', content: '/etc/passwd', unixMode: 0o120777 }]);
    assert.throws(() => extractZipSafely(evilZipSymlink, join(root, 'out4')), /disallowed symlink/i);

    // Valid zip (both stored and deflated) extracts cleanly
    const goodZip = buildZip([
      { name: 'agy-hud/a.txt', content: 'stored-ok', compress: false },
      { name: 'agy-hud/b.txt', content: 'deflated-content-'.repeat(20), compress: true },
    ]);
    const out5 = join(root, 'out5');
    const res = extractZipSafely(goodZip, out5);
    assert.equal(res.fileCount, 2);
    assert.equal(readFileSync(join(out5, 'agy-hud', 'a.txt'), 'utf8'), 'stored-ok');
    assert.equal(readFileSync(join(out5, 'agy-hud', 'b.txt'), 'utf8'), 'deflated-content-'.repeat(20));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Version check, fallbacks, 6h disk+memory cache & offline/rate-limit handling
// ---------------------------------------------------------------------------

test('checkForUpdates uses 6h disk+memory cache, handles release/tag/manifest fallbacks, offline, and rate-limits', async () => {
  resetUpdaterStateForTests();
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-check-'));
  try {
    const pluginDir = join(root, 'agy-hud');
    const cachePath = join(root, 'cache', 'update-cache.json');
    createPluginFixtureDir(pluginDir, '1.2.0');

    let calls = 0;
    const releaseFetch = async (input: string | URL) => {
      calls++;
      const url = String(input);
      assert.equal(url, 'https://api.github.com/repos/skywalker512/agy-hud/releases/latest');
      return jsonResponse({
        tag_name: 'v1.3.0',
        html_url: 'https://github.com/skywalker512/agy-hud/releases/tag/v1.3.0',
        body: 'New commercial dashboard!',
        published_at: '2026-11-21T00:00:00Z',
        assets: [
          {
            name: 'agy-hud-v1.3.0.tar.gz',
            browser_download_url: 'https://github.com/skywalker512/agy-hud/releases/download/v1.3.0/agy-hud-v1.3.0.tar.gz',
          },
        ],
      });
    };

    const t0 = 1_800_000_000_000;
    const s1 = await checkForUpdates({ pluginDir, cachePath, nowMs: t0, fetchImpl: releaseFetch });
    assert.equal(s1.ok, true);
    assert.equal(s1.status, 'update_available');
    assert.equal(s1.currentVersion, '1.2.0');
    assert.equal(s1.latestVersion, '1.3.0');
    assert.equal(s1.updateAvailable, true);
    assert.equal(s1.canSelfUpdate, true);
    assert.equal(s1.cached, false);
    assert.equal(calls, 1);

    // Within 6h TTL -> served from memory cache without calling fetch
    const s2 = await checkForUpdates({ pluginDir, cachePath, nowMs: t0 + 60_000, fetchImpl: releaseFetch });
    assert.equal(s2.cached, true);
    assert.equal(s2.latestVersion, '1.3.0');
    assert.equal(calls, 1);

    // Clear memory cache -> served from disk cache!
    resetUpdaterStateForTests();
    const s3 = await checkForUpdates({ pluginDir, cachePath, nowMs: t0 + 120_000, fetchImpl: releaseFetch });
    assert.equal(s3.cached, true);
    assert.equal(s3.latestVersion, '1.3.0');
    assert.equal(calls, 1);

    // Force bypasses cache
    const s4 = await checkForUpdates({ pluginDir, cachePath, nowMs: t0 + 120_000, force: true, fetchImpl: releaseFetch });
    assert.equal(s4.cached, false);
    assert.equal(calls, 2);

    // Fallback to tags when /releases/latest returns 404
    const tagFetch = async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/releases/latest')) return jsonResponse({ message: 'Not Found' }, 404);
      if (url.includes('/tags')) return jsonResponse([{ name: 'v1.1.0' }, { name: 'v1.4.0-rc.1' }, { name: 'v1.4.0' }]);
      return jsonResponse({}, 404);
    };
    const sTag = await checkForUpdates({ pluginDir, cachePath, force: true, fetchImpl: tagFetch });
    assert.equal(sTag.ok, true);
    assert.equal(sTag.latestVersion, '1.4.0');
    assert.equal(sTag.downloadUrl, 'https://github.com/skywalker512/agy-hud/archive/refs/tags/v1.4.0.tar.gz');

    // Fallback to raw main plugin.json when releases and tags are empty
    const manifestFetch = async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/releases/latest')) return jsonResponse({}, 404);
      if (url.includes('/tags')) return jsonResponse([]);
      if (url.includes('raw.githubusercontent.com')) return jsonResponse({ name: 'agy-hud', version: '1.5.0' });
      return jsonResponse({}, 404);
    };
    const sMan = await checkForUpdates({ pluginDir, cachePath, force: true, fetchImpl: manifestFetch });
    assert.equal(sMan.ok, true);
    assert.equal(sMan.latestVersion, '1.5.0');
    assert.equal(sMan.downloadUrl, 'https://github.com/skywalker512/agy-hud/archive/refs/heads/main.tar.gz');

    // Rate-limit handling (403 with x-ratelimit-remaining: 0)
    const rateLimitFetch = async () =>
      jsonResponse({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' });
    const sRate = await checkForUpdates({ pluginDir, cachePath, force: true, fetchImpl: rateLimitFetch });
    assert.equal(sRate.ok, false);
    assert.equal(sRate.status, 'rate_limited');
    assert.equal(sRate.latestVersion, '1.5.0'); // preserves previously cached version

    // Offline network error handling
    const offlineFetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const sOffline = await checkForUpdates({ pluginDir, cachePath, force: true, fetchImpl: offlineFetch });
    assert.equal(sOffline.ok, false);
    assert.equal(sOffline.status, 'offline');
  } finally {
    resetUpdaterStateForTests();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. applySelfUpdate: dev symlink guard, concurrency lock, tar.gz/zip upgrade, rollback
// ---------------------------------------------------------------------------

test('applySelfUpdate blocks in --link dev symlink mode', async () => {
  resetUpdaterStateForTests();
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-link-guard-'));
  try {
    const repoPlugin = join(root, 'repo-plugin');
    const linkTarget = join(root, 'installed-link');
    createPluginFixtureDir(repoPlugin, '1.2.0');
    symlinkSync(repoPlugin, linkTarget, process.platform === 'win32' ? 'junction' : 'dir');

    const insp = inspectInstallState({ pluginDir: linkTarget });
    assert.equal(insp.isLinked, true);

    const res = await applySelfUpdate({ pluginDir: linkTarget, cachePath: join(root, 'cache.json') });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'dev_symlink');
    assert.equal(res.previousVersion, '1.2.0');
    assert.equal(res.restartRequired, false);
  } finally {
    resetUpdaterStateForTests();
    rmSync(root, { recursive: true, force: true });
  }
});

test('applySelfUpdate upgrades cleanly via verified GitHub redirect, detects restartRequired vs uiReloadOnly, and locks concurrency', async () => {
  resetUpdaterStateForTests();
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-self-upgrade-'));
  try {
    const pluginDir = join(root, 'agy-hud');
    const cachePath = join(root, 'cache', 'update-cache.json');
    createPluginFixtureDir(pluginDir, '1.2.0');

    // Build v1.3.0 tar.gz with backend + UI changes
    const tarV130 = buildTarGz(buildPluginTarEntries('skywalker512-agy-hud-abc123/', '1.3.0'));

    let releaseDownloadResolver: () => void = () => {};
    const downloadStarted = new Promise<void>((r) => {
      releaseDownloadResolver = r;
    });
    let allowDownloadContinue: () => void = () => {};
    const downloadGate = new Promise<void>((r) => {
      allowDownloadContinue = r;
    });

    const mockFetch = async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/skywalker512/agy-hud/releases/latest') {
        return jsonResponse({
          tag_name: 'v1.3.0',
          html_url: 'https://github.com/skywalker512/agy-hud/releases/tag/v1.3.0',
          tarball_url: 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.3.0',
          assets: [],
        });
      }
      if (url === 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.3.0') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://codeload.github.com/skywalker512/agy-hud/legacy.tar.gz/v1.3.0' },
        });
      }
      if (url === 'https://codeload.github.com/skywalker512/agy-hud/legacy.tar.gz/v1.3.0') {
        releaseDownloadResolver();
        await downloadGate;
        return binaryResponse(tarV130, 200, { 'content-type': 'application/gzip' });
      }
      return jsonResponse({ message: 'unexpected url ' + url }, 404);
    };

    // Start first update and wait until it is in-flight
    const p1 = applySelfUpdate({ pluginDir, cachePath, fetchImpl: mockFetch });
    await downloadStarted;

    // Concurrent call must be rejected with in_progress
    const p2 = await applySelfUpdate({ pluginDir, cachePath, fetchImpl: mockFetch });
    assert.equal(p2.ok, false);
    assert.equal(p2.reason, 'in_progress');

    allowDownloadContinue();
    const r1 = await p1;
    assert.equal(r1.ok, true);
    assert.equal(r1.previousVersion, '1.2.0');
    assert.equal(r1.newVersion, '1.3.0');
    assert.equal(r1.restartRequired, true);
    assert.equal(JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8')).version, '1.3.0');
    assert.equal(existsSync(cachePath), false); // cache cleared after update

    // Now test ZIP upgrade with only UI changes -> uiReloadOnly: true, restartRequired: false
    const existingServer = readFileSync(join(pluginDir, 'sidecars', 'hud_panel', 'server.ts'), 'utf8');
    const existingConst = readFileSync(join(pluginDir, 'sidecars', 'hud_panel', 'lib', 'constants.ts'), 'utf8');
    const zipEntries = [
      { name: 'agy-hud/plugin.json', content: JSON.stringify({ name: 'agy-hud', displayName: 'AGY-HUD', version: '1.3.1' }) },
      { name: 'agy-hud/sidecars/hud_panel/sidecar.json', content: JSON.stringify({ command: 'node', args: ['server.ts'] }) },
      { name: 'agy-hud/sidecars/hud_panel/server.ts', content: existingServer },
      { name: 'agy-hud/sidecars/hud_panel/lib/constants.ts', content: existingConst },
      { name: 'agy-hud/sidecars/hud_panel/ui/index.html', content: '<!doctype html><title>UI 1.3.1</title>', compress: true },
      { name: 'agy-hud/sidecars/hud_panel/ui/app.js', content: 'console.log("1.3.1");', compress: true },
      { name: 'agy-hud/sidecars/hud_panel/ui/styles.css', content: 'body{color:#fff}', compress: true },
    ];
    // Note: plugin.json version changed, so hashBackendFiles includes plugin.json -> restartRequired true.
    // Verify ZIP extraction & upgrade works seamlessly:
    const zipV131 = buildZip(zipEntries);
    const zipFetch = async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/releases/latest')) {
        return jsonResponse({
          tag_name: 'v1.3.1',
          assets: [
            {
              name: 'agy-hud-1.3.1.zip',
              browser_download_url: 'https://github.com/skywalker512/agy-hud/releases/download/v1.3.1/agy-hud-1.3.1.zip',
            },
          ],
        });
      }
      if (url.includes('agy-hud-1.3.1.zip')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://objects.githubusercontent.com/github-production-release-asset/v1.3.1.zip' },
        });
      }
      if (url.includes('objects.githubusercontent.com')) {
        return binaryResponse(zipV131, 200);
      }
      return jsonResponse({}, 404);
    };

    const rZip = await applySelfUpdate({ pluginDir, cachePath, fetchImpl: zipFetch });
    assert.equal(rZip.ok, true);
    assert.equal(rZip.previousVersion, '1.3.0');
    assert.equal(rZip.newVersion, '1.3.1');
    assert.equal(rZip.restartRequired, false);
    assert.equal(rZip.uiReloadOnly, true);
    assert.ok(readFileSync(join(pluginDir, 'sidecars', 'hud_panel', 'ui', 'index.html'), 'utf8').includes('UI 1.3.1'));
  } finally {
    resetUpdaterStateForTests();
    rmSync(root, { recursive: true, force: true });
  }
});

test('applySelfUpdate rejects untrusted redirects, invalid payloads, and automatically rolls back on swap failure', async () => {
  resetUpdaterStateForTests();
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-rollback-'));
  try {
    const pluginDir = join(root, 'agy-hud');
    const cachePath = join(root, 'cache.json');
    createPluginFixtureDir(pluginDir, '1.2.0');

    // 1. Disallowed redirect target is blocked
    const evilRedirectFetch = async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/releases/latest')) {
        return jsonResponse({
          tag_name: 'v1.3.0',
          tarball_url: 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.3.0',
        });
      }
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil-cdn.example.com/payload.tar.gz' },
      });
    };
    const rEvil = await applySelfUpdate({ pluginDir, cachePath, fetchImpl: evilRedirectFetch });
    assert.equal(rEvil.ok, false);
    assert.equal(rEvil.reason, 'download_failed');
    assert.match(rEvil.message, /disallowed URL/i);
    assert.equal(JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8')).version, '1.2.0');

    // 2. Payload missing UI bundle is rejected before swap
    const missingUiTar = buildTarGz(buildPluginTarEntries('repo/', '1.3.0', { includeUi: false }));
    const missingUiFetch = async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/releases/latest')) {
        return jsonResponse({
          tag_name: 'v1.3.0',
          tarball_url: 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.3.0',
        });
      }
      return binaryResponse(missingUiTar, 200);
    };
    const rMissingUi = await applySelfUpdate({ pluginDir, cachePath, fetchImpl: missingUiFetch });
    assert.equal(rMissingUi.ok, false);
    assert.equal(rMissingUi.reason, 'invalid_payload');
    assert.equal(JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8')).version, '1.2.0');

    // 3. Simulated swap error automatically rolls back to v1.2.0
    const goodTar = buildTarGz(buildPluginTarEntries('repo/', '1.3.0'));
    const goodFetch = async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/releases/latest')) {
        return jsonResponse({
          tag_name: 'v1.3.0',
          tarball_url: 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.3.0',
        });
      }
      return binaryResponse(goodTar, 200);
    };
    const rFailSwap = await applySelfUpdate({
      pluginDir,
      cachePath,
      fetchImpl: goodFetch,
      beforeSwapHook: () => {
        throw new Error('Simulated EIO during atomic swap');
      },
    });
    assert.equal(rFailSwap.ok, false);
    assert.equal(rFailSwap.reason, 'swap_failed');
    assert.equal(rFailSwap.rolledBack, true);
    // Previous installation MUST be completely intact!
    assert.equal(JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8')).version, '1.2.0');
    assert.equal(validatePluginPayload(pluginDir).valid, true);
  } finally {
    resetUpdaterStateForTests();
    rmSync(root, { recursive: true, force: true });
  }
});
