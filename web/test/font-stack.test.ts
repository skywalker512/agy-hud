import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHudFontStack } from '../src/utils/fontStack.ts';

test('buildHudFontStack preserves official Antigravity Hub google-sans + system-ui order and appends CJK before sans-serif', () => {
  const input =
    '"Google Sans Flex", "Google Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const out = buildHudFontStack(input, 'sans');

  assert.ok(out.startsWith('"Google Sans Flex", "Google Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"'));
  const idxSystemUi = out.indexOf('system-ui');
  const idxSegoe = out.indexOf('"Segoe UI"');
  const idxPingFang = out.indexOf('"PingFang SC"');
  const idxYaHeiUi = out.indexOf('"Microsoft YaHei UI"');
  const idxSans = out.indexOf('sans-serif');

  assert.ok(idxSystemUi > 0 && idxSegoe > idxSystemUi, 'Matches official Hub: Google Sans Flex -> system-ui -> Segoe UI');
  assert.ok(idxPingFang > idxSegoe && idxYaHeiUi > idxPingFang, 'CJK safety net follows named Latin fonts');
  assert.ok(idxSans > idxYaHeiUi, 'CJK safety net precedes generic sans-serif');
});

test('buildHudFontStack preserves system-ui lead for Antigravity --vscode-font-family', () => {
  const input =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  const out = buildHudFontStack(input, 'sans');

  assert.ok(out.startsWith('system-ui, -apple-system'));
  assert.ok(out.indexOf("'Segoe UI'") < out.indexOf('"Microsoft YaHei UI"'));
  assert.ok(out.indexOf('"Microsoft YaHei UI"') < out.indexOf('sans-serif'));
});

test('buildHudFontStack injects CJK fallbacks before ui-monospace/monospace for editor mono stacks', () => {
  const input =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  const out = buildHudFontStack(input, 'mono');

  assert.ok(out.indexOf('Consolas') >= 0);
  assert.ok(out.indexOf('Consolas') < out.indexOf('"Microsoft YaHei UI"'));
  assert.ok(out.indexOf('"Microsoft YaHei UI"') < out.indexOf('ui-monospace'));
  assert.ok(out.indexOf('ui-monospace') < out.indexOf('monospace'));
});

test('buildHudFontStack handles generic-only stacks cleanly', () => {
  const sans = buildHudFontStack('system-ui, sans-serif', 'sans');
  assert.ok(sans.startsWith('system-ui'));
  assert.ok(sans.indexOf('"Segoe UI"') >= 0);
  assert.ok(sans.indexOf('"Microsoft YaHei UI"') < sans.indexOf('sans-serif'));

  const mono = buildHudFontStack('monospace', 'mono');
  assert.ok(mono.indexOf('Consolas') >= 0);
  assert.ok(mono.indexOf('Consolas') < mono.indexOf('"Microsoft YaHei UI"'));
  assert.ok(mono.indexOf('"Microsoft YaHei UI"') < mono.indexOf('monospace'));
});

test('buildHudFontStack preserves user-configured CJK fonts unchanged', () => {
  const custom = '"Maple Mono NF CN", "JetBrains Mono", monospace';
  assert.equal(buildHudFontStack(custom, 'mono'), custom);

  const customSans = '"Inter", "Microsoft YaHei UI", sans-serif';
  assert.equal(buildHudFontStack(customSans, 'sans'), customSans);
});

test('buildHudFontStack returns empty string for empty or unresolved var() input', () => {
  assert.equal(buildHudFontStack('', 'sans'), '');
  assert.equal(buildHudFontStack('var(--vscode-font-family, sans-serif)', 'sans'), '');
});
