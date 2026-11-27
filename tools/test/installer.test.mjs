import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  isAllowedDownloadUrl,
  parseCliArgs,
  runCheckUpdate,
  runDoctor,
  runInstall,
  runUninstall,
  runUpdate,
} from '../../plugin/install.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..', '..');
const INSTALLER_CLI = join(REPO_ROOT, 'plugin', 'install.mjs');

function createTarHeader(name, size, typeFlag = '0') {
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

function buildTarGz(entries) {
  const chunks = [];
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
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks));
}

function createFakePluginSource(dir, version = '1.2.0', { includeUi = true } = {}) {
  mkdirSync(join(dir, 'sidecars', 'hud_panel', 'lib'), { recursive: true });
  mkdirSync(join(dir, 'sidecars', 'hud_panel', 'test'), { recursive: true });
  mkdirSync(join(dir, 'sidecars', 'hud_panel', 'ui'), { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({ name: 'agy-hud', displayName: 'AGY-HUD', version }, null, 2),
    'utf8',
  );
  writeFileSync(join(dir, 'install.mjs'), '// should be excluded from staged copy\n', 'utf8');
  writeFileSync(
    join(dir, 'sidecars', 'hud_panel', 'sidecar.json'),
    JSON.stringify({ command: 'node', args: ['server.ts'] }, null, 2),
    'utf8',
  );
  writeFileSync(join(dir, 'sidecars', 'hud_panel', 'server.ts'), `export const v = '${version}';\n`, 'utf8');
  writeFileSync(join(dir, 'sidecars', 'hud_panel', 'tsconfig.json'), '{}', 'utf8');
  writeFileSync(join(dir, 'sidecars', 'hud_panel', 'test', 'dummy.test.ts'), '// skipped\n', 'utf8');
  if (includeUi) {
    writeFileSync(join(dir, 'sidecars', 'hud_panel', 'ui', 'index.html'), `<!doctype html><title>${version}</title>`, 'utf8');
    writeFileSync(join(dir, 'sidecars', 'hud_panel', 'ui', 'app.js'), `console.log('${version}');`, 'utf8');
    writeFileSync(join(dir, 'sidecars', 'hud_panel', 'ui', 'styles.css'), `body{opacity:1}`, 'utf8');
  }
}

function buildReleaseTarGz(version) {
  return buildTarGz([
    { name: `skywalker512-agy-hud-${version}/plugin/plugin.json`, content: JSON.stringify({ name: 'agy-hud', version }) },
    { name: `skywalker512-agy-hud-${version}/plugin/install.mjs`, content: '// excluded' },
    {
      name: `skywalker512-agy-hud-${version}/plugin/sidecars/hud_panel/sidecar.json`,
      content: JSON.stringify({ command: 'node', args: ['server.ts'] }),
    },
    {
      name: `skywalker512-agy-hud-${version}/plugin/sidecars/hud_panel/server.ts`,
      content: `export const version = '${version}';\n`,
    },
    {
      name: `skywalker512-agy-hud-${version}/plugin/sidecars/hud_panel/ui/index.html`,
      content: `<!doctype html><title>AGY-HUD ${version}</title>`,
    },
    { name: `skywalker512-agy-hud-${version}/plugin/sidecars/hud_panel/ui/app.js`, content: `console.log('${version}');` },
    { name: `skywalker512-agy-hud-${version}/plugin/sidecars/hud_panel/ui/styles.css`, content: `body{margin:0}` },
  ]);
}

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('parseCliArgs handles all flags, custom --target, conflicts, and unknown options', () => {
  assert.equal(parseCliArgs([]).command, 'install');
  assert.equal(parseCliArgs(['--install', '--target', '/tmp/a']).targetDir, '/tmp/a');
  assert.equal(parseCliArgs(['--doctor', '--target=/tmp/b', '--json']).json, true);
  assert.equal(parseCliArgs(['--doctor', '--target=/tmp/b', '--json']).targetDir, '/tmp/b');
  assert.equal(parseCliArgs(['--update', '--force', '--ref', 'v1.3.0']).force, true);
  assert.equal(parseCliArgs(['--update', '--force', '--ref', 'v1.3.0']).versionTag, 'v1.3.0');
  assert.equal(parseCliArgs(['--statusline', '--two-line', '--stack', '--settings', '/tmp/s.json']).command, 'statusline');
  assert.equal(parseCliArgs(['--statusline', '--two-line', '--stack', '--settings', '/tmp/s.json']).twoLine, true);
  assert.equal(parseCliArgs(['--statusline', '--two-line', '--stack', '--settings', '/tmp/s.json']).stackWithDefault, true);
  assert.equal(parseCliArgs(['--statusline', '--two-line', '--stack', '--settings', '/tmp/s.json']).settingsPath, '/tmp/s.json');
  assert.equal(parseCliArgs(['--uninstall-statusline', '--force']).command, 'uninstall-statusline');
  assert.ok(parseCliArgs(['--link', '--uninstall']).error);
  assert.ok(parseCliArgs(['--bogus']).error);
  assert.ok(parseCliArgs(['--target']).error);
});

test('runInstall stages cleanly, skips dev files, rejects missing UI when --no-build, and supports --link & --uninstall', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-inst-test-'));
  try {
    const srcDir = join(root, 'src-plugin');
    const targetDir = join(root, 'plugins', 'agy-hud');
    createFakePluginSource(srcDir, '1.2.0', { includeUi: true });

    // Staged install
    const r1 = runInstall({ sourceDir: srcDir, targetDir });
    assert.equal(r1.ok, true);
    assert.equal(r1.version, '1.2.0');
    assert.equal(existsSync(join(targetDir, 'plugin.json')), true);
    assert.equal(existsSync(join(targetDir, 'sidecars', 'hud_panel', 'ui', 'index.html')), true);
    // Dev/build-only files must be excluded from staged copy
    assert.equal(existsSync(join(targetDir, 'install.mjs')), false);
    assert.equal(existsSync(join(targetDir, 'sidecars', 'hud_panel', 'test')), false);
    assert.equal(existsSync(join(targetDir, 'sidecars', 'hud_panel', 'tsconfig.json')), false);

    // Source missing UI fails cleanly when no web/ repo exists
    const noUiSrc = join(root, 'src-no-ui');
    createFakePluginSource(noUiSrc, '1.2.0', { includeUi: false });
    const rMissing = runInstall({ sourceDir: noUiSrc, targetDir: join(root, 'plugins', 'missing-ui'), allowBuild: false });
    assert.equal(rMissing.ok, false);
    assert.match(rMissing.message, /Missing pre-built UI/i);

    // Link mode creates symlink/junction
    const linkTarget = join(root, 'plugins', 'agy-hud-link');
    const rLink = runInstall({ sourceDir: srcDir, targetDir: linkTarget, link: true });
    assert.equal(rLink.ok, true);
    assert.equal(lstatSync(linkTarget).isSymbolicLink(), true);

    // Uninstall removes symlink without harming source directory
    const rUnlink = runUninstall({ targetDir: linkTarget });
    assert.equal(rUnlink.ok, true);
    assert.equal(rUnlink.removed, true);
    assert.equal(rUnlink.wasLink, true);
    assert.equal(existsSync(linkTarget), false);
    assert.equal(existsSync(join(srcDir, 'plugin.json')), true);

    // Uninstall staged install
    const rUninstall = runUninstall({ targetDir });
    assert.equal(rUninstall.ok, true);
    assert.equal(rUninstall.removed, true);
    assert.equal(existsSync(targetDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runDoctor reports missing vs healthy installation and detects synthetic Antigravity data dirs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-doctor-test-'));
  try {
    const fakeHome = join(root, 'home');
    const agyData = join(fakeHome, '.gemini', 'antigravity', 'conversations');
    mkdirSync(agyData, { recursive: true });

    const targetDir = join(root, 'plugins', 'agy-hud');
    const before = await runDoctor({ targetDir, homeDir: fakeHome, env: { PATH: '' } });
    assert.equal(before.ok, false);
    assert.equal(before.checks.find((c) => c.id === 'plugin_install')?.status, 'fail');
    assert.equal(before.checks.find((c) => c.id === 'ui_bundle')?.status, 'fail');
    assert.equal(before.checks.find((c) => c.id === 'node')?.status, 'pass');
    assert.equal(before.checks.find((c) => c.id === 'antigravity_data')?.status, 'pass');

    // Install real plugin from repo into temp targetDir and re-run doctor
    const inst = runInstall({ targetDir });
    assert.equal(inst.ok, true);

    const after = await runDoctor({ targetDir, homeDir: fakeHome, env: { PATH: '' } });
    assert.equal(after.ok, true);
    assert.equal(after.checks.find((c) => c.id === 'plugin_install')?.status, 'pass');
    assert.equal(after.checks.find((c) => c.id === 'ui_bundle')?.status, 'pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runCheckUpdate and runUpdate enforce symlink guard, URL allowlist, zip-slip protection, and atomic rollback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-update-cli-'));
  try {
    const srcDir = join(root, 'src-v120');
    const targetDir = join(root, 'plugins', 'agy-hud');
    createFakePluginSource(srcDir, '1.2.0');

    // Link mode first
    runInstall({ sourceDir: srcDir, targetDir, link: true });
    assert.equal(lstatSync(targetDir).isSymbolicLink(), true);

    // --update refuses to overwrite dev symlink without --force
    const blocked = await runUpdate({ targetDir, force: false });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'dev_symlink');
    assert.equal(lstatSync(targetDir).isSymbolicLink(), true);

    // Mock GitHub API + verified redirect to codeload.github.com
    const tarV130 = buildReleaseTarGz('1.3.0');
    const mockFetch = async (input) => {
      const url = String(input);
      if (url.includes('/releases/latest')) {
        return jsonResp({
          tag_name: 'v1.3.0',
          html_url: 'https://github.com/skywalker512/agy-hud/releases/tag/v1.3.0',
          tarball_url: 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.3.0',
          assets: [],
        });
      }
      if (url.includes('/tarball/v1.3.0')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://codeload.github.com/skywalker512/agy-hud/legacy.tar.gz/v1.3.0' },
        });
      }
      if (url.includes('codeload.github.com')) {
        return new Response(tarV130, { status: 200 });
      }
      return jsonResp({}, 404);
    };

    const chk = await runCheckUpdate({ targetDir, fetchImpl: mockFetch });
    assert.equal(chk.ok, true);
    assert.equal(chk.updateAvailable, true);
    assert.equal(chk.currentVersion, '1.2.0');
    assert.equal(chk.latestVersion, '1.3.0');

    // With --force, replaces dev symlink cleanly with v1.3.0 staged install
    const forced = await runUpdate({ targetDir, force: true, fetchImpl: mockFetch });
    assert.equal(forced.ok, true);
    assert.equal(forced.newVersion, '1.3.0');
    assert.equal(lstatSync(targetDir).isSymbolicLink(), false);
    assert.equal(JSON.parse(readFileSync(join(targetDir, 'plugin.json'), 'utf8')).version, '1.3.0');

    // Zip-slip archive is rejected without altering existing v1.3.0 install
    const evilTar = buildTarGz([{ name: 'repo/../../evil.txt', content: 'pwn' }]);
    const evilFetch = async (input) => {
      if (String(input).includes('/releases/latest')) {
        return jsonResp({
          tag_name: 'v1.4.0',
          tarball_url: 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.4.0',
        });
      }
      return new Response(evilTar, { status: 200 });
    };
    const rEvil = await runUpdate({ targetDir, fetchImpl: evilFetch });
    assert.equal(rEvil.ok, false);
    assert.equal(rEvil.reason, 'extract_failed');
    assert.equal(JSON.parse(readFileSync(join(targetDir, 'plugin.json'), 'utf8')).version, '1.3.0');

    // Simulated swap failure rolls back automatically to v1.3.0
    const tarV140 = buildReleaseTarGz('1.4.0');
    const v140Fetch = async (input) => {
      if (String(input).includes('/releases/latest')) {
        return jsonResp({
          tag_name: 'v1.4.0',
          tarball_url: 'https://api.github.com/repos/skywalker512/agy-hud/tarball/v1.4.0',
        });
      }
      return new Response(tarV140, { status: 200 });
    };
    const rRollback = await runUpdate({
      targetDir,
      fetchImpl: v140Fetch,
      beforeSwapHook: () => {
        throw new Error('Simulated rename failure');
      },
    });
    assert.equal(rRollback.ok, false);
    assert.equal(rRollback.reason, 'swap_failed');
    assert.equal(rRollback.rolledBack, true);
    assert.equal(JSON.parse(readFileSync(join(targetDir, 'plugin.json'), 'utf8')).version, '1.3.0');

    // URL allowlist sanity
    assert.equal(isAllowedDownloadUrl('https://evil.example.com/skywalker512/agy-hud/a.tar.gz'), false);
    assert.equal(isAllowedDownloadUrl('https://github.com/skywalker512/agy-hud/archive/refs/tags/v1.3.0.tar.gz'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI subprocess end-to-end: --install, --doctor --json, --uninstall on isolated --target', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-cli-e2e-'));
  try {
    const targetDir = join(root, 'custom-plugin-dir');

    const installOut = execFileSync(process.execPath, [INSTALLER_CLI, '--install', '--target', targetDir], {
      encoding: 'utf8',
    });
    assert.match(installOut, /Installed agy-hud/i);

    const doctorJsonRaw = execFileSync(
      process.execPath,
      [INSTALLER_CLI, '--doctor', '--target', targetDir, '--json'],
      { encoding: 'utf8' },
    );
    const doctorJson = JSON.parse(doctorJsonRaw);
    assert.equal(doctorJson.ok, true);
    assert.equal(doctorJson.targetDir, targetDir);
    assert.equal(existsSync(join(targetDir, 'sidecars', 'hud_panel', 'statusline.ts')), true);
    assert.equal(existsSync(join(targetDir, 'skills', 'agy-hud', 'SKILL.md')), true);
    assert.equal(existsSync(join(targetDir, 'skills', 'agy-hud', 'scripts', 'inspect.mjs')), true);

    const settingsPath = join(root, 'antigravity-cli', 'settings.json');
    const slInstallRaw = execFileSync(
      process.execPath,
      [INSTALLER_CLI, '--statusline', '--target', targetDir, '--settings', settingsPath, '--json'],
      { encoding: 'utf8' },
    );
    const slInstall = JSON.parse(slInstallRaw);
    assert.equal(slInstall.ok, true);
    assert.equal(slInstall.action, 'configured');
    assert.match(slInstall.command, /statusline\.ts/);

    const slRemoveRaw = execFileSync(
      process.execPath,
      [INSTALLER_CLI, '--uninstall-statusline', '--target', targetDir, '--settings', settingsPath, '--json'],
      { encoding: 'utf8' },
    );
    const slRemove = JSON.parse(slRemoveRaw);
    assert.equal(slRemove.ok, true);
    assert.equal(slRemove.action, 'removed');

    const uninstallOut = execFileSync(process.execPath, [INSTALLER_CLI, '--uninstall', '--target', targetDir], {
      encoding: 'utf8',
    });
    assert.match(uninstallOut, /Removed agy-hud/i);
    assert.equal(existsSync(targetDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
