import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli.js';

const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
  .version as string;

describe('cli', () => {
  it('--version prints the package.json version', () => {
    const program = buildProgram().exitOverride();
    const writeOut = vi.fn();
    program.configureOutput({ writeOut, writeErr: writeOut });

    expect(() => program.parse(['node', 'quelvio', '--version'])).toThrow(
      expect.objectContaining({ code: 'commander.version' }),
    );

    const printed = writeOut.mock.calls.map((c) => String(c[0])).join('');
    expect(printed.trim()).toBe(PKG_VERSION);
  });

  it('--help lists every command', () => {
    const program = buildProgram().exitOverride();
    const writeOut = vi.fn();
    program.configureOutput({ writeOut, writeErr: writeOut });

    expect(() => program.parse(['node', 'quelvio', '--help'])).toThrow(
      expect.objectContaining({ code: 'commander.helpDisplayed' }),
    );

    const printed = writeOut.mock.calls.map((c) => String(c[0])).join('');
    for (const cmd of ['login', 'logout', 'query', 'domains', 'source', 'whoami', 'config']) {
      expect(printed).toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });
});
