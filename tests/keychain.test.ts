import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('keychain JSON storage with config-file fallback', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'quelvio-kc-'));
    process.env.HOME = tempHome;
    vi.resetModules();
  });

  afterEach(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it('round-trips an OAuth blob through the file fallback', async () => {
    vi.doMock('keytar', () => ({ default: null }));
    const kc = await import('../src/auth/keychain.js');
    await kc.setStoredAuth({
      access_token: 'qlv_oat_abc',
      refresh_token: 'qlv_ort_xyz',
      expires_at: 1_700_000_000,
      source: 'oauth',
    });
    const file = join(tempHome, '.quelvio', 'config.json');
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(raw.auth).toMatchObject({
      access_token: 'qlv_oat_abc',
      refresh_token: 'qlv_ort_xyz',
      expires_at: 1_700_000_000,
      source: 'oauth',
    });
    expect(raw.token).toBeUndefined();
    const entry = await kc.getStoredAuth();
    expect(entry).toEqual({
      access_token: 'qlv_oat_abc',
      refresh_token: 'qlv_ort_xyz',
      expires_at: 1_700_000_000,
      source: 'oauth',
    });
  });

  it('backward-compat: a legacy bare-string token in config.json reads as PAT', async () => {
    vi.doMock('keytar', () => ({ default: null }));
    const dir = join(tempHome, '.quelvio');
    require('node:fs').mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'qlv_pat_legacy' }));
    const kc = await import('../src/auth/keychain.js');
    const entry = await kc.getStoredAuth();
    expect(entry).toEqual({ access_token: 'qlv_pat_legacy', source: 'pat' });
    const token = await kc.getStoredToken();
    expect(token).toBe('qlv_pat_legacy');
  });

  it('deleteStoredAuth wipes both auth blob and legacy token', async () => {
    vi.doMock('keytar', () => ({ default: null }));
    const kc = await import('../src/auth/keychain.js');
    await kc.setStoredAuth({ access_token: 'qlv_pat_x', source: 'pat' });
    const dir = join(tempHome, '.quelvio');
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        token: 'qlv_pat_legacy',
        auth: { access_token: 'qlv_pat_x', source: 'pat' },
      }),
    );
    await kc.deleteStoredAuth();
    const raw = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(raw.token).toBeUndefined();
    expect(raw.auth).toBeUndefined();
    expect(await kc.getStoredAuth()).toBeNull();
  });

  it('uses the OS keychain when keytar is available', async () => {
    const store = new Map<string, string>();
    const keytarStub = {
      default: {
        getPassword: vi.fn(async (s: string, a: string) => store.get(`${s}:${a}`) ?? null),
        setPassword: vi.fn(async (s: string, a: string, p: string) => {
          store.set(`${s}:${a}`, p);
        }),
        deletePassword: vi.fn(async (s: string, a: string) => store.delete(`${s}:${a}`)),
      },
    };
    vi.doMock('keytar', () => keytarStub);
    const kc = await import('../src/auth/keychain.js');
    await kc.setStoredAuth({
      access_token: 'qlv_oat_kc',
      refresh_token: 'qlv_ort_kc',
      expires_at: 1234,
      source: 'oauth',
    });
    expect(keytarStub.default.setPassword).toHaveBeenCalled();
    const stored = store.get('quelvio:default');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored as string);
    expect(parsed.access_token).toBe('qlv_oat_kc');
    expect(parsed.source).toBe('oauth');

    const entry = await kc.getStoredAuth();
    expect(entry?.access_token).toBe('qlv_oat_kc');
    expect(entry?.source).toBe('oauth');

    await kc.deleteStoredAuth();
    expect(await kc.getStoredAuth()).toBeNull();
  });

  it('parses a legacy bare-string PAT stored in the keychain (no JSON)', async () => {
    const store = new Map<string, string>([['quelvio:default', 'qlv_pat_legacykc']]);
    vi.doMock('keytar', () => ({
      default: {
        getPassword: vi.fn(async (s: string, a: string) => store.get(`${s}:${a}`) ?? null),
        setPassword: vi.fn(),
        deletePassword: vi.fn(async (s: string, a: string) => store.delete(`${s}:${a}`)),
      },
    }));
    const kc = await import('../src/auth/keychain.js');
    const entry = await kc.getStoredAuth();
    expect(entry).toEqual({ access_token: 'qlv_pat_legacykc', source: 'pat' });
  });
});
