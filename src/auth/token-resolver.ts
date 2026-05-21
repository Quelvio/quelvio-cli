import { readConfigFile } from '../config/store.js';
import { NotAuthenticatedError } from '../errors.js';
import { getStoredToken } from './keychain.js';

export type TokenSource = 'flag' | 'env' | 'keychain' | 'config';

export type ResolvedToken = {
  token: string;
  source: TokenSource;
};

export type ResolveOptions = {
  flagToken?: string | undefined;
  env?: NodeJS.ProcessEnv;
};

export async function resolveToken(opts: ResolveOptions = {}): Promise<ResolvedToken> {
  const env = opts.env ?? process.env;

  if (opts.flagToken && opts.flagToken.length > 0) {
    return { token: opts.flagToken, source: 'flag' };
  }

  const envToken = env.QUELVIO_TOKEN;
  if (envToken && envToken.length > 0) {
    return { token: envToken, source: 'env' };
  }

  const keychainToken = await getStoredToken();
  if (keychainToken && keychainToken.length > 0) {
    const cfg = readConfigFile();
    const source: TokenSource = cfg.token === keychainToken ? 'config' : 'keychain';
    return { token: keychainToken, source };
  }

  throw new NotAuthenticatedError();
}

export function redactToken(token: string): string {
  if (token.length <= 16) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 12)}...`;
}
