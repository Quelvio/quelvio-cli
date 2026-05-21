import { afterEach, describe, expect, it, vi } from 'vitest';
import * as keychain from '../src/auth/keychain.js';
import { redactToken, resolveToken } from '../src/auth/token-resolver.js';
import { NotAuthenticatedError } from '../src/errors.js';

describe('resolveToken precedence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns flag token first', async () => {
    const result = await resolveToken({
      flagToken: 'qlv_pat_flag',
      env: { QUELVIO_TOKEN: 'qlv_pat_env' },
    });
    expect(result).toEqual({ token: 'qlv_pat_flag', source: 'flag' });
  });

  it('falls back to env when no flag', async () => {
    const result = await resolveToken({
      env: { QUELVIO_TOKEN: 'qlv_pat_env' },
    });
    expect(result).toEqual({ token: 'qlv_pat_env', source: 'env' });
  });

  it('falls back to keychain when no flag or env', async () => {
    vi.spyOn(keychain, 'getStoredToken').mockResolvedValue('qlv_pat_keychain');
    const result = await resolveToken({ env: {} });
    expect(result.token).toBe('qlv_pat_keychain');
    expect(['keychain', 'config']).toContain(result.source);
  });

  it('throws NotAuthenticatedError with hint when nothing found', async () => {
    vi.spyOn(keychain, 'getStoredToken').mockResolvedValue(null);
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
    vi.spyOn(keychain, 'getStoredToken').mockResolvedValue(null);
    await expect(
      resolveToken({ flagToken: '', env: { QUELVIO_TOKEN: '' } }),
    ).rejects.toBeInstanceOf(NotAuthenticatedError);
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
