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
import { getCommandName } from './lib/command-context.js';
import { writeFormattedError } from './output/error-formatter.js';
import {
  sendCommandCompleted,
  sendCommandCrash,
  sendCommandFailed,
} from './telemetry/telemetry.js';
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
  const commandName = getCommandName(argv);
  const start = Date.now();
  let code: number;
  let failure: unknown = null;
  try {
    await program.parseAsync([...argv]);
    const exitCode = process.exitCode;
    code = typeof exitCode === 'number' ? exitCode : 0;
  } catch (err) {
    failure = err;
    code = handleError(err);
  }
  notifyIfUpdateAvailable();
  emitTelemetry(commandName, start, code, failure);
  return code;
}

function emitTelemetry(
  commandName: string | null,
  startMs: number,
  exitCode: number,
  failure: unknown,
): void {
  if (!commandName) return;
  const duration_ms = Math.max(0, Date.now() - startMs);

  if (failure === null) {
    sendCommandCompleted({ command_name: commandName, duration_ms, exit_code: exitCode });
    return;
  }

  if (failure instanceof QuelvioError) {
    sendCommandFailed({
      command_name: commandName,
      duration_ms,
      exit_code: exitCode,
      error_class: failure.name,
      error_message: failure.message,
    });
    return;
  }

  if (failure && typeof failure === 'object' && 'code' in failure) {
    const code = (failure as { code?: string }).code;
    if (
      code === 'commander.help' ||
      code === 'commander.helpDisplayed' ||
      code === 'commander.version'
    ) {
      return;
    }
  }

  const err = failure as { name?: string; message?: string; constructor?: { name?: string } };
  const error_class =
    err && typeof err.name === 'string' && err.name.length > 0
      ? err.name
      : (err?.constructor?.name ?? 'Error');
  const error_message =
    err && typeof err.message === 'string' && err.message.length > 0
      ? err.message
      : String(failure);
  sendCommandCrash({
    command_name: commandName,
    duration_ms,
    exit_code: exitCode,
    error_class,
    error_message,
  });
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
