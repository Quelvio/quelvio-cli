import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DIST = join(__dirname, '..', 'dist', 'index.js');
let tempHome: string;

beforeAll(() => {
  if (!existsSync(DIST)) {
    spawnSync('pnpm', ['build'], { stdio: 'inherit' });
  }
  tempHome = mkdtempSync(join(tmpdir(), 'quelvio-int-'));
});

afterAll(() => {
  try {
    rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

type RunOpts = {
  env?: Record<string, string | undefined>;
  input?: string;
};

function runCli(args: string[], opts: RunOpts = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tempHome,
    NO_COLOR: '1',
    ...opts.env,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete env[k];
  }
  return spawnSync('node', [DIST, ...args], {
    env,
    input: opts.input,
    encoding: 'utf8',
  });
}

describe('integration: --version / --help', () => {
  it('--version prints 0.2.0', () => {
    const r = runCli(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0.2.0');
  });

  it('--help lists every command', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    for (const cmd of ['login', 'logout', 'query', 'domains', 'source', 'whoami', 'config']) {
      expect(r.stdout).toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });
});

describe('integration: auth required', () => {
  it('whoami without a token exits 2', () => {
    const r = runCli(['whoami'], { env: { QUELVIO_TOKEN: undefined } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/QUELVIO_TOKEN/);
  });

  it('domains without a token exits 2', () => {
    const r = runCli(['domains'], { env: { QUELVIO_TOKEN: undefined } });
    expect(r.status).toBe(2);
  });

  it('--verbose does NOT leak the token to stderr', () => {
    const token = 'qlv_pat_SUPER_SECRET_test_token_value';
    // Point QUELVIO_API_BASE at an unroutable address so the request fails fast.
    const r = runCli(['domains', '--verbose'], {
      env: {
        QUELVIO_TOKEN: token,
        QUELVIO_API_BASE: 'http://127.0.0.1:1', // nothing listening
      },
    });
    expect(r.stderr).not.toContain(token);
    expect(r.stdout).not.toContain(token);
    expect(r.stderr).not.toContain('SUPER_SECRET');
  });
});

describe('integration: 401 message rendering', () => {
  it('default 401 surface is friendly and never says "JWT"', () => {
    const r = runCli(['whoami'], {
      env: { QUELVIO_TOKEN: 'qlv_pat_bogus_for_rendering_test' },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Authentication failed/);
    expect(r.stderr).toMatch(/invalid, expired, or revoked/);
    expect(r.stderr).toMatch(/enterprise\.quelvio\.com\/account/);
    expect(r.stderr).toMatch(/QUELVIO_TOKEN=qlv_pat_/);
    expect(r.stderr).not.toMatch(/JWT/);
    expect(r.stderr).not.toMatch(/debug: backend response/);
  });

  it('--verbose adds a debug line with the backend detail', () => {
    const r = runCli(['whoami', '--verbose'], {
      env: { QUELVIO_TOKEN: 'qlv_pat_bogus_for_rendering_test' },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Authentication failed/);
    expect(r.stderr).toMatch(/debug: backend response:/);
  });
});

describe('integration: logout idempotency', () => {
  it('logout when not logged in returns exit 0 with friendly message', () => {
    const r = runCli(['logout'], { env: { QUELVIO_TOKEN: undefined } });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Not logged in/);
  });
});

describe('integration: config command', () => {
  it('set / get / list / unset roundtrip', () => {
    let r = runCli(['config', 'set', 'default_mode', 'deep']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('set default_mode = deep');

    r = runCli(['config', 'get', 'default_mode']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('deep');

    r = runCli(['config', 'list']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('default_mode');
    expect(r.stdout).not.toContain('token');

    r = runCli(['config', 'unset', 'default_mode']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('unset default_mode');
  });

  it('rejects unknown keys', () => {
    const r = runCli(['config', 'set', 'nope', 'x']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown config key/);
  });

  it('validates default_mode value', () => {
    const r = runCli(['config', 'set', 'default_mode', 'banana']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/default_mode must be one of/);
  });

  it('validates default_max_sources range', () => {
    const r = runCli(['config', 'set', 'default_max_sources', '99']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/1-10/);
  });

  it('validates api_base URL', () => {
    const r = runCli(['config', 'set', 'api_base', 'not-a-url']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/api_base must be a valid http\(s\) URL/);
  });
});
