import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { build, context } from 'esbuild';

const options = {
  entryPoints: {
    background: 'src/background.ts',
    offscreen: 'src/offscreen.ts',
    popup: 'src/popup.ts',
    board: 'src/board.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  logLevel: 'info',
};

// Brand fonts ship inside the extension, so pages never load anything from the network.
// Both are under the SIL Open Font License, which travels with the files.
const FONTS = [
  ['@fontsource/poppins/files/poppins-latin-500-normal.woff2', 'poppins-500.woff2'],
  ['@fontsource/poppins/files/poppins-latin-600-normal.woff2', 'poppins-600.woff2'],
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter-variable.woff2'],
  ['@fontsource/poppins/LICENSE', 'Poppins-OFL.txt'],
  ['@fontsource-variable/inter/LICENSE', 'Inter-OFL.txt'],
];

await rm('dist', { recursive: true, force: true });
await cp('static', 'dist', { recursive: true });
await mkdir('dist/fonts', { recursive: true });
await Promise.all(FONTS.map(([from, to]) => copyFile(`node_modules/${from}`, `dist/fonts/${to}`)));

if (process.argv.includes('--watch')) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
