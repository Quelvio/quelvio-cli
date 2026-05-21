import { beforeEach, describe, expect, it } from 'vitest';
import { setColorMode } from '../src/output/colors.js';
import {
  type DomainsResponse,
  type QueryResponse,
  type SourceDetailResponse,
  type WhoamiResponse,
  formatDomainsResponse,
  formatQueryResponse,
  formatSourceResponse,
  formatWhoamiResponse,
} from '../src/output/formatters.js';

beforeEach(() => {
  setColorMode('never');
});

const sampleQuery: QueryResponse = {
  query: 'what is our SLA?',
  query_id: '00000000-0000-0000-0000-000000000001',
  results: [
    {
      title: 'sla.md',
      source_type: 'confluence',
      author_email: 'alice@acme.com',
      last_source_updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    },
    {
      title: 'support-tier.md',
      source_type: 'drive',
      author_name: 'Bob',
      embedded_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
  result_count: 2,
  coverage: 'high',
  synthesis: 'Our SLA is 99.9% [1]. Support tiers are defined here [2].',
  latency_ms: 1820.4,
  tokens_consumed: 12500,
};

describe('formatQueryResponse', () => {
  it('renders synthesis + sources + metadata footer', () => {
    const out = formatQueryResponse(sampleQuery);
    expect(out).toContain('Our SLA is 99.9% [1].');
    expect(out).toContain('Sources:');
    expect(out).toContain('[1] sla.md');
    expect(out).toContain('alice@acme.com');
    expect(out).toContain('Query ID: 00000000-0000-0000-0000-000000000001');
    expect(out).toContain('kT: 12500');
    expect(out).toContain('1820ms');
    expect(out).toContain('Coverage: high');
  });

  it('with --quiet, suppresses metadata footer but keeps answer + sources', () => {
    const out = formatQueryResponse(sampleQuery, { quiet: true });
    expect(out).toContain('Our SLA is 99.9% [1].');
    expect(out).toContain('Sources:');
    expect(out).not.toContain('Query ID');
    expect(out).not.toContain('kT:');
    expect(out).not.toContain('ms');
  });

  it('handles null synthesis', () => {
    const out = formatQueryResponse({ ...sampleQuery, synthesis: null });
    expect(out).toContain('no synthesis returned');
  });

  it('never logs the token', () => {
    const out = formatQueryResponse(sampleQuery);
    expect(out).not.toContain('qlv_pat_');
    expect(out).not.toContain('QUELVIO_TOKEN');
  });
});

describe('formatDomainsResponse', () => {
  it('renders a table', () => {
    const resp: DomainsResponse = {
      domains: [
        {
          taxonomy_domain: 'engineering.platform',
          document_count: 42,
          chunk_count: 314,
          expert_count: 3,
          coverage_level: 'expert',
        },
        {
          taxonomy_domain: 'sales',
          document_count: 10,
          chunk_count: 88,
          expert_count: 1,
          coverage_level: 'partial',
        },
      ],
      total: 2,
    };
    const out = formatDomainsResponse(resp);
    expect(out).toContain('Domain');
    expect(out).toContain('Documents');
    expect(out).toContain('engineering.platform');
    expect(out).toContain('sales');
    expect(out).toContain('Total: 2');
  });
});

describe('formatSourceResponse', () => {
  it('lists chunks with provenance', () => {
    const resp: SourceDetailResponse = {
      query_id: 'q-1',
      tenant_id: 't-1',
      chunks: [
        {
          chunk_id: 'c1',
          title: 'runbook.md',
          source_type: 'confluence',
          lifecycle_state: 'live',
          embedded_at: '2026-01-01T00:00:00Z',
          author_email: 'alice@acme.com',
        },
      ],
      chunk_count: 1,
    };
    const out = formatSourceResponse(resp);
    expect(out).toContain('q-1');
    expect(out).toContain('runbook.md');
    expect(out).toContain('Connector:  confluence');
    expect(out).toContain('Lifecycle:  live');
    expect(out).toContain('alice@acme.com');
  });
});

describe('formatWhoamiResponse', () => {
  it('shows email + tenant + auth method + redacted prefix', () => {
    const resp: WhoamiResponse = {
      email: 'alice@acme.com',
      tenant_id: 'aaaa-bbbb',
      tenant_name: 'ACME',
    };
    const out = formatWhoamiResponse(resp, { tokenPrefix: 'qlv_pat_abcd...', authMethod: 'pat' });
    expect(out).toContain('Signed in as:');
    expect(out).toContain('alice@acme.com');
    expect(out).toContain('ACME');
    expect(out).toContain('aaaa-bbbb');
    expect(out).toContain('pat');
    expect(out).toContain('qlv_pat_abcd...');
  });

  it('does not leak the full token', () => {
    const fullToken = 'qlv_pat_VERY_SECRET_full_token_value';
    const resp: WhoamiResponse = { email: 'a@b', tenant_id: 't', tenant_name: 'T' };
    const out = formatWhoamiResponse(resp, { tokenPrefix: 'qlv_pat_VERY...', authMethod: 'pat' });
    expect(out).not.toContain(fullToken);
    expect(out).not.toContain('SECRET');
  });
});
