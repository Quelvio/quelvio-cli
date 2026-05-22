import { type StoredAuth, readConfigFile, writeConfigFile } from '../config/store.js';

const SERVICE = 'quelvio';
const ACCOUNT = 'default';

export type AuthSource = 'oauth' | 'pat';

export type AuthEntry = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  source: AuthSource;
};

type Keytar = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytarPromise: Promise<Keytar | null> | undefined;
let warnedOnFallback = false;

function loadKeytar(): Promise<Keytar | null> {
  if (!keytarPromise) {
    keytarPromise = (async () => {
      try {
        const mod = (await import('keytar')) as { default?: Keytar } & Partial<Keytar>;
        const candidate = mod.default ?? (mod as unknown as Keytar);
        if (
          candidate &&
          typeof candidate.getPassword === 'function' &&
          typeof candidate.setPassword === 'function' &&
          typeof candidate.deletePassword === 'function'
        ) {
          return candidate;
        }
        return null;
      } catch {
        return null;
      }
    })();
  }
  return keytarPromise;
}

function warnFallback(): void {
  if (warnedOnFallback) return;
  warnedOnFallback = true;
  process.stderr.write(
    'OS keychain unavailable; using ~/.quelvio/config.json with 0600 perms. Install libsecret-1-0 (Linux) to enable keychain.\n',
  );
}

async function probeKeytar(keytar: Keytar): Promise<boolean> {
  try {
    await keytar.getPassword(SERVICE, ACCOUNT);
    return true;
  } catch {
    return false;
  }
}

function normalizeEntry(raw: unknown): AuthEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.access_token !== 'string' || r.access_token.length === 0) return null;
  const entry: AuthEntry = {
    access_token: r.access_token,
    source: r.source === 'oauth' ? 'oauth' : 'pat',
  };
  if (typeof r.refresh_token === 'string' && r.refresh_token.length > 0) {
    entry.refresh_token = r.refresh_token;
  }
  if (typeof r.expires_at === 'number' && Number.isFinite(r.expires_at)) {
    entry.expires_at = r.expires_at;
  }
  return entry;
}

function parseKeychainValue(stored: string): AuthEntry {
  const trimmed = stored.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const normalized = normalizeEntry(parsed);
      if (normalized) return normalized;
    } catch {
      // fall through — treat as legacy bare string
    }
  }
  return { access_token: stored, source: 'pat' };
}

export async function getStoredAuth(): Promise<AuthEntry | null> {
  const keytar = await loadKeytar();
  if (keytar && (await probeKeytar(keytar))) {
    try {
      const pw = await keytar.getPassword(SERVICE, ACCOUNT);
      if (pw) return parseKeychainValue(pw);
    } catch {
      // fall through to file
    }
  } else if (!keytar) {
    warnFallback();
  }
  const cfg = readConfigFile();
  if (cfg.auth) {
    const normalized = normalizeEntry(cfg.auth);
    if (normalized) return normalized;
  }
  if (cfg.token) return { access_token: cfg.token, source: 'pat' };
  return null;
}

export async function setStoredAuth(entry: AuthEntry): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar && (await probeKeytar(keytar))) {
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(entry));
    const cfg = readConfigFile();
    if (cfg.token !== undefined || cfg.auth !== undefined) {
      const { token: _t, auth: _a, ...rest } = cfg;
      writeConfigFile(rest);
    }
    return;
  }
  warnFallback();
  const cfg = readConfigFile();
  const { token: _t, ...rest } = cfg;
  const stored: StoredAuth = {
    access_token: entry.access_token,
    source: entry.source,
    ...(entry.refresh_token ? { refresh_token: entry.refresh_token } : {}),
    ...(entry.expires_at !== undefined ? { expires_at: entry.expires_at } : {}),
  };
  writeConfigFile({ ...rest, auth: stored });
}

export async function deleteStoredAuth(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar && (await probeKeytar(keytar))) {
    try {
      await keytar.deletePassword(SERVICE, ACCOUNT);
    } catch {
      // ignore
    }
  }
  const cfg = readConfigFile();
  if (cfg.token !== undefined || cfg.auth !== undefined) {
    const { token: _t, auth: _a, ...rest } = cfg;
    writeConfigFile(rest);
  }
}

export async function getStoredToken(): Promise<string | null> {
  const entry = await getStoredAuth();
  return entry?.access_token ?? null;
}

export async function setStoredToken(token: string): Promise<void> {
  await setStoredAuth({ access_token: token, source: 'pat' });
}

export async function deleteStoredToken(): Promise<void> {
  await deleteStoredAuth();
}

export function getStoredTokenFromFileSync(): string | null {
  const cfg = readConfigFile();
  if (cfg.auth?.access_token) return cfg.auth.access_token;
  return cfg.token ?? null;
}
