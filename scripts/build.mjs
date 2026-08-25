import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  outfile: 'dist/app.js',
  target: ['es2022'],
});
await cp('src/index.html', 'dist/index.html');
await cp('src/styles.css', 'dist/styles.css');
await cp('src/GUIDE.html', 'dist/GUIDE.html');
await cp('README.md', 'dist/README.md');
await writeFile('dist/.nojekyll', '');
console.log('Built dist/');
