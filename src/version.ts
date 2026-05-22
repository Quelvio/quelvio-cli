import { createRequire } from 'node:module';

declare const __QUELVIO_CLI_VERSION__: string | undefined;

function readFromPackageJson(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    try {
      const require = createRequire(import.meta.url);
      const pkg = require('../../package.json') as { version: string };
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  }
}

export const VERSION: string =
  typeof __QUELVIO_CLI_VERSION__ === 'string' ? __QUELVIO_CLI_VERSION__ : readFromPackageJson();
