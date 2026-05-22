import { Command } from 'commander';
import { registerCompletionCommand } from './commands/completion.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDomainsCommand } from './commands/domains.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerQueryCommand } from './commands/query.js';
import { registerSourceCommand } from './commands/source.js';
import { registerWhoamiCommand } from './commands/whoami.js';
import { QuelvioError } from './errors.js';
import { writeFormattedError } from './output/error-formatter.js';
import { notifyIfUpdateAvailable, queueUpdateCheck } from './update-check.js';
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

  registerLoginCommand(program);
  registerLogoutCommand(program);
  registerQueryCommand(program);
  registerDomainsCommand(program);
  registerSourceCommand(program);
  registerWhoamiCommand(program);
  registerConfigCommand(program);
  registerCompletionCommand(program);

  return program;
}

export async function runAsync(argv: readonly string[]): Promise<number> {
  queueUpdateCheck(VERSION);
  const program = buildProgram();
  let code: number;
  try {
    await program.parseAsync([...argv]);
    const exitCode = process.exitCode;
    code = typeof exitCode === 'number' ? exitCode : 0;
  } catch (err) {
    code = handleError(err);
  }
  notifyIfUpdateAvailable();
  return code;
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
    return writeFormattedError(err, isVerbose());
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
  return writeFormattedError(err, isVerbose());
}
