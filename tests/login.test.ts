import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as keychain from '../src/auth/keychain.js';
import { runLogin } from '../src/commands/login.js';
import { runLogout } from '../src/commands/logout.js';
import { AuthError } from '../src/errors.js';

function collect(stream: PassThrough): string {
  const chunks: Buffer[] = [];
  stream.on('data', (c) => chunks.push(Buffer.from(c)));
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'toString') return () => Buffer.concat(chunks).toString('utf8');
        return undefined;
      },
    },
  ) as unknown as string;
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authorizeResp(): Response {
  return jsonResp(200, {
    device_code: 'qlv_dvc_abc',
    user_code: 'BCDF-GHJK',
    verification_uri: 'https://enterprise.quelvio.com/device',
    verification_uri_complete: 'https://enterprise.quelvio.com/device?code=BCDF-GHJK',
    expires_in: 600,
    interval: 5,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runLogin', () => {
  it('happy path: persists OAuth tokens and prints greeting', async () => {
    const setSpy = vi.spyOn(keychain, 'setStoredAuth').mockResolvedValue();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(authorizeResp())
      .mockResolvedValueOnce(
        jsonResp(200, {
          access_token: 'qlv_oat_secret',
          refresh_token: 'qlv_ort_secret',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResp(200, { email: 'alice@acme.com', tenant_name: 'ACME', tenant_id: 't-1' }),
      );

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutOut = collect(stdout);
    const stderrOut = collect(stderr);

    await runLogin(
      { browser: false },
      {
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
        now: () => 1_700_000_000_000,
        openBrowser: () => false,
        stdout,
        stderr,
      },
    );

    expect(setSpy).toHaveBeenCalledWith({
      access_token: 'qlv_oat_secret',
      refresh_token: 'qlv_ort_secret',
      expires_at: 1_700_000_000 + 3600,
      source: 'oauth',
    });
    expect(String(stdoutOut)).toContain('Logged in as alice@acme.com (ACME)');
    expect(String(stdoutOut)).toContain('Token saved to OS keychain');
    expect(String(stderrOut)).toContain(
      'Visit: https://enterprise.quelvio.com/device?code=BCDF-GHJK',
    );
    expect(String(stderrOut)).toContain('Code:  BCDF-GHJK');
    expect(String(stderrOut)).toContain('Waiting for authorization');
    // tokens MUST never leak to stderr / stdout
    expect(String(stderrOut)).not.toContain('qlv_oat_secret');
    expect(String(stderrOut)).not.toContain('qlv_ort_secret');
    expect(String(stdoutOut)).not.toContain('qlv_oat_secret');
    expect(String(stdoutOut)).not.toContain('qlv_ort_secret');
  });

  it('slow_down: extends polling interval by 5s and retries until success', async () => {
    vi.spyOn(keychain, 'setStoredAuth').mockResolvedValue();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(authorizeResp())
      .mockResolvedValueOnce(jsonResp(400, { error: 'slow_down' }))
      .mockResolvedValueOnce(jsonResp(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(
        jsonResp(200, {
          access_token: 'qlv_oat_y',
          refresh_token: 'qlv_ort_y',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(jsonResp(200, { email: 'a@b' }));

    const sleepCalls: number[] = [];
    await runLogin(
      { browser: false },
      {
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
        now: () => 1_700_000_000_000,
        openBrowser: () => false,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
    );
    // 5s, then 5+5=10s, then 10s for the pending → success poll
    expect(sleepCalls[0]).toBe(5000);
    expect(sleepCalls[1]).toBe(10_000);
    expect(sleepCalls[2]).toBe(10_000);
  });

  it('expired_token surfaces as AuthError exit 2', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(authorizeResp())
      .mockResolvedValueOnce(jsonResp(400, { error: 'expired_token' }));
    const err = await runLogin(
      { browser: false },
      {
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
        now: () => 1_700_000_000_000,
        openBrowser: () => false,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toMatch(/expired/i);
    expect((err as AuthError).exitCode).toBe(2);
  });

  it('access_denied surfaces as AuthError "Login denied" exit 2', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(authorizeResp())
      .mockResolvedValueOnce(jsonResp(400, { error: 'access_denied' }));
    const err = await runLogin(
      { browser: false },
      {
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
        now: () => 1_700_000_000_000,
        openBrowser: () => false,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toMatch(/Login denied/);
    expect((err as AuthError).exitCode).toBe(2);
  });

  it('does not invoke the browser when browser:false', async () => {
    vi.spyOn(keychain, 'setStoredAuth').mockResolvedValue();
    const opener = vi.fn(() => true);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(authorizeResp())
      .mockResolvedValueOnce(
        jsonResp(200, {
          access_token: 'qlv_oat_x',
          refresh_token: 'qlv_ort_x',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(jsonResp(200, { email: 'a@b' }));
    await runLogin(
      { browser: false },
      {
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
        now: () => 1_700_000_000_000,
        openBrowser: opener,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
    );
    expect(opener).not.toHaveBeenCalled();
  });
});

describe('runLogout', () => {
  it('is idempotent when not logged in', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue(null);
    const stdout = new PassThrough();
    const stdoutOut = collect(stdout);
    await runLogout({}, { stdout, stderr: new PassThrough() });
    expect(String(stdoutOut)).toMatch(/Not logged in/);
  });

  it('revokes both refresh and access tokens, then deletes the keychain entry', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_oat_x',
      refresh_token: 'qlv_ort_x',
      expires_at: 1,
      source: 'oauth',
    });
    const deleteSpy = vi.spyOn(keychain, 'deleteStoredAuth').mockResolvedValue();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(200, {}));
    await runLogout(
      {},
      {
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map((c) => String((c[1] as { body: string }).body));
    expect(bodies.some((b) => b.includes('token=qlv_ort_x'))).toBe(true);
    expect(bodies.some((b) => b.includes('token=qlv_oat_x'))).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('skips revoke for legacy PAT entries but still deletes locally', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_pat_x',
      source: 'pat',
    });
    const deleteSpy = vi.spyOn(keychain, 'deleteStoredAuth').mockResolvedValue();
    const fetchImpl = vi.fn();
    await runLogout(
      {},
      {
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalled();
  });
});
