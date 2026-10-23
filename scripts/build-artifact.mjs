// Bundles the game into one self-contained HTML fragment (title, style, canvas, script) for publishing
// as a Claude Artifact, which wraps it in its own document skeleton. Output: dist/artifact.html
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

// The baked textures (assets/textures/*.webp) go in as data URIs, because one file cannot fetch them. If the folder is empty
// or NO_TEXTURES=1 is set, src/textures-inline.js stays the stub (null) and the Artifact plays on the generated textures.
const texFiles = process.env.NO_TEXTURES ? [] : (await readdir('assets/textures').catch(() => [])).filter((f) => f.endsWith('.webp')).sort();
const inline = {};
for (const f of texFiles) inline[f] = `data:image/webp;base64,${(await readFile(`assets/textures/${f}`)).toString('base64')}`;
const inlineTextures = {
  name: 'inline-textures',
  setup(b) {
    b.onLoad({ filter: /textures-inline\.js$/ }, () => ({ contents: `export default ${texFiles.length ? JSON.stringify(inline) : 'null'};`, loader: 'js' }));
  },
};

const { outputFiles } = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  define: { __ARTIFACT__: 'true', 'import.meta.url': '""' },
  plugins: [inlineTextures],
});
const js = outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const css = (await readFile('src/style.css', 'utf8')).replace(/^:root \{[^}]*\}\n/m, '');
const html = `<title>Naebun's Last Set</title>
<style>
:root { --bg: #050309; color-scheme: dark; }
html, body { background: var(--bg); }
${css}</style>
<div id="loading">LOADING</div>
<canvas id="gl"></canvas>
<canvas id="game"></canvas>
<script>${js}</script>
`;
await mkdir('dist', { recursive: true });
await writeFile('dist/artifact.html', html);
console.log(`dist/artifact.html  ${(html.length / 1024).toFixed(1)} KB, ${texFiles.length} baked texture files inlined (${(Object.values(inline).join('').length / 1024).toFixed(0)} KB as base64)`);
