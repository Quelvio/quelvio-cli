import { Command } from 'commander';
import { registerConfigCommand } from './commands/config.js';
import { registerDomainsCommand } from './commands/domains.js';
import { registerQueryCommand } from './commands/query.js';
import { registerSourceCommand } from './commands/source.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { AuthError, QuelvioError, RateLimitError } from './errors.js';
import { formatError } from './output/formatters.js';
import { VERSION } from './version.js';

function isVerbose(): boolean {
  return process.argv.includes('--verbose');
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('quelvio')
    .description('Quelvio command-line interface — query your enterprise knowledge brain')
    .version(VERSION, '-v, --version', 'output the current version');

  registerQueryCommand(program);
  registerDomainsCommand(program);
  registerSourceCommand(program);
  registerWhoamiCommand(program);
  registerConfigCommand(program);

  return program;
}

export async function runAsync(argv: readonly string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync([...argv]);
    const code = process.exitCode;
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    return handleError(err);
  }
}

export function run(argv: readonly string[]): void {
  runAsync(argv).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.exitCode = handleError(err);
    },
  );
}

function handleError(err: unknown): number {
  if (err instanceof QuelvioError) {
    process.stderr.write(`${formatError(err)}\n`);
    if (err instanceof AuthError && err.backendDetail && isVerbose()) {
      process.stderr.write(`debug: backend response: ${err.backendDetail}\n`);
    }
    if (err instanceof RateLimitError && err.retryAfterSeconds !== null) {
      process.stderr.write(`hint: retry in ${err.retryAfterSeconds}s\n`);
    }
    return err.exitCode;
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (
      code === 'commander.help' ||
      code === 'commander.helpDisplayed' ||
      code === 'commander.version'
    ) {
      return 0;
    }
    if (
      code === 'commander.unknownCommand' ||
      code === 'commander.missingArgument' ||
      code === 'commander.invalidArgument'
    ) {
      const msg = (err as { message?: unknown }).message;
      process.stderr.write(`${typeof msg === 'string' ? msg : String(err)}\n`);
      return 1;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);
  return 1;
}
