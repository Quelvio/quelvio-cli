import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client.js';
import {
  AuthError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ScopeError,
} from '../src/errors.js';

function makeJsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('ApiClient', () => {
  it('sends Bearer token + UA + JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(200, { ok: true }));
    const client = new ApiClient({
      token: 'qlv_pat_xyz',
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.request({ method: 'POST', path: '/v1/foo', body: { q: 'x' } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/foo');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer qlv_pat_xyz');
    expect(headers['User-Agent']).toMatch(/^quelvio-cli\//);
    expect(headers['Content-Type']).toBe('application/json');
    expect((init as { body: string }).body).toBe(JSON.stringify({ q: 'x' }));
  });

  it('maps 401 → AuthError(exit 2)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Invalid token' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.request({ path: '/v1/x' })).rejects.toBeInstanceOf(AuthError);
  });

  it('maps 403 → ScopeError(exit 6)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(403, { detail: 'nope' }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.request({ path: '/v1/x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ScopeError);
    expect((err as ScopeError).exitCode).toBe(6);
  });

  it('maps 404 → NotFoundError(exit 3)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(404, { detail: 'gone' }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.request({ path: '/v1/x' }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).exitCode).toBe(3);
  });

  it('maps 429 → RateLimitError(exit 4) with Retry-After', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeJsonResponse(429, { detail: 'slow down' }, { 'retry-after': '30' }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await client.request({ path: '/v1/x' }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSeconds).toBe(30);
    expect((err as RateLimitError).exitCode).toBe(4);
  });

  it('retries 503 up to 3 times then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(503, { detail: 'try later' }))
      .mockResolvedValueOnce(makeJsonResponse(503, { detail: 'try later' }))
      .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const result = await client.request<{ ok: boolean }>({ path: '/v1/x' });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(400, { detail: 'bad' }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    await client.request({ path: '/v1/x' }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws NetworkError on connection failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const err = await client.request({ path: '/v1/x' }).catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).exitCode).toBe(7);
  });

  it('uses exponential backoff with jitter (1s, 2s, 4s ±20%)', async () => {
    const delays: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(503, {}))
      .mockResolvedValueOnce(makeJsonResponse(503, {}))
      .mockResolvedValueOnce(makeJsonResponse(503, {}))
      .mockResolvedValueOnce(makeJsonResponse(200, {}));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5, // jitter = 0
    });
    await client.request({ path: '/v1/x' });
    expect(delays.length).toBe(3);
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
  });
});
