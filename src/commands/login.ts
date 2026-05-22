import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { Command } from 'commander';
import { ApiClient, resolveBaseUrl } from '../api/client.js';
import { type DeviceAuthorization, deviceAuthorize, pollToken } from '../auth/device-flow.js';
import { type AuthEntry, setStoredAuth } from '../auth/keychain.js';
import { AuthError } from '../errors.js';
import type { WhoamiResponse } from '../output/formatters.js';

export type LoginOpts = {
  browser?: boolean;
  verbose?: boolean;
};

export type LoginDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  openBrowser?: (url: string) => boolean;
  now?: () => number;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  baseUrl?: string;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tryOpenBrowser(url: string): boolean {
  try {
    const p = platform();
    const cmd = p === 'darwin' ? 'open' : p === 'win32' ? 'cmd' : 'xdg-open';
    const args = p === 'win32' ? ['/c', 'start', '""', url] : [url];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* swallow — caller falls back to printing URL */
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function printHandshake(out: NodeJS.WritableStream, auth: DeviceAuthorization): void {
  out.write(`Visit: ${auth.verification_uri_complete}\n`);
  out.write(`Code:  ${auth.user_code}\n`);
  out.write('Waiting for authorization...\n');
}

export async function runLogin(opts: LoginOpts, deps: LoginDeps = {}): Promise<void> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const baseUrl = deps.baseUrl ?? resolveBaseUrl();

  const auth = await deviceAuthorize({
    baseUrl,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  printHandshake(stderr, auth);

  if (opts.browser !== false) {
    const opener = deps.openBrowser ?? tryOpenBrowser;
    opener(auth.verification_uri_complete);
  }

  let interval = auth.interval;
  const deadline = now() + auth.expires_in * 1000;

  while (now() < deadline) {
    await sleep(interval * 1000);
    const result = await pollToken({
      baseUrl,
      deviceCode: auth.device_code,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    if (result.kind === 'success') {
      const issuedAt = Math.floor(now() / 1000);
      const entry: AuthEntry = {
        access_token: result.tokens.access_token,
        refresh_token: result.tokens.refresh_token,
        expires_at: issuedAt + result.tokens.expires_in,
        source: 'oauth',
      };
      await setStoredAuth(entry);

      const client = new ApiClient({
        token: entry.access_token,
        baseUrl,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      let greeting = 'Logged in. Token saved to OS keychain.';
      try {
        const me = await client.request<WhoamiResponse>({ path: '/v1/enterprise/me' });
        const email = typeof me.email === 'string' ? me.email : 'user';
        const tenant =
          (typeof me.tenant_name === 'string' && me.tenant_name) ||
          (typeof me.tenant_id === 'string' && me.tenant_id) ||
          'tenant';
        greeting = `Logged in as ${email} (${tenant}). Token saved to OS keychain.`;
      } catch (err) {
        if (opts.verbose) {
          stderr.write(`debug: greeting fetch failed: ${(err as Error).message}\n`);
        }
      }
      stdout.write(`${greeting}\n`);
      return;
    }
    if (result.kind === 'pending') continue;
    if (result.kind === 'slow_down') {
      interval += 5;
      continue;
    }
    if (result.kind === 'expired') {
      throw new AuthError('Device code expired before authorization completed.');
    }
    if (result.kind === 'denied') {
      throw new AuthError('Login denied.');
    }
    if (result.kind === 'error') {
      throw new AuthError(
        `OAuth error: ${result.code}${result.description ? ` — ${result.description}` : ''}`,
      );
    }
  }
  throw new AuthError('Device code expired before authorization completed.');
}

export function registerLoginCommand(program: Command): void {
  const cmd = program
    .command('login')
    .description('Sign in via the OAuth device-code flow')
    .option('--no-browser', "don't try to open the verification URL in a browser")
    .option('--verbose', 'print debug traces to stderr');

  cmd.action(async (opts: LoginOpts) => {
    await runLogin(opts);
  });
}
