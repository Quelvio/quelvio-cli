import { describe, expect, it } from 'vitest';
import { stripEditorComments } from '../src/commands/query.js';

describe('stripEditorComments', () => {
  it('removes lines starting with #', () => {
    const input = '# header\nwhat is our SLA?\n# trailer\n';
    expect(stripEditorComments(input)).toBe('what is our SLA?');
  });

  it('returns empty string for buffer with only comments and whitespace', () => {
    const input = '# Type your query below.\n# Lines starting with # are ignored.\n\n   \n';
    expect(stripEditorComments(input)).toBe('');
  });

  it('preserves multi-line non-comment content', () => {
    const input = '# header\nFirst paragraph.\n\nSecond paragraph.\n# trailer';
    expect(stripEditorComments(input)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('does not treat inline # as a comment', () => {
    const input = 'compare branches #1 and #2 of release notes\n';
    expect(stripEditorComments(input)).toBe('compare branches #1 and #2 of release notes');
  });
});
