#!/usr/bin/env node
/**
 * Bundled skill helper for `/agy-hud`.
 * Delegates cleanly to `../../../sidecars/hud_panel/statusline.ts` using Node's
 * native TypeScript stripping (Node.js >= 22.18, zero external dependencies).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const scriptDir = dirname(realpathSync(__filename));
const target = resolve(scriptDir, '..', '..', '..', 'sidecars', 'hud_panel', 'statusline.ts');

if (!existsSync(target)) {
  console.error(`[agy-hud] Missing sidecar script at ${target}`);
  process.exit(1);
}

try {
  execFileSync(process.execPath, [target, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
} catch (err) {
  process.exit(typeof err?.status === 'number' ? err.status : 1);
}
