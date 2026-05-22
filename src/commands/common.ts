import type { Command } from 'commander';
import { ApiClient } from '../api/client.js';
import { type AuthMethod, resolveToken } from '../auth/token-resolver.js';
import { setColorMode } from '../output/colors.js';

export type CommonOpts = {
  token?: string;
  json?: boolean;
  noColor?: boolean;
  verbose?: boolean;
  quiet?: boolean;
};

export function addCommonOpts(cmd: Command): Command {
  return cmd
    .option('--token <token>', 'override token resolution (highest precedence)')
    .option('--json', 'output raw API response as JSON')
    .option('--no-color', 'suppress ANSI colors')
    .option('--verbose', 'print HTTP debug traces to stderr')
    .option('--quiet', 'suppress non-essential output');
}

export function applyColorFlag(opts: CommonOpts): void {
  if (opts.noColor) {
    setColorMode('never');
  }
}

export async function buildClient(opts: CommonOpts): Promise<{
  client: ApiClient;
  token: string;
  tokenSource: string;
  authMethod: AuthMethod;
}> {
  applyColorFlag(opts);
  const resolved = await resolveToken({
    flagToken: opts.token,
    ...(opts.verbose ? { verbose: true } : {}),
  });
  const debug = opts.verbose ? (line: string) => process.stderr.write(`${line}\n`) : undefined;
  const client = new ApiClient({
    token: resolved.token,
    debug,
  });
  return {
    client,
    token: resolved.token,
    tokenSource: resolved.source,
    authMethod: resolved.authMethod,
  };
}

export function emitJson(value: unknown): void {
  const pretty = Boolean(process.stdout.isTTY);
  process.stdout.write(`${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`);
}
