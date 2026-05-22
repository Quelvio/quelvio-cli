import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: false,
  bundle: true,
  shims: false,
  treeshake: true,
  external: ['keytar'],
  define: {
    __QUELVIO_CLI_VERSION__: JSON.stringify(pkg.version),
  },
});
