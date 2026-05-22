# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0]

### Added
- **Shell completions.** `quelvio completion {bash,zsh,fish}` outputs a
  hand-written completion script to stdout, covering every top-level command,
  common flags, `--mode` values, and the `completion`/`config` subcommand
  trees. Zero new runtime dependencies — the scripts are vendored in
  `src/commands/completion.ts`. Install hints are in the README.
- **Smart error hints.** Known error classes (auth missing, session expired,
  rate limit, network, server 5xx, query 404, unknown) now append a dimmed
  one-line "Hint: ..." beneath the friendly error message. Hints are
  additive — if the formatter itself fails, the original error still prints.
- **Progress indicators on long queries.** `--mode standard` and `--mode fast`
  show a single-line spinner ("Querying...") on stderr; `--mode deep`
  advances through "Connecting / Retrieving / Re-ranking / Synthesizing"
  via a heuristic timer. The spinner is deferred 500ms so cache-hit responses
  stay silent, and is disabled entirely when `--json`, `--quiet`, or
  non-TTY stderr is in effect.
- **Update-check on launch.** Every invocation consults a 24h-cached
  `~/.quelvio/update-check.json` and, if a newer `@quelvio/cli` is
  published on npm, prints a one-line notice to stderr after the command
  completes. Background fetch only runs on interactive TTYs so CI stays
  fast. Set `QUELVIO_UPDATE_CHECK=off` to disable.
- **`$EDITOR` multi-line query polish.** `quelvio query` with no positional
  argument opens `$EDITOR` (then `$VISUAL`, then `vi`) with a `.md` scratch
  file. `quelvio query --editor` forces the editor even when text is on the
  command line. An empty editor buffer cancels with `Empty query, cancelled.`
  exit 0. `quelvio query -` continues to read from stdin.

### Changed
- `NotAuthenticatedError` message no longer references "Phase 6" — that
  copy was left over from v0.1.0 and is stale now that `quelvio login`
  ships. The hint above the message points to `quelvio login`.
- HTTP 400 responses now surface the backend `detail` directly via a new
  `BadRequestError` instead of the generic `400 Bad Request` fallthrough.
- HTTP 5xx errors that survive retry now raise a dedicated `ServerError`,
  enabling the "status.quelvio.com or retry" hint.

## [0.2.0]

### Added
- `quelvio login` — interactive OAuth 2.0 Device Authorization Grant (RFC 8628). Opens
  the verification URL in the default browser, shows a user code, polls
  `/oauth/token` until the user approves, and persists the resulting access +
  refresh pair in the OS keychain (or `~/.quelvio/config.json` if the keychain
  is unavailable). Use `--no-browser` to print the URL instead of launching one.
- `quelvio logout` — best-effort `/oauth/revoke` for both refresh and access
  token, then wipes the local entry. Idempotent: exits 0 with a friendly
  message when no token is present.
- Automatic token refresh: the token resolver detects OAuth entries within
  5 minutes of expiry and silently rotates them via the refresh-token grant.
  Refresh failures surface as `AuthError` (exit 2) with a "run `quelvio login`"
  hint.

### Changed
- Keychain storage is now a JSON blob — `{access_token, refresh_token?,
  expires_at?, source}`. v0.1.0 bare-string PATs continue to read correctly.
- `quelvio whoami` reports `auth_method` ("oauth" or "pat") from the stored
  source, not just the token prefix.
