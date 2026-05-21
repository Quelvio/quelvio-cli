import type { Command } from 'commander';
import { type DomainsResponse, formatDomainsResponse } from '../output/formatters.js';
import { type CommonOpts, addCommonOpts, buildClient, emitJson } from './common.js';

export function registerDomainsCommand(program: Command): void {
  const cmd = program
    .command('domains')
    .description('List taxonomy domains and their coverage levels');

  addCommonOpts(cmd);

  cmd.action(async (opts: CommonOpts) => {
    const { client } = await buildClient(opts);
    const resp = await client.request<DomainsResponse>({
      method: 'GET',
      path: '/v1/enterprise/domains',
    });
    if (opts.json) {
      emitJson(resp);
    } else {
      process.stdout.write(`${formatDomainsResponse(resp)}\n`);
    }
  });
}
