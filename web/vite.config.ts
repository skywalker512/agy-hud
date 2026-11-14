import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

function sidecarHtmlTransform(): Plugin {
  return {
    name: 'agy-hud-sidecar-html',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        let out = html
          .replace(/<script\b[^>]*\bsrc="\/app\.js(?:\?[^"]*)?"[^>]*>\s*<\/script>\s*/gi, '')
          .replace(/(<link\b[^>]*?)\s+crossorigin(?:="[^"]*")?([^>]*>)/gi, '$1$2');

        if (!out.includes('/preload.js')) {
          out = out.replace(
            '<link rel="stylesheet"',
            '<script src="/preload.js"></script>\n  <link rel="stylesheet"',
          );
          if (!out.includes('/preload.js')) {
            out = out.replace('</head>', '  <script src="/preload.js"></script>\n</head>');
          }
        }

        if (!out.includes('src="/app.js"')) {
          out = out.replace('</body>', '  <script src="/app.js"></script>\n</body>');
        }

        return out;
      },
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [tailwindcss(), sidecarHtmlTransform()],
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
    outDir: resolve(__dirname, '../plugin/sidecars/hud_panel/ui'),
    emptyOutDir: false,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'AgyHudApp',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: (assetInfo) => {
          const isCss = assetInfo.names?.some((n) => n.endsWith('.css')) || assetInfo.name?.endsWith('.css');
          return isCss ? 'styles.css' : 'assets/[name][extname]';
        },
      },
    },
  },
});
