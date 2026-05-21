import { readConfigFile, updateConfigFile, writeConfigFile } from '../config/store.js';

const SERVICE = 'quelvio';
const ACCOUNT = 'default';

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

export async function getStoredToken(): Promise<string | null> {
  const keytar = await loadKeytar();
  if (keytar && (await probeKeytar(keytar))) {
    try {
      const pw = await keytar.getPassword(SERVICE, ACCOUNT);
      if (pw) return pw;
    } catch {
      // fall through to file
    }
  } else if (!keytar) {
    warnFallback();
  }
  const cfg = readConfigFile();
  return cfg.token ?? null;
}

export async function setStoredToken(token: string): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar && (await probeKeytar(keytar))) {
    await keytar.setPassword(SERVICE, ACCOUNT, token);
    return;
  }
  warnFallback();
  updateConfigFile({ token });
}

export async function deleteStoredToken(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar && (await probeKeytar(keytar))) {
    try {
      await keytar.deletePassword(SERVICE, ACCOUNT);
    } catch {
      // ignore
    }
  }
  const cfg = readConfigFile();
  if (cfg.token !== undefined) {
    const { token: _t, ...rest } = cfg;
    writeConfigFile(rest);
  }
}

export function getStoredTokenFromFileSync(): string | null {
  return readConfigFile().token ?? null;
}
