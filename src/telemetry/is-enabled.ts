import { readConfigFile } from '../config/store.js';

export type TelemetrySource = 'env' | 'config' | 'default';
export type TelemetryResolution = { enabled: boolean; source: TelemetrySource };

function parseFlag(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'on' || v === '1' || v === 'true') return true;
  if (v === 'off' || v === '0' || v === 'false') return false;
  return null;
}

export function resolveTelemetry(
  env: NodeJS.ProcessEnv = process.env,
  cfg: { telemetry?: string | undefined } | undefined = undefined,
): TelemetryResolution {
  const envFlag = parseFlag(env.QUELVIO_TELEMETRY);
  if (envFlag !== null) return { enabled: envFlag, source: 'env' };

  const config = cfg ?? readConfigFile();
  const cfgFlag = parseFlag(config.telemetry);
  if (cfgFlag !== null) return { enabled: cfgFlag, source: 'config' };

  return { enabled: false, source: 'default' };
}

export function isTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveTelemetry(env).enabled;
}
