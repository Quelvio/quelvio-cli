export class QuelvioError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'QuelvioError';
    this.exitCode = exitCode;
  }
}

export class GenericError extends QuelvioError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'GenericError';
  }
}

export class AuthError extends QuelvioError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'AuthError';
  }
}

export class NotAuthenticatedError extends AuthError {
  constructor() {
    super(
      "No authentication token found. Set QUELVIO_TOKEN to a Personal Access Token from https://enterprise.quelvio.com/account, or run 'quelvio login' once available (Phase 6).",
    );
    this.name = 'NotAuthenticatedError';
  }
}

export class NotFoundError extends QuelvioError {
  constructor(message: string) {
    super(message, 3);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends QuelvioError {
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message, 4);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class TruncatedError extends QuelvioError {
  constructor(message: string) {
    super(message, 5);
    this.name = 'TruncatedError';
  }
}

export class ScopeError extends QuelvioError {
  constructor(message: string) {
    super(message, 6);
    this.name = 'ScopeError';
  }
}

export class NetworkError extends QuelvioError {
  constructor(message: string, cause?: unknown) {
    super(message, 7);
    this.name = 'NetworkError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}
