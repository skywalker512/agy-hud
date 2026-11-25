import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_HUD_UI_DIR = path.resolve(__dirname, '../plugin/sidecars/hud_panel/ui');
const DEMO_HUD_DIR = path.resolve(__dirname, 'public/hud-demo');
const DIST_DEMO_HUD_DIR = path.resolve(__dirname, 'dist/hud-demo');

function syncRealHudBundle(): void {
  if (!fs.existsSync(REAL_HUD_UI_DIR)) return;
  fs.mkdirSync(DEMO_HUD_DIR, { recursive: true });
  for (const file of ['app.js', 'styles.css']) {
    const src = path.join(REAL_HUD_UI_DIR, file);
    const dst = path.join(DEMO_HUD_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }
}

function syncRealHudPlugin(): Plugin {
  return {
    name: 'sync-real-hud-bundle',
    buildStart() {
      syncRealHudBundle();
    },
    configureServer() {
      syncRealHudBundle();
    },
    async closeBundle() {
      // Minify demo-fixture.js & demo-bridge.js in dist/ while keeping public/ sources readable
      for (const file of ['demo-fixture.js', 'demo-bridge.js']) {
        const distPath = path.join(DIST_DEMO_HUD_DIR, file);
        if (!fs.existsSync(distPath)) continue;
        const raw = fs.readFileSync(distPath, 'utf8');
        const out = await transformWithEsbuild(raw, distPath, {
          loader: 'js',
          minify: true,
          target: 'es2022',
        });
        fs.writeFileSync(distPath, out.code, 'utf8');
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [syncRealHudPlugin(), tailwindcss()],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        pulse: path.resolve(__dirname, 'pulse/index.html'),
      },
    },
  },
});
