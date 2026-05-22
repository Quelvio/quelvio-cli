import { c } from './colors.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;
const SHOW_AFTER_MS = 500;

export type SpinnerOptions = {
  /** Initial text shown next to the spinner. */
  text: string;
  /** Output stream; defaults to process.stderr. */
  stream?: NodeJS.WriteStream;
  /** When false, the spinner is a no-op (used for --json, non-TTY, --quiet). */
  enabled?: boolean;
};

export type Spinner = {
  start: () => Spinner;
  update: (text: string) => void;
  stop: (finalText?: string) => void;
  succeed: (finalText?: string) => void;
  fail: (finalText?: string) => void;
  readonly enabled: boolean;
};

export function shouldShowSpinner(opts: {
  json?: boolean;
  quiet?: boolean;
  stream?: NodeJS.WriteStream;
}): boolean {
  if (opts.json) return false;
  if (opts.quiet) return false;
  const stream = opts.stream ?? process.stderr;
  return Boolean(stream.isTTY);
}

export function createSpinner(opts: SpinnerOptions): Spinner {
  const stream = opts.stream ?? process.stderr;
  const enabled = opts.enabled !== false;
  let text = opts.text;
  let frame = 0;
  let frameTimer: NodeJS.Timeout | null = null;
  let showTimer: NodeJS.Timeout | null = null;
  let visible = false;

  function clearLine(): void {
    if (!enabled || !visible) return;
    stream.write('\r\x1b[2K');
  }

  function paint(): void {
    if (!enabled) return;
    visible = true;
    stream.write(`\r${c.cyan(FRAMES[frame] as string)} ${text}`);
    frame = (frame + 1) % FRAMES.length;
  }

  function startFrames(): void {
    if (frameTimer) return;
    paint();
    frameTimer = setInterval(paint, FRAME_INTERVAL_MS);
    if (typeof frameTimer.unref === 'function') frameTimer.unref();
  }

  const spinner: Spinner = {
    get enabled() {
      return enabled;
    },
    start() {
      if (!enabled) return spinner;
      // Defer the first render so commands that complete <500ms stay silent.
      showTimer = setTimeout(() => {
        startFrames();
      }, SHOW_AFTER_MS);
      if (typeof showTimer.unref === 'function') showTimer.unref();
      return spinner;
    },
    update(next: string) {
      text = next;
      if (visible) {
        clearLine();
        paint();
      }
    },
    stop(finalText?: string) {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (frameTimer) {
        clearInterval(frameTimer);
        frameTimer = null;
      }
      clearLine();
      visible = false;
      if (finalText && enabled) {
        stream.write(`${finalText}\n`);
      }
    },
    succeed(finalText?: string) {
      this.stop(finalText ? `${c.green('✓')} ${finalText}` : undefined);
    },
    fail(finalText?: string) {
      this.stop(finalText ? `${c.red('✗')} ${finalText}` : undefined);
    },
  };

  return spinner;
}

export type DeepStage = 'connecting' | 'retrieving' | 'reranking' | 'synthesizing';

const DEEP_STAGE_TEXT: Record<DeepStage, string> = {
  connecting: 'Connecting to Quelvio...',
  retrieving: 'Retrieving relevant passages...',
  reranking: 'Re-ranking with cross-encoder...',
  synthesizing: 'Synthesizing answer...',
};

/**
 * Spinner that advances through the four deep-mode stages on a heuristic
 * timer. Used only when SSE streaming is unavailable.
 */
export function createDeepSpinner(opts: { enabled?: boolean }): Spinner & {
  setStage: (s: DeepStage) => void;
} {
  const spinner = createSpinner({
    text: DEEP_STAGE_TEXT.connecting,
    enabled: opts.enabled !== false,
  });

  const transitions: Array<[number, DeepStage]> = [
    [1500, 'retrieving'],
    [4500, 'reranking'],
    [8000, 'synthesizing'],
  ];
  const timers: NodeJS.Timeout[] = [];

  function start(): typeof spinner {
    spinner.start();
    if (!spinner.enabled) return spinner;
    const startTime = Date.now();
    for (const [delay, stage] of transitions) {
      const t = setTimeout(
        () => {
          if (Date.now() - startTime >= delay) {
            spinner.update(DEEP_STAGE_TEXT[stage]);
          }
        },
        Math.max(0, delay),
      );
      if (typeof t.unref === 'function') t.unref();
      timers.push(t);
    }
    return spinner;
  }

  function clearTransitions(): void {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  }

  return {
    ...spinner,
    start: () => {
      start();
      return spinner;
    },
    update: spinner.update.bind(spinner),
    stop: (msg?: string) => {
      clearTransitions();
      spinner.stop(msg);
    },
    succeed: (msg?: string) => {
      clearTransitions();
      spinner.succeed(msg);
    },
    fail: (msg?: string) => {
      clearTransitions();
      spinner.fail(msg);
    },
    setStage: (s: DeepStage) => spinner.update(DEEP_STAGE_TEXT[s]),
    get enabled() {
      return spinner.enabled;
    },
  };
}
