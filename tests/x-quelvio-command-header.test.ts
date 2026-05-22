import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client.js';

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function lastRequestHeaders(fetchImpl: ReturnType<typeof vi.fn>): Record<string, string> {
  const call = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
  if (!call) throw new Error('no fetch calls');
  return (call[1] as { headers: Record<string, string> }).headers;
}

describe('X-Quelvio-Command header (always-on audit attribution)', () => {
  it('every authenticated request includes the header set to the parsed command name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(200, { ok: true }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      commandName: 'query',
    });
    await client.request({ path: '/v1/foo' });
    expect(lastRequestHeaders(fetchImpl)['X-Quelvio-Command']).toBe('query');
  });

  it('header value matches the command across known command names', async () => {
    for (const name of ['login', 'query', 'domains', 'source', 'whoami', 'config']) {
      const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(200, { ok: true }));
      const client = new ApiClient({
        token: 't',
        baseUrl: 'https://x',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        commandName: name,
      });
      await client.request({ path: '/v1/x' });
      expect(lastRequestHeaders(fetchImpl)['X-Quelvio-Command']).toBe(name);
    }
  });

  it('header omitted when no command was parsed (e.g. --help)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(200, { ok: true }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      commandName: null,
    });
    await client.request({ path: '/v1/x' });
    expect(lastRequestHeaders(fetchImpl)['X-Quelvio-Command']).toBeUndefined();
  });

  it('header value never leaks sensitive args — it is the command name, not the query text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(200, { ok: true }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      commandName: 'query',
    });
    await client.request({
      method: 'POST',
      path: '/v1/enterprise/query',
      body: { query: 'super-secret-internal-data' },
    });
    const headers = lastRequestHeaders(fetchImpl);
    expect(headers['X-Quelvio-Command']).toBe('query');
    expect(headers['X-Quelvio-Command']).not.toContain('super-secret');
  });

  it('stream() also emits X-Quelvio-Command', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('event: done\ndata: {}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      commandName: 'query',
    });
    await client.stream({ method: 'POST', path: '/v1/x', body: { q: 1 } });
    expect(lastRequestHeaders(fetchImpl)['X-Quelvio-Command']).toBe('query');
  });
});
