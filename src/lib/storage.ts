// localStorage for the document, settings and log; the API key stays in sessionStorage unless the user opts in.

const PREFIX = "ttt.";

function read<T>(store: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = store?.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(store: Storage | undefined, key: string, value: unknown) {
  try {
    if (value === undefined) store?.removeItem(PREFIX + key);
    else store?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: keep working in memory.
  }
}

const local = typeof localStorage === "undefined" ? undefined : localStorage;
const session = typeof sessionStorage === "undefined" ? undefined : sessionStorage;

export const load = <T>(key: string, fallback: T) => read(local, key, fallback);
export const save = (key: string, value: unknown) => write(local, key, value);

export type Keys = Partial<Record<string, string>>;

// Keys are per provider. Older versions stored a single Meta key under "key".
export function loadKeys(): Keys {
  const legacy = read(session, "key", "") || read(local, "key", "");
  const keys: Keys = { ...read<Keys>(local, "keys", {}), ...read<Keys>(session, "keys", {}) };
  if (legacy && !keys.meta) keys.meta = legacy;
  return keys;
}

export function saveKeys(keys: Keys, remember: boolean) {
  const clean = Object.fromEntries(Object.entries(keys).filter(([, v]) => v));
  write(session, "keys", clean);
  write(local, "keys", remember ? clean : undefined);
  write(session, "key", undefined);
  write(local, "key", undefined);
}

export const areKeysRemembered = () => Object.keys(read<Keys>(local, "keys", {})).length > 0 || !!read(local, "key", "");
