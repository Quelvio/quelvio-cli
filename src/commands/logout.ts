import type { Command } from 'commander';
import { resolveBaseUrl } from '../api/client.js';
import { revokeToken } from '../auth/device-flow.js';
import { deleteStoredAuth, getStoredAuth } from '../auth/keychain.js';

export type LogoutOpts = {
  verbose?: boolean;
};

export type LogoutDeps = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
};

export async function runLogout(opts: LogoutOpts, deps: LogoutDeps = {}): Promise<void> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const entry = await getStoredAuth();
  if (!entry) {
    stdout.write('Not logged in.\n');
    return;
  }
  if (entry.source === 'oauth') {
    const baseUrl = deps.baseUrl ?? resolveBaseUrl();
    try {
      if (entry.refresh_token) {
        await revokeToken({
          baseUrl,
          token: entry.refresh_token,
          tokenTypeHint: 'refresh_token',
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        });
      }
      await revokeToken({
        baseUrl,
        token: entry.access_token,
        tokenTypeHint: 'access_token',
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
    } catch (err) {
      if (opts.verbose) {
        stderr.write(`debug: revoke failed: ${(err as Error).message}\n`);
      }
    }
  }
  await deleteStoredAuth();
  stdout.write('Logged out. Token removed from keychain.\n');
}

export function registerLogoutCommand(program: Command): void {
  const cmd = program
    .command('logout')
    .description('Sign out, revoke the OAuth token, and remove it from the keychain')
    .option('--verbose', 'print debug traces to stderr');

  cmd.action(async (opts: LogoutOpts) => {
    await runLogout(opts);
  });
}
