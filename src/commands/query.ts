import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { readConfigFile } from '../config/store.js';
import { GenericError } from '../errors.js';
import { type QueryResponse, formatQueryResponse } from '../output/formatters.js';
import { type CommonOpts, addCommonOpts, buildClient, emitJson } from './common.js';

type QueryOpts = CommonOpts & {
  mode?: string;
  maxSources?: string;
  domain?: string;
  stream?: boolean;
  wait?: boolean;
};

const VALID_MODES = new Set(['fast', 'standard', 'deep']);

function mapMode(cliMode: string): string {
  if (cliMode === 'fast') return 'basic';
  return cliMode;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    process.stdin.on('error', reject);
  });
}

function openEditor(): string {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  const dir = mkdtempSync(join(tmpdir(), 'quelvio-query-'));
  const file = join(dir, 'QUERY.md');
  writeFileSync(file, '# Type your query below. Lines starting with # are ignored.\n');
  const result = spawnSync(editor, [file], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new GenericError(`editor '${editor}' exited with code ${result.status}`);
  }
  const raw = readFileSync(file, 'utf8');
  try {
    unlinkSync(file);
  } catch {
    // ignore
  }
  return raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

async function resolveQueryText(positional: string | undefined): Promise<string> {
  if (positional && positional.length > 0) return positional;
  if (!process.stdin.isTTY) {
    const piped = await readStdin();
    if (piped.length > 0) return piped;
  }
  return openEditor();
}

function clampMaxSources(value: number): number {
  if (Number.isNaN(value)) return 5;
  return Math.min(10, Math.max(1, Math.trunc(value)));
}

async function consumeSseStream(
  response: Response,
  onChunk: (delta: string) => void,
  onDone: (final: QueryResponse) => void,
): Promise<void> {
  if (!response.body) {
    throw new GenericError('streaming response has no body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: Partial<QueryResponse> = {};
  const synthesisParts: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf('\n\n');
      if (idx === -1) break;
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = rawEvent.split('\n');
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      const data = dataLines.join('\n');
      try {
        const payload = JSON.parse(data) as Record<string, unknown>;
        if (eventName === 'synthesis_chunk') {
          const delta = (payload.delta as string) ?? (payload.text as string) ?? '';
          if (delta) {
            synthesisParts.push(delta);
            onChunk(delta);
          }
        } else if (eventName === 'sources') {
          final.results = (payload.results as QueryResponse['results']) ?? [];
        } else if (eventName === 'done') {
          final = { ...final, ...(payload as Partial<QueryResponse>) };
          if (!final.synthesis && synthesisParts.length > 0) {
            final.synthesis = synthesisParts.join('');
          }
          onDone(final as QueryResponse);
        } else if (eventName === 'error') {
          const msg = (payload.message as string) ?? 'stream error';
          throw new GenericError(`stream error: ${msg}`);
        }
      } catch (err) {
        if (err instanceof GenericError) throw err;
      }
    }
  }
}

export function registerQueryCommand(program: Command): void {
  const cmd = program
    .command('query [text...]')
    .description('Run a knowledge query against the Quelvio brain')
    .option('--mode <mode>', 'query mode: fast | standard | deep', 'standard')
    .option('--max-sources <n>', 'max source chunks to return (1-10)', '5')
    .option('--domain <domain>', 'optional taxonomy domain filter')
    .option('--stream', 'request SSE streaming output')
    .option('--no-wait', 'return query_id immediately for async polling');

  addCommonOpts(cmd);

  cmd.action(async (textParts: string[], rawOpts: QueryOpts) => {
    const opts = rawOpts;
    const cfg = readConfigFile();

    const cliMode = opts.mode ?? cfg.default_mode ?? 'standard';
    if (!VALID_MODES.has(cliMode)) {
      throw new GenericError(`invalid --mode '${cliMode}'. Expected one of: fast, standard, deep`);
    }

    const maxSources = clampMaxSources(
      opts.maxSources !== undefined
        ? Number.parseInt(opts.maxSources, 10)
        : (cfg.default_max_sources ?? 5),
    );

    const positional = textParts.join(' ').trim();
    const queryText = await resolveQueryText(positional || undefined);
    if (!queryText) {
      throw new GenericError('no query text provided');
    }

    const { client } = await buildClient(opts);
    const body: Record<string, unknown> = {
      query: queryText,
      mode: mapMode(cliMode),
      limit: maxSources,
    };
    if (opts.domain) body.domain_filter = opts.domain;

    if (opts.wait === false) {
      const resp = await client.request<QueryResponse>({
        method: 'POST',
        path: '/v1/enterprise/query',
        body,
      });
      if (opts.json) {
        emitJson(resp);
      } else {
        process.stdout.write(`${resp.query_id}\n`);
      }
      return;
    }

    if (opts.stream) {
      try {
        await runStream(opts, body);
        return;
      } catch (err) {
        process.stderr.write('streaming unavailable; falling back to non-streaming.\n');
        if (opts.verbose) {
          process.stderr.write(`${(err as Error).message}\n`);
        }
      }
    }

    const resp = await client.request<QueryResponse>({
      method: 'POST',
      path: '/v1/enterprise/query',
      body,
    });

    if (opts.json) {
      emitJson(resp);
    } else {
      const formatOpts = opts.quiet ? { quiet: true } : {};
      process.stdout.write(`${formatQueryResponse(resp, formatOpts)}\n`);
    }
  });
}

async function runStream(opts: QueryOpts, body: Record<string, unknown>): Promise<void> {
  const { client } = await buildClient(opts);
  const response = await client.stream({
    method: 'POST',
    path: '/v1/enterprise/query/stream',
    body,
  });
  const ct = response.headers.get('content-type') ?? '';
  if (!ct.includes('event-stream')) {
    throw new GenericError(`stream returned non-SSE content-type: ${ct}`);
  }

  await consumeSseStream(
    response,
    (delta) => process.stdout.write(delta),
    (final) => {
      if (opts.json) {
        process.stdout.write(`\n${JSON.stringify(final)}\n`);
      } else if (!opts.quiet) {
        process.stdout.write('\n\n');
        const footer = `Query ID: ${final.query_id ?? '?'}  ·  kT: ${final.tokens_consumed ?? '?'}  ·  ${Math.round(final.latency_ms ?? 0)}ms`;
        process.stdout.write(`${footer}\n`);
      } else {
        process.stdout.write('\n');
      }
    },
  );
}
