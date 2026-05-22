import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client.js';
import { setColorMode } from '../src/output/colors.js';
import {
  type DomainsResponse,
  type QueryResponse,
  type WhoamiResponse,
  formatDomainsResponse,
  formatQueryResponse,
  formatWhoamiResponse,
} from '../src/output/formatters.js';

beforeEach(() => {
  setColorMode('never');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('end-to-end command flows (ApiClient + formatter)', () => {
  it('domains: response is parseable as JSON and renders a table', async () => {
    const payload: DomainsResponse = {
      domains: [
        {
          taxonomy_domain: 'engineering',
          document_count: 100,
          chunk_count: 1000,
          expert_count: 3,
          coverage_level: 'expert',
        },
      ],
      total: 1,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(payload));
    const client = new ApiClient({
      token: 'qlv_pat_x',
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resp = await client.request<DomainsResponse>({ path: '/v1/enterprise/domains' });
    // JSON path: re-parse to prove it's parseable
    const json = JSON.stringify(resp);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as DomainsResponse;
    expect(parsed.total).toBe(1);
    // Human format
    const out = formatDomainsResponse(resp);
    expect(out).toContain('engineering');
    expect(out).toContain('Total: 1');
  });

  it('whoami: renders email + tenant + auth method, never leaks raw token', async () => {
    const payload: WhoamiResponse = {
      email: 'alice@acme.com',
      tenant_id: 'aaaa-bbbb-cccc-dddd',
      tenant_name: 'ACME',
      role: 'member',
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(payload));
    const client = new ApiClient({
      token: 'qlv_pat_FULL_TOKEN_VALUE',
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resp = await client.request<WhoamiResponse>({ path: '/v1/enterprise/me' });

    const out = formatWhoamiResponse(resp, { tokenPrefix: 'qlv_pat_FULL...', authMethod: 'pat' });
    expect(out).toContain('alice@acme.com');
    expect(out).toContain('ACME');
    expect(out).toContain('aaaa-bbbb-cccc-dddd');
    expect(out).toContain('pat');
    expect(out).toContain('qlv_pat_FULL...');
    expect(out).not.toContain('FULL_TOKEN_VALUE');
  });

  it('query: --json output is JSON.parse-able', async () => {
    const payload: QueryResponse = {
      query: 'x',
      query_id: 'qid-1',
      results: [],
      result_count: 0,
      coverage: 'low',
      synthesis: 'answer',
      latency_ms: 100,
      tokens_consumed: 1500,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(payload));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resp = await client.request<QueryResponse>({
      method: 'POST',
      path: '/v1/enterprise/query',
      body: { query: 'x' },
    });
    const serialised = JSON.stringify(resp);
    expect(() => JSON.parse(serialised)).not.toThrow();
    expect((JSON.parse(serialised) as QueryResponse).query_id).toBe('qid-1');
  });

  it('query: human formatter shows answer + sources + footer', async () => {
    const payload: QueryResponse = {
      query: 'x',
      query_id: 'qid-1',
      results: [
        {
          title: 'doc.md',
          source_type: 'drive',
          author_email: 'a@b',
          last_source_updated_at: new Date().toISOString(),
        },
      ],
      result_count: 1,
      coverage: 'high',
      synthesis: 'answer [1]',
      latency_ms: 100,
      tokens_consumed: 500,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(payload));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resp = await client.request<QueryResponse>({
      method: 'POST',
      path: '/v1/enterprise/query',
      body: { query: 'x' },
    });
    const out = formatQueryResponse(resp);
    expect(out).toContain('answer');
    expect(out).toContain('[1]');
    expect(out).toContain('Sources:');
    expect(out).toContain('Query ID: qid-1');
    expect(out).toContain('kT: 500');
  });

  it('source: builds correct path for query_id', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResp({ query_id: 'q', tenant_id: 't', chunks: [], chunk_count: 0 }));
    const client = new ApiClient({
      token: 't',
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.request({ path: '/v1/enterprise/sources/abc-123' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/v1/enterprise/sources/abc-123',
      expect.anything(),
    );
  });
});
