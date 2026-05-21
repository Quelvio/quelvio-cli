# @quelvio/cli

> Query your enterprise knowledge brain from the command line.

`quelvio` is the official command-line client for the Quelvio Enterprise API. It puts every connected source — Drive, SharePoint, Confluence, Slack, Notion — behind a single, scriptable interface that returns cited, synthesized answers in human-readable or JSON form. Every request is attributed to the human running it via their Personal Access Token, so audits stay clean and per-employee permission filters apply automatically.

## Install

> The CLI is pre-release. `npm` install will work once Phase 4 publishes the package; native binaries ship in Phase 11.

```sh
# After Phase 4 ships:
npm i -g @quelvio/cli

# Verify:
quelvio --version
```

Local development install:

```sh
git clone https://github.com/Quelvio/quelvio-cli
cd quelvio-cli
pnpm install
pnpm build
node dist/index.js --version
```

Node 20.10 or newer is required.

## Quickstart

1. Generate a Personal Access Token in the dashboard:
   <https://enterprise.quelvio.com/account> → **Personal API Keys** → **Create token**.
2. Export it:
   ```sh
   export QUELVIO_TOKEN=qlv_pat_<your-key>
   ```
3. Verify auth works:
   ```sh
   quelvio whoami
   ```
4. Ask the brain a question:
   ```sh
   quelvio query "what is our deployment process?"
   ```

## Authentication

`quelvio` resolves a token from the following sources, in order, and uses the first non-empty one:

| Precedence | Source                  | Notes                                                                  |
| ---------- | ----------------------- | ---------------------------------------------------------------------- |
| 1          | `--token <t>` flag      | Overrides everything; never persisted.                                 |
| 2          | `QUELVIO_TOKEN` env var | The recommended way to run the CLI in CI and ad-hoc shells.            |
| 3          | OS keychain             | Populated by `quelvio login` (ships in Phase 6 / 0.2.x).               |
| 4          | `~/.quelvio/config.json`| Fallback when the OS keychain is unavailable (e.g. headless Linux).    |

The token is never echoed to stdout, stderr, or logs. The keychain or config file holds the value at rest; `--verbose` HTTP traces redact the `Authorization` header.

**Authentication methods on the roadmap:**
- **PAT (this release).** A long-lived bearer token tied to a human user. Every query is attributed to that user; permissions and rate limits apply per identity.
- **OAuth login** (Phase 6). `quelvio login` will perform a browser-based device-code flow and stash the resulting token in your OS keychain.
- **Service accounts** (Phase 8/9). For headless agents and CI bots that need an identity distinct from a human's.

## Commands

Every command supports the global flags `--token <t>`, `--json`, `--no-color`, `--verbose`, and `--quiet`. Use `quelvio <command> --help` for the full flag list.

### `quelvio query <text>`

Ask the brain a natural-language question.

```sh
quelvio query "what is our incident response policy?"
quelvio query --mode deep --max-sources 8 "compare our Q3 vs Q4 deployment cadence"
quelvio query --domain engineering.platform "who owns the auth middleware?"
echo "draft a release note for v1.4" | quelvio query
quelvio query --json "what is our SLA?" | jq '.synthesis'
```

| Flag                 | Default     | Description                                                                                      |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `--mode <m>`         | `standard`  | `fast` (retrieval only, no synthesis), `standard` (default), or `deep` (wider retrieval + premium synthesis). |
| `--max-sources <n>`  | `5`         | Number of source chunks (1–10).                                                                  |
| `--domain <d>`       | _none_      | Restrict to a taxonomy domain (e.g. `engineering.platform`). Discover values with `quelvio domains`. |
| `--stream`           | off         | Stream synthesis tokens as they arrive (SSE). Falls back to non-streaming if unsupported.        |
| `--no-wait`          | off         | Return the `query_id` immediately for async polling.                                             |
| `--json`             | off         | Emit the raw API response as JSON.                                                               |
| `--quiet`            | off         | Suppress the metadata footer (Query ID, kT, latency).                                            |

If no positional text is given:
- piped stdin is read and used as the query;
- otherwise `$EDITOR` (or `vi`) opens for a multi-line prompt.

Default output (TTY):

```
<synthesized answer with [1] [2] citation markers>

Sources:
  [1] runbooks/incident-response.md (confluence) — alice@acme.com, 3d ago
  [2] eng-week-2026-04-15.slack (slack) — bob@acme.com, 2w ago

Query ID: 9f3a-...  ·  Coverage: high  ·  kT: 12500  ·  1820ms
```

### `quelvio domains`

List the tenant's taxonomy domains, with coverage levels — useful before issuing a billable query.

```sh
quelvio domains
quelvio domains --json | jq '.domains[].taxonomy_domain'
```

### `quelvio source <query-id>`

Show per-chunk provenance for a previous query — document path, connector, lifecycle state, embedded timestamp, contributor, last source update.

```sh
quelvio source 9f3a4d8c-7b2e-4a3d-b1c5-1f2e3d4a5b6c
quelvio source 9f3a... --json
```

This call consumes zero Knowledge Tokens.

### `quelvio whoami`

Print the signed-in identity, tenant, auth method, and a redacted token prefix.

```sh
quelvio whoami
quelvio whoami --json
```

Sample output:

```
Signed in as: alice@acme.com
Tenant:       ACME Corp (aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)
Auth method:  pat
Token prefix: qlv_pat_a1b2...
```

### `quelvio config <list|get|set|unset>`

Persist defaults in `~/.quelvio/config.json` so you don't repeat flags.

