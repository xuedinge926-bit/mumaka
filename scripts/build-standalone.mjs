/**
 * Build a single HTML file that opens directly in a browser without Node or a
 * web server. Run `npm run build` first to compile Tailwind, then:
 * node scripts/build-standalone.mjs [output-file.html]
 */
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || resolve(root, 'standalone/新乐评主义.html'));
// Only the public endpoint is embedded. Never copy service credentials from env.
const env = loadEnv('production', root, 'VITE_');
const proxyUrl = process.env.VITE_SPOTIFY_PROXY_URL || env.VITE_SPOTIFY_PROXY_URL || '';
const assetDirectory = resolve(root, 'dist/assets');
const cssFiles = (await readdir(assetDirectory)).filter(name => name.endsWith('.css')).sort();
if (!cssFiles.length) throw new Error('找不到生产样式，请先运行 npm run build。');
const css = (await Promise.all(cssFiles.map(name => readFile(resolve(assetDirectory, name), 'utf8')))).join('\n');

const bundled = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  bundle: true,
  splitting: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
  write: false,
  loader: { '.css': 'empty' },
  define: {
    'process.env.NODE_ENV': '"production"',
    // Explicit public fields only; supports optional-chain access too.
    // The HTML contains every asset, so it does not register a file:// worker.
    'import.meta.env': JSON.stringify({ PROD: false, DEV: false, VITE_SPOTIFY_PROXY_URL: proxyUrl }),
  },
});
const javascript = bundled.outputFiles[0].text;
const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="theme-color" content="#244c40">
<meta name="description" content="新乐评主义：本地优先、人工主导的六维专辑评价工作台">
<title>MUMAKA / 木马卡 · 新乐评主义</title>
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
</head><body><div id="root"></div>
<script>${javascript.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>\n`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Self-contained HTML: ${output} (${Buffer.byteLength(html)} bytes)`);
