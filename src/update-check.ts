import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NPM_REGISTRY = 'https://registry.npmjs.org/@quelvio/cli';
const FETCH_TIMEOUT_MS = 2000;

type CacheFile = {
  lastCheckMs?: number;
  latestVersion?: string;
};

let pendingFetch: Promise<void> | null = null;
let knownNewer: { current: string; latest: string } | null = null;
let suppressed = false;

function cacheDir(): string {
  return join(homedir(), '.quelvio');
}

function cachePath(): string {
  return join(cacheDir(), 'update-check.json');
}

function readCache(): CacheFile {
  try {
    if (!existsSync(cachePath())) return {};
    const raw = readFileSync(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CacheFile;
    }
    return {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheFile): void {
  try {
    if (!existsSync(cacheDir())) {
      mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
    }
    writeFileSync(cachePath(), `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  } catch {
    // ignore: update-check is best-effort.
  }
}

export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.QUELVIO_UPDATE_CHECK;
  if (!v) return false;
  return v.toLowerCase() === 'off' || v === '0' || v.toLowerCase() === 'false';
}

export function isUpdateCheckForced(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.QUELVIO_UPDATE_CHECK;
  if (!v) return false;
  return v.toLowerCase() === 'force';
}

function looksInteractive(): boolean {
  // Only fetch in the background when stderr is a TTY. Piped output
  // (CI, tests, scripts) skips the network call and only relies on the
  // 24-hour cache — keeping non-interactive runs fast and silent.
  return Boolean(process.stderr.isTTY);
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [
    Number.parseInt(m[1] as string, 10),
    Number.parseInt(m[2] as string, 10),
    Number.parseInt(m[3] as string, 10),
  ];
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(NPM_REGISTRY, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    return data['dist-tags']?.latest ?? null;
  } catch {
    return null;
  }
}

/**
 * Synchronously consult the cache to see whether a newer version is known,
 * and schedule a fresh registry check (at most once per 24h) in the
 * background. Updates from the background fetch land in the cache for the
 * NEXT invocation — we never block this run on the network.
 */
export function queueUpdateCheck(currentVersion: string): void {
  if (suppressed) return;
  if (isUpdateCheckDisabled()) return;

  const cache = readCache();
  if (cache.latestVersion && isNewer(cache.latestVersion, currentVersion)) {
    knownNewer = { current: currentVersion, latest: cache.latestVersion };
  }

  const now = Date.now();
  const lastCheck = cache.lastCheckMs ?? 0;
  if (now - lastCheck < CHECK_INTERVAL_MS) return;
  if (pendingFetch) return;
  if (!looksInteractive() && !isUpdateCheckForced()) return;

  pendingFetch = (async () => {
    try {
      const latest = await fetchLatestVersion();
      if (latest) {
        writeCache({ lastCheckMs: now, latestVersion: latest });
      } else {
        writeCache({
          lastCheckMs: now,
          ...(cache.latestVersion ? { latestVersion: cache.latestVersion } : {}),
        });
      }
    } catch {
      // Swallow — update-check is best-effort.
    }
  })();
}

/**
 * Emit a one-line notice on stderr if the cache says a newer version exists.
 * Synchronous and silent if nothing to report.
 */
export function notifyIfUpdateAvailable(): void {
  if (!knownNewer) return;
  const { current, latest } = knownNewer;
  process.stderr.write(
    `\n→ New version available: ${latest} (you have ${current}). Run: npm i -g @quelvio/cli@latest\n`,
  );
}

export function suppressUpdateCheck(): void {
  suppressed = true;
  knownNewer = null;
}

export function _resetUpdateCheckForTests(): void {
  pendingFetch = null;
  knownNewer = null;
  suppressed = false;
}
