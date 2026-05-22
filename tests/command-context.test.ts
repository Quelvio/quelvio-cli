import { describe, expect, it } from 'vitest';
import { getCommandName } from '../src/lib/command-context.js';

describe('getCommandName', () => {
  it('returns the top-level command for query', () => {
    expect(getCommandName(['node', 'quelvio', 'query', 'hello world'])).toBe('query');
  });

  it('returns "source" for source <id>', () => {
    expect(getCommandName(['node', 'quelvio', 'source', '9f3a-...'])).toBe('source');
  });

  it('returns "config:telemetry" for config telemetry subcommands', () => {
    expect(getCommandName(['node', 'quelvio', 'config', 'telemetry', 'on'])).toBe(
      'config:telemetry',
    );
    expect(getCommandName(['node', 'quelvio', 'config', 'telemetry', 'off'])).toBe(
      'config:telemetry',
    );
    expect(getCommandName(['node', 'quelvio', 'config', 'telemetry', 'status'])).toBe(
      'config:telemetry',
    );
  });

  it('returns plain "config" for other config subcommands', () => {
    expect(getCommandName(['node', 'quelvio', 'config', 'list'])).toBe('config');
    expect(getCommandName(['node', 'quelvio', 'config', 'set', 'default_mode', 'deep'])).toBe(
      'config',
    );
  });

  it('returns "completion" for completion bash', () => {
    expect(getCommandName(['node', 'quelvio', 'completion', 'bash'])).toBe('completion');
  });

  it('returns null for --help with no command', () => {
    expect(getCommandName(['node', 'quelvio', '--help'])).toBe(null);
  });

  it('returns null for no args', () => {
    expect(getCommandName(['node', 'quelvio'])).toBe(null);
  });

  it('returns null for unknown command names', () => {
    expect(getCommandName(['node', 'quelvio', 'nope-not-real'])).toBe(null);
  });

  it('skips leading flags before the command', () => {
    expect(getCommandName(['node', 'quelvio', '--verbose', 'query', 'hi'])).toBe('query');
  });

  it('does NOT leak the query text — value is just "query"', () => {
    const result = getCommandName([
      'node',
      'quelvio',
      'query',
      'secret-info-do-not-leak this contents here',
    ]);
    expect(result).toBe('query');
    expect(result).not.toContain('secret-info');
  });
});
