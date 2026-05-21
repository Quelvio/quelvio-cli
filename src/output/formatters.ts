import { c } from './colors.js';

export type QueryResponse = {
  query: string;
  query_id: string;
  results: Array<Record<string, unknown>>;
  result_count: number;
  coverage: string;
  synthesis?: string | null;
  latency_ms: number;
  tokens_consumed: number;
};

export type DomainsResponse = {
  domains: Array<{
    taxonomy_domain: string;
    document_count: number;
    chunk_count: number;
    expert_count: number;
    coverage_level: string;
  }>;
  total: number;
};

export type SourceChunk = {
  chunk_id: string;
  content_piece_id?: string;
  title?: string;
  excerpt?: string;
  source_url?: string | null;
  source_type?: string | null;
  lifecycle_state?: string;
  embedded_at?: string | null;
  embedding_model?: string | null;
  last_source_updated_at?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  department?: string | null;
  taxonomy_domain?: string | null;
};

export type SourceDetailResponse = {
  query_id: string;
  tenant_id: string;
  chunks: SourceChunk[];
  chunk_count: number;
};

export type WhoamiResponse = Record<string, unknown> & {
  email?: string;
  display_name?: string;
  tenant_id?: string;
  tenant_name?: string;
  role?: string;
};

type QueryFormatOptions = {
  quiet?: boolean;
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown time';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  if (diff < 0) return 'in the future';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function bolden(text: string): string {
  return text.replace(/(\[\d+\])/g, (m) => c.bold(m));
}

export function formatQueryResponse(resp: QueryResponse, opts: QueryFormatOptions = {}): string {
  const lines: string[] = [];
  const synthesis = resp.synthesis ?? '(no synthesis returned; this mode is retrieval-only)';
  lines.push(bolden(synthesis));
  lines.push('');

  if (resp.results.length > 0) {
    lines.push(c.bold('Sources:'));
    resp.results.forEach((raw, i) => {
      const r = raw as Record<string, unknown>;
      const idx = `[${i + 1}]`;
      const title =
        (r.title as string) || (r.source_url as string) || (r.chunk_id as string) || 'untitled';
      const connector = (r.source_type as string) || (r.connector as string) || 'unknown';
      const contributor =
        (r.author_name as string) ||
        (r.author_email as string) ||
        (r.contributor as string) ||
        'unknown';
      const when = relativeTime(
        (r.last_source_updated_at as string) ||
          (r.embedded_at as string) ||
          (r.updated_at as string) ||
          null,
      );
      lines.push(`  ${c.cyan(idx)} ${title} ${c.dim(`(${connector})`)} — ${contributor}, ${when}`);
    });
    lines.push('');
  }

  if (!opts.quiet) {
    const footer = [
      `Query ID: ${resp.query_id}`,
      `Coverage: ${resp.coverage}`,
      `kT: ${resp.tokens_consumed}`,
      `${Math.round(resp.latency_ms)}ms`,
    ].join(c.dim('  ·  '));
    lines.push(c.dim(footer));
  }

  return lines.join('\n');
}

export function formatDomainsResponse(resp: DomainsResponse): string {
  if (resp.domains.length === 0) {
    return 'No domains indexed yet.';
  }

  const rows = resp.domains.map((d) => ({
    domain: d.taxonomy_domain,
    docs: String(d.document_count),
    experts: String(d.expert_count),
    coverage: d.coverage_level,
  }));

  const widths = {
    domain: Math.max(6, ...rows.map((r) => r.domain.length)),
    docs: Math.max(9, ...rows.map((r) => r.docs.length)),
    experts: Math.max(7, ...rows.map((r) => r.experts.length)),
    coverage: Math.max(8, ...rows.map((r) => r.coverage.length)),
  };

  const header = [
    'Domain'.padEnd(widths.domain),
    'Documents'.padStart(widths.docs),
    'Experts'.padStart(widths.experts),
    'Coverage'.padEnd(widths.coverage),
  ].join('  ');

  const rule = [
    '-'.repeat(widths.domain),
    '-'.repeat(widths.docs),
    '-'.repeat(widths.experts),
    '-'.repeat(widths.coverage),
  ].join('  ');

  const body = rows.map((r) =>
    [
      r.domain.padEnd(widths.domain),
      r.docs.padStart(widths.docs),
      r.experts.padStart(widths.experts),
      r.coverage.padEnd(widths.coverage),
    ].join('  '),
  );

  return [c.bold(header), c.dim(rule), ...body, '', c.dim(`Total: ${resp.total}`)].join('\n');
}

export function formatSourceResponse(resp: SourceDetailResponse): string {
  if (resp.chunks.length === 0) {
    return `Query ${resp.query_id}: no per-chunk provenance available.`;
  }
  const lines: string[] = [c.bold(`Query ${resp.query_id} — ${resp.chunk_count} chunk(s)`), ''];
  resp.chunks.forEach((chunk, i) => {
    lines.push(c.cyan(`[${i + 1}] ${chunk.title ?? chunk.chunk_id}`));
    if (chunk.source_url) lines.push(`    Path:       ${chunk.source_url}`);
    if (chunk.source_type) lines.push(`    Connector:  ${chunk.source_type}`);
    if (chunk.lifecycle_state) lines.push(`    Lifecycle:  ${chunk.lifecycle_state}`);
    if (chunk.embedded_at)
      lines.push(`    Embedded:   ${chunk.embedded_at} (${relativeTime(chunk.embedded_at)})`);
    const contributor = chunk.author_name ?? chunk.author_email;
    if (contributor) lines.push(`    Contributor:${' '.repeat(1)}${contributor}`);
    if (chunk.last_source_updated_at) {
      lines.push(
        `    Updated:    ${chunk.last_source_updated_at} (${relativeTime(chunk.last_source_updated_at)})`,
      );
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

export type WhoamiContext = {
  tokenPrefix: string;
  authMethod: 'pat' | 'oauth' | 'service-account';
};

export function formatWhoamiResponse(resp: WhoamiResponse, ctx: WhoamiContext): string {
  const email = (resp.email as string) ?? '(unknown)';
  const tenantName = (resp.tenant_name as string) ?? '(unknown)';
  const tenantId = (resp.tenant_id as string) ?? '(unknown)';
  const lines = [
    `${c.bold('Signed in as:')} ${email}`,
    `${c.bold('Tenant:')}       ${tenantName} (${c.dim(tenantId)})`,
    `${c.bold('Auth method:')}  ${ctx.authMethod}`,
    `${c.bold('Token prefix:')} ${c.dim(ctx.tokenPrefix)}`,
  ];
  return lines.join('\n');
}

export function formatError(err: Error): string {
  return c.red(`error: ${err.message}`);
}

export function formatJson(value: unknown, prettyPrint: boolean): string {
  return prettyPrint ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}
