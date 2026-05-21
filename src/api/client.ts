import { arch, platform } from 'node:os';
import { readConfigFile } from '../config/store.js';
import {
  AuthError,
  GenericError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ScopeError,
} from '../errors.js';
import { VERSION } from '../version.js';

const DEFAULT_BASE = 'https://api.quelvio.com';
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

export type DebugLogger = (line: string) => void;

export type ClientOptions = {
  token: string;
  baseUrl?: string;
  debug?: DebugLogger | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export function userAgent(): string {
  return `quelvio-cli/${VERSION} ${platform()}-${arch()}`;
}

export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.QUELVIO_API_BASE;
  if (fromEnv && fromEnv.length > 0) return stripTrailingSlash(fromEnv);
  const fromCfg = readConfigFile().api_base;
  if (fromCfg && fromCfg.length > 0) return stripTrailingSlash(fromCfg);
  return DEFAULT_BASE;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly debug: DebugLogger | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: ClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? resolveBaseUrl();
    this.debug = opts.debug;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
  }

  async stream(opts: RequestOptions): Promise<Response> {
    const url = this.buildUrl(opts.path, opts.query);
    const method = opts.method ?? 'POST';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'text/event-stream',
      'User-Agent': userAgent(),
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    this.log(`→ ${method} ${url} (stream)`);
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      throw new NetworkError(`Network error: ${(err as Error).message ?? String(err)}`, err);
    }
    this.log(`← ${response.status} ${response.statusText} (stream)`);
    if (!response.ok) {
      throw await this.mapErrorResponse(response);
    }
    return response;
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const method = opts.method ?? 'GET';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'User-Agent': userAgent(),
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.log(`→ ${method} ${url}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (err) {
        lastErr = err;
        this.log(`✗ network error: ${(err as Error).message ?? String(err)}`);
        if (attempt < MAX_RETRIES) {
          await this.backoff(attempt);
          continue;
        }
        throw new NetworkError(`Network error: ${(err as Error).message ?? String(err)}`, err);
      }

      this.log(`← ${response.status} ${response.statusText}`);

      if (response.ok) {
        return (await this.parseJson(response)) as T;
      }

      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await this.backoff(attempt);
        continue;
      }

      throw await this.mapErrorResponse(response);
    }

    throw lastErr instanceof Error ? lastErr : new GenericError('Request failed');
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${this.baseUrl}/`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async backoff(attempt: number): Promise<void> {
    const base = BASE_BACKOFF_MS * 2 ** attempt;
    const jitter = 1 + (this.random() * 0.4 - 0.2);
    const delay = Math.round(base * jitter);
    this.log(`… backoff ${delay}ms`);
    await this.sleep(delay);
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new GenericError(`Invalid JSON response from ${response.url}`);
    }
  }

  private async mapErrorResponse(response: Response): Promise<Error> {
    const detail = await this.extractErrorDetail(response);
    const message = detail ?? `${response.status} ${response.statusText}`;

    switch (response.status) {
      case 401:
        return new AuthError(`Authentication failed: ${message}`);
      case 403:
        return new ScopeError(`Forbidden: ${message}`);
      case 404:
        return new NotFoundError(`Not found: ${message}`);
      case 429: {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;
        const suffix =
          retryAfter && !Number.isNaN(retryAfter) ? ` (retry after ${retryAfter}s)` : '';
        return new RateLimitError(
          `Rate limited: ${message}${suffix}`,
          retryAfter && !Number.isNaN(retryAfter) ? retryAfter : null,
        );
      }
      default:
        return new GenericError(`${response.status} ${response.statusText}: ${message}`);
    }
  }

  private async extractErrorDetail(response: Response): Promise<string | null> {
    try {
      const text = await response.text();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
        if (typeof parsed.detail === 'string') return parsed.detail;
        if (typeof parsed.message === 'string') return parsed.message;
        return text.slice(0, 500);
      } catch {
        return text.slice(0, 500);
      }
    } catch {
      return null;
    }
  }

  private log(line: string): void {
    if (this.debug) this.debug(line);
  }
}
