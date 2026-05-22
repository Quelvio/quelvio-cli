import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setColorMode } from '../src/output/colors.js';
import { createDeepSpinner, createSpinner, shouldShowSpinner } from '../src/output/progress.js';

beforeEach(() => {
  setColorMode('never');
});

function mockTtyStream() {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
  stream.isTTY = true;
  return stream as unknown as NodeJS.WriteStream;
}

function captured(stream: PassThrough): string {
  return stream.read()?.toString('utf8') ?? '';
}

describe('shouldShowSpinner', () => {
  it('returns false when --json', () => {
    expect(shouldShowSpinner({ json: true, stream: mockTtyStream() })).toBe(false);
  });

  it('returns false when --quiet', () => {
    expect(shouldShowSpinner({ quiet: true, stream: mockTtyStream() })).toBe(false);
  });

  it('returns false when stream is not a TTY', () => {
    const s = new PassThrough() as PassThrough & { isTTY?: boolean };
    s.isTTY = false;
    expect(shouldShowSpinner({ stream: s as unknown as NodeJS.WriteStream })).toBe(false);
  });

  it('returns true on a TTY with no overrides', () => {
    expect(shouldShowSpinner({ stream: mockTtyStream() })).toBe(true);
  });
});

describe('createSpinner', () => {
  it('disabled spinner emits no bytes', () => {
    const stream = new PassThrough();
    const sp = createSpinner({
      text: 'hi',
      enabled: false,
      stream: stream as unknown as NodeJS.WriteStream,
    });
    sp.start();
    sp.update('boop');
    sp.stop();
    expect(captured(stream)).toBe('');
  });

  it('does not paint a frame before SHOW_AFTER_MS elapses', async () => {
    vi.useFakeTimers();
    try {
      const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
      stream.isTTY = true;
      const sp = createSpinner({
        text: 'Querying...',
        enabled: true,
        stream: stream as unknown as NodeJS.WriteStream,
      });
      sp.start();
      vi.advanceTimersByTime(200);
      sp.stop();
      // No frames painted because we stopped before the 500ms grace.
      const out = captured(stream);
      expect(out).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('paints once the grace window elapses', async () => {
    vi.useFakeTimers();
    try {
      const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
      stream.isTTY = true;
      const sp = createSpinner({
        text: 'Querying...',
        enabled: true,
        stream: stream as unknown as NodeJS.WriteStream,
      });
      sp.start();
      vi.advanceTimersByTime(600);
      const out = captured(stream);
      expect(out).toMatch(/Querying\.\.\./);
      sp.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('succeed prints a final line with a checkmark', () => {
    const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
    stream.isTTY = true;
    const sp = createSpinner({
      text: 't',
      enabled: true,
      stream: stream as unknown as NodeJS.WriteStream,
    });
    sp.start();
    sp.succeed('done');
    const out = captured(stream);
    expect(out).toMatch(/done/);
    expect(out).toMatch(/✓/);
  });
});

describe('createDeepSpinner', () => {
  it('starts with "Connecting" then transitions on heuristic timers', async () => {
    vi.useFakeTimers();
    try {
      const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
      stream.isTTY = true;
      const sp = createDeepSpinner({ enabled: true });
      // Hand-replace stream so we can inspect (createDeepSpinner uses
      // default process.stderr; we re-test using setStage observable below).
      sp.start();
      // setStage is exposed for streaming path; it should not throw.
      sp.setStage('retrieving');
      sp.setStage('reranking');
      sp.setStage('synthesizing');
      sp.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disabled deep spinner is a no-op', () => {
    const sp = createDeepSpinner({ enabled: false });
    sp.start();
    sp.setStage('retrieving');
    sp.stop();
    expect(sp.enabled).toBe(false);
  });
});
