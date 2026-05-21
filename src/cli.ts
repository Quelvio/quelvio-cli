import { createRequire } from 'node:module';
import { Command } from 'commander';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('quelvio')
    .description('Quelvio command-line interface')
    .version(pkg.version, '-v, --version', 'output the current version');

  return program;
}

export function run(argv: readonly string[]): void {
  const program = buildProgram();
  program.parse([...argv]);
}
