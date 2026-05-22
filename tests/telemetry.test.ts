import { describe, expect, it, vi } from 'vitest';
import { isTelemetryEnabled, resolveTelemetry } from '../src/telemetry/is-enabled.js';
import {
  type CommandCompletedPayload,
  type CommandFailedPayload,
  _resetForTests,
  flushPending,
  hashErrorMessage,
  sanitizePayload,
  sendCommandCompleted,
  sendCommandCrash,
  sendCommandFailed,
} from '../src/telemetry/telemetry.js';

function makeOkResponse(): Response {
  return new Response('null', { status: 202, headers: { 'content-type': 'application/json' } });
}

describe('isTelemetryEnabled / resolveTelemetry (priority order)', () => {
  it('default is OFF when env unset and config absent', () => {
    expect(isTelemetryEnabled({})).toBe(false);
    expect(resolveTelemetry({}, {}).source).toBe('default');
  });

  it('QUELVIO_TELEMETRY=on enables', () => {
    expect(isTelemetryEnabled({ QUELVIO_TELEMETRY: 'on' })).toBe(true);
    expect(resolveTelemetry({ QUELVIO_TELEMETRY: 'on' }, {}).source).toBe('env');
  });

  it('QUELVIO_TELEMETRY accepts 1, true, off, 0, false case-insensitively', () => {
    expect(isTelemetryEnabled({ QUELVIO_TELEMETRY: '1' })).toBe(true);
    expect(isTelemetryEnabled({ QUELVIO_TELEMETRY: 'true' })).toBe(true);
    expect(isTelemetryEnabled({ QUELVIO_TELEMETRY: 'TRUE' })).toBe(true);
    expect(isTelemetryEnabled({ QUELVIO_TELEMETRY: 'off' })).toBe(false);
    expect(isTelemetryEnabled({ QUELVIO_TELEMETRY: '0' })).toBe(false);
    expect(isTelemetryEnabled({ QUELVIO_TELEMETRY: 'false' })).toBe(false);
  });

  it('config file telemetry: "on" enables when env unset', () => {
    const r = resolveTelemetry({}, { telemetry: 'on' });
    expect(r.enabled).toBe(true);
    expect(r.source).toBe('config');
  });

  it('env var overrides config: env=off wins even if config=on', () => {
    const r = resolveTelemetry({ QUELVIO_TELEMETRY: 'off' }, { telemetry: 'on' });
    expect(r.enabled).toBe(false);
    expect(r.source).toBe('env');
  });
});

describe('hashErrorMessage', () => {
  it('produces a SHA-256 hex digest', () => {
    const h = hashErrorMessage('Authentication failed');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic — same input maps to same output', () => {
    expect(hashErrorMessage('boom')).toBe(hashErrorMessage('boom'));
  });

  it('payload contains the hash, never the message itself', () => {
    const msg = 'Authentication failed';
    const h = hashErrorMessage(msg);
    expect(h).not.toContain(msg);
    expect(h).not.toContain('Authentication');
    expect(h).not.toContain('failed');
  });
});

describe('sanitizePayload (defense in depth: strict whitelist)', () => {
  it('drops keys outside the cli_command_completed schema', () => {
    const dirty = {
      event_kind: 'cli_command_completed',
      cli_version: '0.4.0',
      os_platform: 'darwin',
      os_release: '23.6.0',
      node_version: '20.10.0',
      command_name: 'query',
      duration_ms: 100,
      exit_code: 0,
      query_text: 'secret-leak',
      access_token: 'qlv_pat_NOPE',
      home_path: '/Users/alice',
    } as unknown as CommandCompletedPayload;
    const clean = sanitizePayload(dirty) as Record<string, unknown>;
    expect(clean.query_text).toBeUndefined();
    expect(clean.access_token).toBeUndefined();
    expect(clean.home_path).toBeUndefined();
    expect(clean.command_name).toBe('query');
  });

  it('drops keys outside the cli_command_failed schema', () => {
    const dirty = {
      event_kind: 'cli_command_failed',
      cli_version: '0.4.0',
      os_platform: 'linux',
      os_release: '6.6',
      node_version: '20.10.0',
      command_name: 'query',
      error_class: 'AuthError',
      error_message_hash: 'abc',
      duration_ms: 100,
      exit_code: 2,
      error_message: 'never sent',
      stack: 'never sent',
    } as unknown as CommandFailedPayload;
    const clean = sanitizePayload(dirty) as Record<string, unknown>;
    expect(clean.error_message).toBeUndefined();
    expect(clean.stack).toBeUndefined();
    expect(clean.error_class).toBe('AuthError');
    expect(clean.error_message_hash).toBe('abc');
  });
});

