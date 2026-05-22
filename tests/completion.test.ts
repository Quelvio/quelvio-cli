import { describe, expect, it } from 'vitest';
import {
  bashCompletionScript,
  completionScriptFor,
  fishCompletionScript,
  zshCompletionScript,
} from '../src/commands/completion.js';

describe('completion scripts', () => {
  it('bash script includes all commands and the --mode value list', () => {
    const s = bashCompletionScript();
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
      expect(s).toContain(cmd);
    }
    expect(s).toContain('fast');
    expect(s).toContain('standard');
    expect(s).toContain('deep');
    expect(s).toContain('complete -F _quelvio_completions quelvio');
  });

  it('zsh script declares compdef and lists subcommands', () => {
    const s = zshCompletionScript();
    expect(s).toContain('#compdef quelvio');
    expect(s).toContain('login');
    expect(s).toContain('completion');
    expect(s).toContain('--mode');
    expect(s).toContain('compdef _quelvio quelvio');
  });

  it('fish script registers completion -c quelvio for each command', () => {
    const s = fishCompletionScript();
    expect(s).toMatch(/complete -c quelvio.*-a "login"/);
    expect(s).toMatch(/complete -c quelvio.*-a "whoami"/);
    expect(s).toMatch(/-l mode -xa "fast standard deep"/);
  });

  it('completionScriptFor dispatches by shell name', () => {
    expect(completionScriptFor('bash')).toBe(bashCompletionScript());
    expect(completionScriptFor('zsh')).toBe(zshCompletionScript());
    expect(completionScriptFor('fish')).toBe(fishCompletionScript());
  });

  it('completionScriptFor rejects unknown shells', () => {
    expect(() => completionScriptFor('pwsh')).toThrow(/unsupported shell/);
  });
});
