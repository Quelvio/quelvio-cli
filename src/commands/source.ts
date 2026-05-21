import type { Command } from 'commander';
import { type SourceDetailResponse, formatSourceResponse } from '../output/formatters.js';
import { type CommonOpts, addCommonOpts, buildClient, emitJson } from './common.js';

export function registerSourceCommand(program: Command): void {
  const cmd = program
    .command('source <query-id>')
    .description('Show per-chunk provenance for a previous query');

  addCommonOpts(cmd);

  cmd.action(async (queryId: string, opts: CommonOpts) => {
    const { client } = await buildClient(opts);
    const resp = await client.request<SourceDetailResponse>({
      method: 'GET',
      path: `/v1/enterprise/sources/${encodeURIComponent(queryId)}`,
    });
    if (opts.json) {
      emitJson(resp);
    } else {
      process.stdout.write(`${formatSourceResponse(resp)}\n`);
    }
  });
}
