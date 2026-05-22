import { userAgent } from '../api/client.js';

export const CLIENT_ID = 'quelvio-cli';

export type DeviceAuthorization = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type TokenSuccess = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in: number;
};

export type OAuthErrorBody = {
  error?: string;
  error_description?: string;
};

export type DeviceFlowOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export class DeviceFlowError extends Error {
  readonly code: string;
  readonly description: string | undefined;

  constructor(code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
    this.name = 'DeviceFlowError';
    this.code = code;
    this.description = description;
  }
}

function stripSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function formEncode(body: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) params.set(k, v);
  }
  return params.toString();
}

function commonHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    Accept: 'application/json',
    'User-Agent': userAgent(),
  };
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function deviceAuthorize(opts: DeviceFlowOptions): Promise<DeviceAuthorization> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${stripSlash(opts.baseUrl)}/oauth/device/authorize`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: commonHeaders('application/json'),
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  const body = (await readJsonBody(res)) as DeviceAuthorization | OAuthErrorBody | null;
  if (!res.ok) {
    const err = (body ?? {}) as OAuthErrorBody;
    throw new DeviceFlowError(err.error ?? `http_${res.status}`, err.error_description);
  }
  if (!body || typeof (body as DeviceAuthorization).device_code !== 'string') {
    throw new DeviceFlowError('invalid_response', 'device authorize response missing device_code');
  }
  return body as DeviceAuthorization;
}

export type PollResult =
  | { kind: 'success'; tokens: TokenSuccess }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'error'; code: string; description?: string };

export async function pollToken(
  opts: DeviceFlowOptions & { deviceCode: string },
): Promise<PollResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${stripSlash(opts.baseUrl)}/oauth/token`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: commonHeaders('application/x-www-form-urlencoded'),
    body: formEncode({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: opts.deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  const body = (await readJsonBody(res)) as TokenSuccess | OAuthErrorBody | null;
  if (res.ok && body && typeof (body as TokenSuccess).access_token === 'string') {
    return { kind: 'success', tokens: body as TokenSuccess };
  }
  const err = (body ?? {}) as OAuthErrorBody;
  switch (err.error) {
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slow_down' };
    case 'expired_token':
      return { kind: 'expired' };
    case 'access_denied':
      return { kind: 'denied' };
    default:
      return {
        kind: 'error',
        code: err.error ?? `http_${res.status}`,
        ...(err.error_description ? { description: err.error_description } : {}),
      };
  }
}

export async function refreshToken(
  opts: DeviceFlowOptions & { refreshToken: string },
): Promise<TokenSuccess> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${stripSlash(opts.baseUrl)}/oauth/token`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: commonHeaders('application/x-www-form-urlencoded'),
    body: formEncode({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  const body = (await readJsonBody(res)) as TokenSuccess | OAuthErrorBody | null;
  if (res.ok && body && typeof (body as TokenSuccess).access_token === 'string') {
    return body as TokenSuccess;
  }
  const err = (body ?? {}) as OAuthErrorBody;
  throw new DeviceFlowError(err.error ?? `http_${res.status}`, err.error_description);
}

export async function revokeToken(
  opts: DeviceFlowOptions & {
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
  },
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${stripSlash(opts.baseUrl)}/oauth/revoke`;
  await fetchImpl(url, {
    method: 'POST',
    headers: commonHeaders('application/x-www-form-urlencoded'),
    body: formEncode({
      token: opts.token,
      ...(opts.tokenTypeHint ? { token_type_hint: opts.tokenTypeHint } : {}),
    }),
  });
}