```sh
quelvio config list
quelvio config get default_mode
quelvio config set default_mode deep
quelvio config set default_max_sources 8
quelvio config set api_base https://api.staging.quelvio.com
quelvio config unset api_base
```

| Key                  | Type    | Default                      |
| -------------------- | ------- | ---------------------------- |
| `api_base`           | URL     | `https://api.quelvio.com`    |
| `default_mode`       | enum    | `standard`                   |
| `default_max_sources`| int 1-10| `5`                          |

`config list` never prints the token — use the keychain or `QUELVIO_TOKEN` env var instead.

## Configuration

| Variable / file              | Purpose                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `QUELVIO_TOKEN`              | Personal Access Token. Highest-precedence non-flag source.                                       |
| `QUELVIO_API_BASE`           | Override the API base URL (defaults to `https://api.quelvio.com`). Useful for staging.           |
| `NO_COLOR`                   | Set to any non-empty value to suppress ANSI colors. Standard across CLIs; `quelvio` honors it.   |
| `EDITOR` / `VISUAL`          | Used by `quelvio query` when no positional text and stdin is a TTY.                              |
| `~/.quelvio/config.json`     | Persisted defaults (mode `0600`). Also holds the token when the OS keychain isn't available.     |

## Exit codes

| Code | Meaning                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- |
| 0    | success                                                                                            |
| 1    | generic / unknown error                                                                            |
| 2    | authentication problem — missing token, expired token, 401 from backend                            |
| 3    | resource not found (404)                                                                           |
| 4    | rate limited (429) — see the `Retry-After` hint in stderr                                          |
| 5    | response truncated (synthesis exceeded the 25k-token cap)                                          |
| 6    | scope / permission error (403)                                                                     |
| 7    | network error — DNS failure, connection refused, TLS error                                         |

## Output formats

`quelvio` is designed for two audiences:

- **Humans.** The default output is prose with ANSI color, citation bolding, and a metadata footer. Colors auto-disable when stdout is not a TTY or when `NO_COLOR` is set.
- **Agents and scripts.** Add `--json` to any command for a machine-readable response. Pretty-printed when stdout is a TTY, compact when piped — always parseable by `jq`.

```sh
quelvio query "what is our SLA?" --json | jq -r '.synthesis'
quelvio domains --json | jq -r '.domains[] | "\(.taxonomy_domain)\t\(.document_count)"'
```

## Examples

### Bash one-liner

```sh
QUELVIO_TOKEN="qlv_pat_..." \
  quelvio query --json "summarize our security policies" \
  | jq -r '.synthesis' \
  | tee summary.md
```

### GitHub Actions

```yaml
name: nightly-knowledge-digest
on:
  schedule:
    - cron: '0 13 * * *'
jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm i -g @quelvio/cli
      - name: Generate digest
        env:
          QUELVIO_TOKEN: ${{ secrets.QUELVIO_PAT }}
        run: |
          quelvio query "what changed in eng this week?" --mode deep --json \
            | jq -r '.synthesis' > digest.md
      - uses: actions/upload-artifact@v4
        with:
          name: digest
          path: digest.md
```

### Claude Code

Inside a Claude Code session, the CLI is the recommended way to ask Quelvio questions that produce auditable, cited answers:

```
quelvio query "what is the rollback procedure for production deploys?"
```

A first-party agent skills package (separate repo) will ship in Phase 12 with conversational wrappers, follow-up handling, and `get_source_detail`-aware citation walking. Until then, treat `quelvio` as a normal shell tool.

## Troubleshooting

| Symptom                                                                              | Likely cause + fix                                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `No authentication token found.` (exit 2)                                            | Export `QUELVIO_TOKEN`, or pass `--token <t>`.                                                                            |
| `Authentication failed: Invalid enterprise API key.` (exit 2)                        | Token revoked, expired, or copied incorrectly. Generate a new one at https://enterprise.quelvio.com/account.              |
| `Forbidden: ...` (exit 6)                                                            | The token's identity lacks permission for that document/domain. Ask the tenant owner; permission filters apply per user.  |
| `Rate limited: ... (retry after Ns)` (exit 4)                                        | Back off `N` seconds; the CLI doesn't auto-retry 429.                                                                     |
| `Network error: ...` (exit 7)                                                        | DNS or TLS failure. Check connectivity to `api.quelvio.com`; try `curl -v https://api.quelvio.com/openapi.json`.          |
| `OS keychain unavailable; using ~/.quelvio/config.json`                              | Linux without `libsecret`. Install `libsecret-1-0` (Debian/Ubuntu) or `libsecret` (Fedora/Arch) to use the OS keychain.   |
| `default_max_sources must be an integer 1-10`                                        | The backend caps results at 10 chunks. Lower the value.                                                                   |

`--verbose` adds HTTP trace lines to stderr — useful when reporting issues.

## Limitations

- **OAuth login is not yet implemented.** Use `QUELVIO_TOKEN` (a PAT) for now. `quelvio login` ships in 0.2.0 (Phase 6).
- **Streaming is best-effort.** `--stream` falls back to non-streaming on backends that don't expose `/v1/enterprise/query/stream` or return a non-SSE content-type.
- **No offline mode.** Every command except `config` requires connectivity to `api.quelvio.com`.
- **Result count clamped at 10.** The backend caps `--max-sources` at 10 to match marketplace behavior; values above 10 are silently clamped down.
- **Service accounts are not yet supported.** Ship in Phase 8/9.

## License

MIT. See [LICENSE](./LICENSE).

---

Full documentation, including conceptual guides and the API reference, lives at <https://quelvio.com/docs/cli>.
