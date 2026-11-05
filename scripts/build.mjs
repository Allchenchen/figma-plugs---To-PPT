import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
mkdirSync(dist, { recursive: true });

const watch = process.argv.includes('--watch');

const codeOpts = {
  bundle: true,
  target: 'es2020',
  logLevel: 'info',
  entryPoints: [resolve(root, 'src/code.ts')],
  outfile: resolve(dist, 'code.js'),
  platform: 'browser',
  format: 'iife',
};

// UI is bundled with pptxgenjs inlined (its `browser` field stubs node builtins),
// then the JS is injected into ui.html — no CDN, fully local.
const uiOpts = {
  bundle: true,
  target: 'es2020',
  logLevel: 'info',
  entryPoints: [resolve(root, 'src/ui.ts')],
  platform: 'browser',
  format: 'iife',
  write: false,
  plugins: [
    {
      name: 'inline-ui-html',
      setup(b) {
        b.onEnd((result) => {
          const out = result.outputFiles?.[0];
          if (!out) return;
          const html = readFileSync(resolve(root, 'src/ui.html'), 'utf8');
          const injected = html.replace('<!-- UI_BUNDLE -->', `<script>${out.text}</script>`);
          writeFileSync(resolve(dist, 'ui.html'), injected);
          console.log('[build] dist/ui.html written');
        });
      },
    },
  ],
};

if (watch) {
  const ctxCode = await context(codeOpts);
  const ctxUi = await context(uiOpts);
  await ctxCode.watch();
  await ctxUi.watch();
  console.log('[build] watching src/** → dist/');
} else {
  await build(codeOpts);
  await build(uiOpts);
  console.log('[build] done → dist/code.js, dist/ui.html');
}
