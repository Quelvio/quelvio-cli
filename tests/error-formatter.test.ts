import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  BadRequestError,
  GenericError,
  NetworkError,
  NotAuthenticatedError,
  NotFoundError,
  RateLimitError,
  RefreshFailedError,
  ServerError,
} from '../src/errors.js';
import { setColorMode } from '../src/output/colors.js';
import { formatErrorWithHints } from '../src/output/error-formatter.js';

beforeEach(() => {
  setColorMode('never');
});

describe('formatErrorWithHints', () => {
  it('NotAuthenticatedError → "quelvio login" hint', () => {
    const f = formatErrorWithHints(new NotAuthenticatedError());
    expect(f.errorLine).toMatch(/No authentication token found/);
    expect(f.errorLine).not.toMatch(/Phase 6/);
    expect(f.errorLine).not.toMatch(/once available/);
    expect(f.hintLine).toMatch(/Hint: run `quelvio login`/);
    expect(f.exitCode).toBe(2);
  });

  it('RefreshFailedError → session-expired hint', () => {
    const f = formatErrorWithHints(new RefreshFailedError('invalid_grant'));
    expect(f.hintLine).toMatch(/Hint: your session has expired/);
    expect(f.exitCode).toBe(2);
  });

  it('Generic AuthError (backend 401) → session hint, message intact', () => {
    const f = formatErrorWithHints(new AuthError('Authentication failed.'));
    expect(f.errorLine).toMatch(/Authentication failed/);
    expect(f.hintLine).toMatch(/Hint:/);
  });

  it('RateLimitError → quota hint + retry-after debug line', () => {
    const f = formatErrorWithHints(new RateLimitError('Rate limited', 30));
    expect(f.hintLine).toMatch(/daily kT quota/);
    expect(f.hintLine).toMatch(/enterprise\.quelvio\.com\/usage/);
    expect(f.debugLine).toMatch(/Retry after: 30s/);
    expect(f.exitCode).toBe(4);
  });

  it('NetworkError → internet/QUELVIO_API_BASE hint', () => {
    const f = formatErrorWithHints(new NetworkError('ECONNREFUSED'));
    expect(f.hintLine).toMatch(/check your internet connection/);
    expect(f.hintLine).toMatch(/QUELVIO_API_BASE/);
    expect(f.exitCode).toBe(7);
  });

  it('NotFoundError on /query → "no sources" hint', () => {
    const f = formatErrorWithHints(new NotFoundError('Not found: nothing', '/v1/enterprise/query'));
    expect(f.hintLine).toMatch(/no sources matched/);
    expect(f.hintLine).toMatch(/quelvio domains/);
  });

  it('NotFoundError on other paths → no hint', () => {
    const f = formatErrorWithHints(new NotFoundError('Not found', '/v1/other'));
    expect(f.hintLine).toBeNull();
  });

  it('ServerError → status.quelvio.com hint', () => {
    const f = formatErrorWithHints(new ServerError('Server error: 503', 503));
    expect(f.hintLine).toMatch(/status\.quelvio\.com/);
  });

  it('BadRequestError surfaces detail and adds no hint', () => {
    const f = formatErrorWithHints(new BadRequestError('domain_filter must be a string'));
    expect(f.errorLine).toMatch(/domain_filter must be a string/);
    expect(f.hintLine).toBeNull();
  });

  it('Unknown plain Error → verbose hint when not verbose', () => {
    const f = formatErrorWithHints(new Error('boom'), false);
    expect(f.errorLine).toMatch(/boom/);
    expect(f.hintLine).toMatch(/rerun with --verbose/);
  });

  it('Unknown plain Error → no hint when verbose', () => {
    const f = formatErrorWithHints(new Error('boom'), true);
    expect(f.hintLine).toBeNull();
  });

  it('GenericError gets no hint (no known class match)', () => {
    const f = formatErrorWithHints(new GenericError('whatever'));
    expect(f.hintLine).toBeNull();
  });

  it('Auth backend detail surfaces only when verbose', () => {
    const err = new AuthError('Authentication failed.', 'invalid_token');
    const quiet = formatErrorWithHints(err, false);
    const verbose = formatErrorWithHints(err, true);
    expect(quiet.debugLine).toBeNull();
    expect(verbose.debugLine).toMatch(/backend response: invalid_token/);
  });

  it('still returns a result when given a non-Error value', () => {
    const f = formatErrorWithHints('plain string');
    expect(f.errorLine).toMatch(/plain string/);
    expect(f.exitCode).toBe(1);
  });
});
