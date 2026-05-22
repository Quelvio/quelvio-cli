import {
  AuthError,
  BadRequestError,
  NetworkError,
  NotAuthenticatedError,
  NotFoundError,
  QuelvioError,
  RateLimitError,
  RefreshFailedError,
  ServerError,
} from '../errors.js';
import { c } from './colors.js';

export type FormattedError = {
  /** The main "error: ..." line, colored. */
  errorLine: string;
  /** Optional dimmed hint line, may be null when no hint applies. */
  hintLine: string | null;
  /** Optional dimmed debug line surfaced only when --verbose. */
  debugLine: string | null;
  /** Process exit code suggested by this error. */
  exitCode: number;
};

const QUOTA_HINT =
  "Hint: you've hit your tenant's daily kT quota. See https://enterprise.quelvio.com/usage for current consumption.";
const NETWORK_HINT = 'Hint: check your internet connection or QUELVIO_API_BASE override.';
const QUERY_404_HINT =
  'Hint: no sources matched. Try broader query terms or check `quelvio domains` for what is indexed.';
const SERVER_HINT =
  'Hint: server-side issue. Status at https://status.quelvio.com or retry in 30s.';
const LOGIN_HINT = 'Hint: run `quelvio login` to authenticate.';
const SESSION_EXPIRED_HINT =
  'Hint: your session has expired. Run `quelvio login` to sign in again.';
const VERBOSE_HINT = 'Hint: rerun with --verbose for full error details.';

function hintFor(err: unknown, verbose: boolean): string | null {
  if (err instanceof NotAuthenticatedError) return LOGIN_HINT;
  if (err instanceof RefreshFailedError) return SESSION_EXPIRED_HINT;
  if (err instanceof AuthError) return SESSION_EXPIRED_HINT;
  if (err instanceof RateLimitError) return QUOTA_HINT;
  if (err instanceof NetworkError) return NETWORK_HINT;
  if (err instanceof NotFoundError) {
    if (err.path && /\/query/i.test(err.path)) return QUERY_404_HINT;
    return null;
  }
  if (err instanceof ServerError) return SERVER_HINT;
  if (err instanceof BadRequestError) return null;
  if (err instanceof QuelvioError) return null;
  if (verbose) return null;
  return VERBOSE_HINT;
}

function messageFor(err: unknown): string {
  if (err instanceof QuelvioError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function exitCodeFor(err: unknown): number {
  if (err instanceof QuelvioError) return err.exitCode;
  return 1;
}

export function formatErrorWithHints(err: unknown, verbose = false): FormattedError {
  try {
    const message = messageFor(err);
    const hint = hintFor(err, verbose);
    let debugLine: string | null = null;
    if (verbose && err instanceof AuthError && err.backendDetail) {
      debugLine = `debug: backend response: ${err.backendDetail}`;
    }
    if (err instanceof RateLimitError && err.retryAfterSeconds !== null) {
      debugLine = `Retry after: ${err.retryAfterSeconds}s`;
    }
    return {
      errorLine: c.red(`error: ${message}`),
      hintLine: hint ? c.dim(hint) : null,
      debugLine: debugLine ? c.dim(debugLine) : null,
      exitCode: exitCodeFor(err),
    };
  } catch {
    const fallback = err instanceof Error ? err.message : String(err);
    return {
      errorLine: `error: ${fallback}`,
      hintLine: null,
      debugLine: null,
      exitCode: 1,
    };
  }
}

export function writeFormattedError(err: unknown, verbose = false): number {
  const formatted = formatErrorWithHints(err, verbose);
  process.stderr.write(`${formatted.errorLine}\n`);
  if (formatted.hintLine) process.stderr.write(`${formatted.hintLine}\n`);
  if (formatted.debugLine) process.stderr.write(`${formatted.debugLine}\n`);
  return formatted.exitCode;
}
