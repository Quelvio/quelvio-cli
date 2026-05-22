# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
