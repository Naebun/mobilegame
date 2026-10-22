// Bundles the game into one self-contained HTML fragment (title, style, canvas, script) for publishing
// as a Claude Artifact, which wraps it in its own document skeleton. Output: dist/artifact.html
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { outputFiles } = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  define: { __ARTIFACT__: 'true' },
});
const js = outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const css = (await readFile('src/style.css', 'utf8')).replace(/^:root \{[^}]*\}\n/m, '');
const html = `<title>Freddie's Last Set</title>
<style>
:root { --bg: #050309; color-scheme: dark; }
html, body { background: var(--bg); }
${css}</style>
<canvas id="game"></canvas>
<script>${js}</script>
`;
await mkdir('dist', { recursive: true });
await writeFile('dist/artifact.html', html);
console.log(`dist/artifact.html  ${(html.length / 1024).toFixed(1)} KB`);
