import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CONFIG_DIR, CONFIG_FILE } from './paths.js';

export type ConfigFile = {
  token?: string;
  api_base?: string;
  default_mode?: string;
  default_max_sources?: number;
};

export function readConfigFile(): ConfigFile {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ConfigFile;
    }
    return {};
  } catch {
    return {};
  }
}

export function writeConfigFile(cfg: ConfigFile): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // ignore — Windows may reject chmod
  }
}

export function updateConfigFile(patch: Partial<ConfigFile>): ConfigFile {
  const current = readConfigFile();
  const next: ConfigFile = { ...current, ...patch };
  writeConfigFile(next);
  return next;
}
