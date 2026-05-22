import { resolveBaseUrl } from '../api/client.js';
import { NotAuthenticatedError, RefreshFailedError } from '../errors.js';
import { DeviceFlowError, refreshToken as oauthRefresh } from './device-flow.js';
import { type AuthEntry, getStoredAuth, setStoredAuth } from './keychain.js';

export type TokenSource = 'flag' | 'env' | 'keychain' | 'config';
export type AuthMethod = 'pat' | 'oauth' | 'service-account';

export type ResolvedToken = {
  token: string;
  source: TokenSource;
  authMethod: AuthMethod;
};

export type ResolveOptions = {
  flagToken?: string | undefined;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  fetchImpl?: typeof fetch;
  verbose?: boolean;
};

const REFRESH_LEAD_SECONDS = 5 * 60;

function methodForToken(token: string): AuthMethod {
  if (token.startsWith('qlv_sa_')) return 'service-account';
  if (token.startsWith('qlv_oat_')) return 'oauth';
  return 'pat';
}

export async function resolveToken(opts: ResolveOptions = {}): Promise<ResolvedToken> {
  const env = opts.env ?? process.env;

  if (opts.flagToken && opts.flagToken.length > 0) {
    return {
      token: opts.flagToken,
      source: 'flag',
      authMethod: methodForToken(opts.flagToken),
    };
  }

  const envToken = env.QUELVIO_TOKEN;
  if (envToken && envToken.length > 0) {
    return { token: envToken, source: 'env', authMethod: methodForToken(envToken) };
  }

  const entry = await getStoredAuth();
  if (entry && entry.access_token.length > 0) {
    const refreshed = await maybeRefresh(entry, opts);
    const authMethod: AuthMethod =
      refreshed.source === 'oauth' ? 'oauth' : methodForToken(refreshed.access_token);
    return { token: refreshed.access_token, source: 'keychain', authMethod };
  }

  throw new NotAuthenticatedError();
}

async function maybeRefresh(entry: AuthEntry, opts: ResolveOptions): Promise<AuthEntry> {
  if (entry.source !== 'oauth' || !entry.refresh_token || entry.expires_at === undefined) {
    return entry;
  }
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (entry.expires_at - now > REFRESH_LEAD_SECONDS) {
    return entry;
  }
  if (opts.verbose) {
    process.stderr.write('debug: refreshing OAuth token (within 5 min of expiry)\n');
  }
  try {
    const baseUrl = resolveBaseUrl(opts.env);
    const fresh = await oauthRefresh({
      baseUrl,
      refreshToken: entry.refresh_token,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    const next: AuthEntry = {
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: now + fresh.expires_in,
      source: 'oauth',
    };
    await setStoredAuth(next);
    return next;
  } catch (err) {
    if (err instanceof DeviceFlowError) {
      throw new RefreshFailedError(err.code);
    }
    throw err;
  }
}

export function redactToken(token: string): string {
  if (token.length <= 16) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 12)}...`;
}
