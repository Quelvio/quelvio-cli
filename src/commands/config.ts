import type { Command } from 'commander';
import { CONFIG_FILE } from '../config/paths.js';
import { readConfigFile, writeConfigFile } from '../config/store.js';
import { GenericError } from '../errors.js';

const ALLOWED_KEYS = ['api_base', 'default_mode', 'default_max_sources'] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

const ALLOWED_MODES = new Set(['fast', 'standard', 'deep']);

function assertAllowed(key: string): AllowedKey {
  if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
    throw new GenericError(`unknown config key '${key}'. Allowed: ${ALLOWED_KEYS.join(', ')}`);
  }
  return key as AllowedKey;
}

function coerce(key: AllowedKey, value: string): string | number {
  if (key === 'default_max_sources') {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n) || n < 1 || n > 10) {
      throw new GenericError(`default_max_sources must be an integer 1-10 (got '${value}')`);
    }
    return n;
  }
  if (key === 'default_mode') {
    if (!ALLOWED_MODES.has(value)) {
      throw new GenericError(`default_mode must be one of: fast, standard, deep (got '${value}')`);
    }
    return value;
  }
  if (key === 'api_base') {
    try {
      const u = new URL(value);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('protocol');
      }
    } catch {
      throw new GenericError(`api_base must be a valid http(s) URL (got '${value}')`);
    }
    return value;
  }
  return value;
}

function maskSensitive(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'token') continue;
    out[k] = v;
  }
  return out;
}

export function registerConfigCommand(program: Command): void {
  const cmd = program.command('config').description('Manage the local config file');

  cmd
    .command('list')
    .description('Print the current config')
    .action(() => {
      const cfg = readConfigFile();
      const visible = maskSensitive(cfg as Record<string, unknown>);
      process.stdout.write(`# ${CONFIG_FILE}\n`);
      process.stdout.write(`${JSON.stringify(visible, null, 2)}\n`);
    });

  cmd
    .command('get <key>')
    .description('Print the value of a config key')
    .action((key: string) => {
      const k = assertAllowed(key);
      const cfg = readConfigFile() as Record<string, unknown>;
      const v = cfg[k];
      if (v === undefined) {
        process.stdout.write('\n');
        process.exitCode = 0;
        return;
      }
      process.stdout.write(`${String(v)}\n`);
    });

  cmd
    .command('set <key> <value>')
    .description('Set a config key')
    .action((key: string, value: string) => {
      const k = assertAllowed(key);
      const v = coerce(k, value);
      const cfg = readConfigFile();
      const next = { ...cfg, [k]: v };
      writeConfigFile(next);
      process.stdout.write(`set ${k} = ${String(v)}\n`);
    });

  cmd
    .command('unset <key>')
    .description('Remove a config key')
    .action((key: string) => {
      const k = assertAllowed(key);
      const cfg = readConfigFile() as Record<string, unknown>;
      if (cfg[k] === undefined) {
        process.stdout.write(`${k} is already unset\n`);
        return;
      }
      delete cfg[k];
      writeConfigFile(cfg);
      process.stdout.write(`unset ${k}\n`);
    });
}
