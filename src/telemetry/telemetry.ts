import { createHash } from 'node:crypto';
import { platform, release } from 'node:os';
import { resolveBaseUrl } from '../api/client.js';
import { resolveToken } from '../auth/token-resolver.js';
import { VERSION } from '../version.js';
import { isTelemetryEnabled } from './is-enabled.js';

const TELEMETRY_PATH = '/v1/enterprise/me/telemetry';
const TELEMETRY_TIMEOUT_MS = 3000;

export type NodePlatform = 'darwin' | 'linux' | 'win32' | 'other';

function normalizePlatform(): NodePlatform {
  const p = platform();
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p;
  return 'other';
}

export type CommandCompletedPayload = {
  event_kind: 'cli_command_completed';
  cli_version: string;
  os_platform: NodePlatform;
  os_release: string;
  node_version: string;
  command_name: string;
  duration_ms: number;
  exit_code: number;
};

export type CommandFailedPayload = {
  event_kind: 'cli_command_failed';
  cli_version: string;
  os_platform: NodePlatform;
  os_release: string;
  node_version: string;
  command_name: string;
  error_class: string;
  error_message_hash: string;
  duration_ms: number;
  exit_code: number;
};

export type CommandCrashPayload = {
  event_kind: 'cli_crash';
  cli_version: string;
  os_platform: NodePlatform;
  os_release: string;
  node_version: string;
  command_name: string;
  error_class: string;
  error_message_hash: string;
  duration_ms: number;
  exit_code: number;
};

export type TelemetryPayload = CommandCompletedPayload | CommandFailedPayload | CommandCrashPayload;

const COMPLETED_KEYS: ReadonlySet<keyof CommandCompletedPayload> = new Set([
  'event_kind',
  'cli_version',
  'os_platform',
  'os_release',
  'node_version',
  'command_name',
  'duration_ms',
  'exit_code',
]);

const FAILED_OR_CRASH_KEYS: ReadonlySet<keyof CommandFailedPayload> = new Set([
  'event_kind',
  'cli_version',
  'os_platform',
  'os_release',
  'node_version',
  'command_name',
  'error_class',
  'error_message_hash',
  'duration_ms',
  'exit_code',
]);

/**
 * Defense-in-depth: drop any keys outside the known schema before serialization.
 */
export function sanitizePayload(payload: TelemetryPayload): TelemetryPayload {
  const allowed: ReadonlySet<string> =
    payload.event_kind === 'cli_command_completed'
      ? (COMPLETED_KEYS as ReadonlySet<string>)
      : (FAILED_OR_CRASH_KEYS as ReadonlySet<string>);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out as TelemetryPayload;
}

export function hashErrorMessage(message: string): string {
  return createHash('sha256').update(message, 'utf8').digest('hex');
}

export function envelope(base: {
  command_name: string;
  duration_ms: number;
  exit_code: number;
}): {
  cli_version: string;
  os_platform: NodePlatform;
  os_release: string;
  node_version: string;
  command_name: string;
  duration_ms: number;
  exit_code: number;
} {
  return {
    cli_version: VERSION,
    os_platform: normalizePlatform(),
    os_release: release(),
    node_version: process.versions.node,
    command_name: base.command_name,
    duration_ms: base.duration_ms,
    exit_code: base.exit_code,
  };
}

export type SendOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  verbose?: boolean;
  errorLog?: (line: string) => void;
};

async function postTelemetry(payload: TelemetryPayload, opts: SendOptions): Promise<void> {
  const env = opts.env ?? process.env;
  if (!isTelemetryEnabled(env)) return;

  let token = opts.token;
  if (!token) {
    try {
      const resolved = await resolveToken({ env });
      token = resolved.token;
    } catch {
      return;
    }
  }
  if (!token) return;

  const baseUrl = opts.baseUrl ?? resolveBaseUrl(env);
  const url = `${baseUrl}${TELEMETRY_PATH}`;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? TELEMETRY_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = JSON.stringify(sanitizePayload(payload));

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    if (opts.verbose && opts.errorLog && !res.ok) {
      opts.errorLog(`telemetry: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    if (opts.verbose && opts.errorLog) {
      opts.errorLog(`telemetry: ${(err as Error).message ?? String(err)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

const pending: Promise<void>[] = [];

function fireAndForget(p: Promise<void>): void {
  const wrapped = p.catch(() => {});
  pending.push(wrapped);
}

export function sendCommandCompleted(
  input: { command_name: string; duration_ms: number; exit_code: number },
  opts: SendOptions = {},
): void {
  const payload: CommandCompletedPayload = {
    event_kind: 'cli_command_completed',
    ...envelope(input),
  };
  fireAndForget(postTelemetry(payload, opts));
}

export function sendCommandFailed(
  input: {
    command_name: string;
    error_class: string;
    error_message: string;
    duration_ms: number;
    exit_code: number;
  },
  opts: SendOptions = {},
): void {
  const payload: CommandFailedPayload = {
    event_kind: 'cli_command_failed',
    ...envelope({
      command_name: input.command_name,
      duration_ms: input.duration_ms,
      exit_code: input.exit_code,
    }),
    error_class: input.error_class,
    error_message_hash: hashErrorMessage(input.error_message),
  };
  fireAndForget(postTelemetry(payload, opts));
}

export function sendCommandCrash(
  input: {
    command_name: string;
    error_class: string;
    error_message: string;
    duration_ms: number;
    exit_code: number;
  },
  opts: SendOptions = {},
): void {
  const payload: CommandCrashPayload = {
    event_kind: 'cli_crash',
    ...envelope({
      command_name: input.command_name,
      duration_ms: input.duration_ms,
      exit_code: input.exit_code,
    }),
    error_class: input.error_class,
    error_message_hash: hashErrorMessage(input.error_message),
  };
  fireAndForget(postTelemetry(payload, opts));
}

export async function flushPending(): Promise<void> {
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
}

export function _resetForTests(): void {
  pending.length = 0;
}
