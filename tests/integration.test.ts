import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DIST = join(__dirname, '..', 'dist', 'index.js');
const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
  .version as string;
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
  it('--version prints the package.json version', () => {
    const r = runCli(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(PKG_VERSION);
  });

  it('--help lists every command including completion', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    for (const cmd of [
      'login',
      'logout',
      'query',
      'domains',
      'source',
      'whoami',
      'config',
      'completion',
    ]) {
      expect(r.stdout).toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });
});

describe('integration: shell completion', () => {
  it('quelvio completion bash emits a sourceable bash script', () => {
    const r = runCli(['completion', 'bash']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('_quelvio_completions');
    expect(r.stdout).toContain('complete -F _quelvio_completions quelvio');
    expect(r.stdout).toContain('fast standard deep');
  });

  it('quelvio completion zsh emits a #compdef directive', () => {
    const r = runCli(['completion', 'zsh']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^#compdef quelvio/);
  });

  it('quelvio completion fish emits per-command complete calls', () => {
    const r = runCli(['completion', 'fish']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/complete -c quelvio/);
  });

  it('quelvio completion with no shell prints install hints', () => {
    const r = runCli(['completion']);
    expect(r.stderr).toMatch(/usage: quelvio completion/);
    expect(r.stderr).toMatch(/\.bashrc/);
    expect(r.stderr).toMatch(/\.zshrc/);
    expect(r.stderr).toMatch(/fish\/completions/);
  });
});

describe('integration: smart error hints', () => {
  it('whoami without token shows a "run quelvio login" hint and no Phase 6 reference', () => {
    const r = runCli(['whoami'], { env: { QUELVIO_TOKEN: undefined } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Hint: run `quelvio login`/);
    expect(r.stderr).not.toMatch(/Phase 6/);
    expect(r.stderr).not.toMatch(/once available/);
  });

  it('backend 401 surfaces a session-expired hint on a new line', () => {
    const r = runCli(['whoami'], {
      env: { QUELVIO_TOKEN: 'qlv_pat_bogus_for_hint_test' },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Authentication failed/);
    expect(r.stderr).toMatch(/Hint:.*session has expired/);
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

describe('integration: config telemetry subcommand', () => {
  it('config telemetry on writes telemetry: "on" to the config file', () => {
    const r = runCli(['config', 'telemetry', 'on']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/telemetry on/);
    const list = runCli(['config', 'list']);
    expect(list.stdout).toMatch(/"telemetry":\s*"on"/);
  });

  it('config telemetry off overwrites to "off"', () => {
    runCli(['config', 'telemetry', 'on']);
    const r = runCli(['config', 'telemetry', 'off']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/telemetry off/);
    const list = runCli(['config', 'list']);
    expect(list.stdout).toMatch(/"telemetry":\s*"off"/);
  });

  it('config telemetry status prints clear current state + what is / is not sent', () => {
    runCli(['config', 'telemetry', 'on']);
    const r = runCli(['config', 'telemetry', 'status']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Telemetry:\s*on/);
    expect(r.stdout).toMatch(/Source:/);
    expect(r.stdout).toMatch(/never send/i);
    expect(r.stdout).toMatch(/tokens/i);
    runCli(['config', 'telemetry', 'off']);
  });

  it('config telemetry status reflects env var override', () => {
    runCli(['config', 'telemetry', 'off']);
    const r = runCli(['config', 'telemetry', 'status'], {
      env: { QUELVIO_TELEMETRY: 'on' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Telemetry:\s*on/);
    expect(r.stdout).toMatch(/QUELVIO_TELEMETRY/);
  });

  it('rejects invalid state', () => {
    const r = runCli(['config', 'telemetry', 'banana']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/'on', 'off', or 'status'/);
  });
});

describe('integration: telemetry fire-and-forget invariant', () => {
  it('exit code is identical with or without QUELVIO_TELEMETRY=on (no token → both exit 2)', () => {
    const a = runCli(['whoami'], { env: { QUELVIO_TOKEN: undefined } });
    const b = runCli(['whoami'], {
      env: { QUELVIO_TOKEN: undefined, QUELVIO_TELEMETRY: 'on' },
    });
    expect(a.status).toBe(b.status);
    expect(a.status).toBe(2);
  });

  it('telemetry-enabled run does NOT print telemetry endpoint errors to stderr by default', () => {
    // No token → telemetry resolver silently skips (no auth available) → nothing on stderr
    const r = runCli(['whoami'], {
      env: { QUELVIO_TOKEN: undefined, QUELVIO_TELEMETRY: 'on' },
    });
    expect(r.stderr).not.toMatch(/telemetry:/i);
  });
});
