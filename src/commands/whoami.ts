import type { Command } from 'commander';
import { redactToken } from '../auth/token-resolver.js';
import {
  type WhoamiContext,
  type WhoamiResponse,
  formatWhoamiResponse,
} from '../output/formatters.js';
import { type CommonOpts, addCommonOpts, buildClient, emitJson } from './common.js';

export function registerWhoamiCommand(program: Command): void {
  const cmd = program.command('whoami').description('Show the signed-in user and tenant');

  addCommonOpts(cmd);

  cmd.action(async (opts: CommonOpts) => {
    const { client, token, authMethod } = await buildClient(opts);
    const resp = await client.request<WhoamiResponse>({
      method: 'GET',
      path: '/v1/enterprise/me',
    });
    const ctx: WhoamiContext = {
      tokenPrefix: redactToken(token),
      authMethod,
    };
    if (opts.json) {
      emitJson({ ...resp, auth_method: ctx.authMethod });
    } else {
      process.stdout.write(`${formatWhoamiResponse(resp, ctx)}\n`);
    }
  });
}
