import { afterEach, describe, expect, it, vi } from 'vitest';
import * as keychain from '../src/auth/keychain.js';
import { redactToken, resolveToken } from '../src/auth/token-resolver.js';
import { AuthError, NotAuthenticatedError } from '../src/errors.js';

describe('resolveToken precedence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns flag token first', async () => {
    const result = await resolveToken({
      flagToken: 'qlv_pat_flag',
      env: { QUELVIO_TOKEN: 'qlv_pat_env' },
    });
    expect(result).toEqual({ token: 'qlv_pat_flag', source: 'flag', authMethod: 'pat' });
  });

  it('falls back to env when no flag', async () => {
    const result = await resolveToken({
      env: { QUELVIO_TOKEN: 'qlv_pat_env' },
    });
    expect(result).toEqual({ token: 'qlv_pat_env', source: 'env', authMethod: 'pat' });
  });

  it('classifies service-account tokens by prefix', async () => {
    const result = await resolveToken({
      env: { QUELVIO_TOKEN: 'qlv_sa_bot' },
    });
    expect(result.authMethod).toBe('service-account');
  });

  it('falls back to keychain when no flag or env (oauth blob)', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_oat_keychain',
      refresh_token: 'qlv_ort_x',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      source: 'oauth',
    });
    const result = await resolveToken({ env: {} });
    expect(result.token).toBe('qlv_oat_keychain');
    expect(result.source).toBe('keychain');
    expect(result.authMethod).toBe('oauth');
  });

  it('falls back to keychain (legacy PAT bare-string)', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_pat_keychain',
      source: 'pat',
    });
    const result = await resolveToken({ env: {} });
    expect(result.token).toBe('qlv_pat_keychain');
    expect(result.source).toBe('keychain');
    expect(result.authMethod).toBe('pat');
  });

  it('throws NotAuthenticatedError with hint when nothing found', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue(null);
    await expect(resolveToken({ env: {} })).rejects.toBeInstanceOf(NotAuthenticatedError);
    try {
      await resolveToken({ env: {} });
    } catch (err) {
      expect((err as Error).message).toMatch(/QUELVIO_TOKEN/);
      expect((err as Error).message).toMatch(/enterprise\.quelvio\.com\/account/);
      expect((err as { exitCode: number }).exitCode).toBe(2);
    }
  });

  it('ignores empty-string env and flag', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue(null);
    await expect(
      resolveToken({ flagToken: '', env: { QUELVIO_TOKEN: '' } }),
    ).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});

describe('resolveToken auto-refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-refreshes when within 5 min of expiry', async () => {
    const nowSec = 1_700_000_000;
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_oat_old',
      refresh_token: 'qlv_ort_old',
      expires_at: nowSec + 60, // < 5min from now
      source: 'oauth',
    });
    const setSpy = vi.spyOn(keychain, 'setStoredAuth').mockResolvedValue();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'qlv_oat_new',
          refresh_token: 'qlv_ort_new',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await resolveToken({
      env: {},
      now: () => nowSec,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.token).toBe('qlv_oat_new');
    expect(setSpy).toHaveBeenCalledWith({
      access_token: 'qlv_oat_new',
      refresh_token: 'qlv_ort_new',
      expires_at: nowSec + 3600,
      source: 'oauth',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/oauth\/token$/);
    expect(String((init as { body: string }).body)).toContain('grant_type=refresh_token');
  });

  it('does NOT refresh when expires_at is comfortably in the future', async () => {
    const nowSec = 1_700_000_000;
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_oat_old',
      refresh_token: 'qlv_ort_old',
      expires_at: nowSec + 3600,
      source: 'oauth',
    });
    const setSpy = vi.spyOn(keychain, 'setStoredAuth').mockResolvedValue();
    const fetchImpl = vi.fn();
    const result = await resolveToken({
      env: {},
      now: () => nowSec,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.token).toBe('qlv_oat_old');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('throws AuthError with re-login hint when refresh fails', async () => {
    const nowSec = 1_700_000_000;
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_oat_old',
      refresh_token: 'qlv_ort_revoked',
      expires_at: nowSec - 1,
      source: 'oauth',
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const err = await resolveToken({
      env: {},
      now: () => nowSec,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toMatch(/quelvio login/);
    expect((err as AuthError).exitCode).toBe(2);
  });

  it('does not refresh a legacy PAT entry even when expires_at is missing', async () => {
    vi.spyOn(keychain, 'getStoredAuth').mockResolvedValue({
      access_token: 'qlv_pat_x',
      source: 'pat',
    });
    const fetchImpl = vi.fn();
    const result = await resolveToken({
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.token).toBe('qlv_pat_x');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('redactToken', () => {
  it('keeps a recognisable prefix', () => {
    const redacted = redactToken('qlv_pat_a1b2c3d4e5f6');
    expect(redacted.startsWith('qlv_pat_')).toBe(true);
    expect(redacted).toMatch(/\.\.\.$/);
  });
  it('handles short tokens', () => {
    expect(redactToken('abc')).toBe('abc...');
  });
});
