import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli.js';

describe('cli', () => {
  it('--version prints 0.0.0', () => {
    const program = buildProgram().exitOverride();
    const writeOut = vi.fn();
    program.configureOutput({ writeOut, writeErr: writeOut });

    expect(() => program.parse(['node', 'quelvio', '--version'])).toThrow(
      expect.objectContaining({ code: 'commander.version' }),
    );

    const printed = writeOut.mock.calls.map((c) => String(c[0])).join('');
    expect(printed.trim()).toBe('0.0.0');
  });
});
