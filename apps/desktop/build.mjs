// Bundles the Aura Mac app with esbuild into dist/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };

await Promise.all([
  // Main process and the speech worker run in Node inside Electron.
  build({
    ...common,
    entryPoints: { main: 'src/main/main.ts', 'stt-worker': 'src/main/stt-worker.ts' },
    outdir: 'dist',
    platform: 'node',
    format: 'cjs',
    // Electron is provided at runtime; transformers.js ships native code, so it loads from node_modules.
    external: ['electron', '@huggingface/transformers'],
  }),
  build({
    ...common,
    entryPoints: { preload: 'src/preload/preload.ts' },
    outdir: 'dist',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  // The pages run in a sandboxed browser window.
  build({
    ...common,
    entryPoints: { orb: 'src/renderer/orb.ts', dashboard: 'src/renderer/dashboard.ts' },
    outdir: 'dist/renderer',
    platform: 'browser',
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
  }),
]);

for (const file of ['orb.html', 'orb.css', 'dashboard.html', 'dashboard.css']) {
  cpSync(`src/renderer/${file}`, `dist/renderer/${file}`);
}
cpSync('assets/porcupine', 'dist/renderer/porcupine', { recursive: true });

if (watch) console.log('Watch mode is not supported; run `npm run build` again after changes.');