describe('send* fire-and-forget (default-off + opt-in behavior)', () => {
  it('DEFAULT-OFF: no HTTP request fires when QUELVIO_TELEMETRY is unset', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    sendCommandCompleted(
      { command_name: 'query', duration_ms: 100, exit_code: 0 },
      {
        env: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('OPT-IN via env: telemetry POST fires when QUELVIO_TELEMETRY=on', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    sendCommandCompleted(
      { command_name: 'query', duration_ms: 100, exit_code: 0 },
      {
        env: { QUELVIO_TELEMETRY: 'on' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x/v1/enterprise/me/telemetry');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer t');
    expect(headers['Content-Type']).toBe('application/json');
    // NEVER include X-Quelvio-Command on the telemetry request itself (avoid recursion)
    expect(headers['X-Quelvio-Command']).toBeUndefined();
  });

  it('payload schema matches cli_command_completed exactly', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    sendCommandCompleted(
      { command_name: 'query', duration_ms: 1234, exit_code: 0 },
      {
        env: { QUELVIO_TELEMETRY: 'on' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.event_kind).toBe('cli_command_completed');
    expect(body.command_name).toBe('query');
    expect(body.duration_ms).toBe(1234);
    expect(body.exit_code).toBe(0);
    expect(typeof body.cli_version).toBe('string');
    expect(['darwin', 'linux', 'win32', 'other']).toContain(body.os_platform);
    expect(typeof body.os_release).toBe('string');
    expect(typeof body.node_version).toBe('string');
  });

  it('payload for cli_command_failed contains hash, never the message', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    const errMsg = 'Authentication failed for user xyz @ /Users/alice/.quelvio/config.json';
    sendCommandFailed(
      {
        command_name: 'query',
        duration_ms: 100,
        exit_code: 2,
        error_class: 'AuthError',
        error_message: errMsg,
      },
      {
        env: { QUELVIO_TELEMETRY: 'on' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const bodyStr = init.body as string;
    expect(bodyStr).not.toContain('Authentication failed');
    expect(bodyStr).not.toContain('alice');
    expect(bodyStr).not.toContain('.quelvio');
    const body = JSON.parse(bodyStr) as Record<string, unknown>;
    expect(body.event_kind).toBe('cli_command_failed');
    expect(body.error_class).toBe('AuthError');
    expect(body.error_message_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.error_message_hash).toBe(hashErrorMessage(errMsg));
  });

  it('sendCommandCrash emits cli_crash event with hash', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    sendCommandCrash(
      {
        command_name: 'query',
        duration_ms: 100,
        exit_code: 1,
        error_class: 'TypeError',
        error_message: 'Cannot read property X of undefined',
      },
      {
        env: { QUELVIO_TELEMETRY: 'on' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.event_kind).toBe('cli_crash');
    expect(body.error_class).toBe('TypeError');
    expect(body.error_message_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(init.body as string).not.toContain('Cannot read');
  });

  it('network error is silently swallowed — never throws to caller', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(() =>
      sendCommandCompleted(
        { command_name: 'query', duration_ms: 100, exit_code: 0 },
        {
          env: { QUELVIO_TELEMETRY: 'on' },
          fetchImpl: fetchImpl as unknown as typeof fetch,
          token: 't',
          baseUrl: 'https://x',
        },
      ),
    ).not.toThrow();
    await flushPending();
  });

  it('500 server error is silently dropped — no retry', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    sendCommandCompleted(
      { command_name: 'query', duration_ms: 100, exit_code: 0 },
      {
        env: { QUELVIO_TELEMETRY: 'on' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('429 rate limit is silently dropped — no retry', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate', { status: 429 }));
    sendCommandCompleted(
      { command_name: 'query', duration_ms: 100, exit_code: 0 },
      {
        env: { QUELVIO_TELEMETRY: 'on' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('payload field source — no tokens leak through telemetry code', () => {
  it('JSON serialized payload never contains access_token / refresh_token / QUELVIO_TOKEN', async () => {
    _resetForTests();
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    sendCommandFailed(
      {
        command_name: 'query',
        duration_ms: 100,
        exit_code: 2,
        error_class: 'AuthError',
        error_message: 'Authentication failed',
      },
      {
        env: { QUELVIO_TELEMETRY: 'on', QUELVIO_TOKEN: 'qlv_pat_VERY_SECRET' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 'qlv_pat_VERY_SECRET',
        baseUrl: 'https://x',
      },
    );
    await flushPending();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = init.body as string;
    expect(body).not.toContain('qlv_pat_VERY_SECRET');
    expect(body).not.toContain('access_token');
    expect(body).not.toContain('refresh_token');
    expect(body).not.toContain('QUELVIO_TOKEN');
  });
});
