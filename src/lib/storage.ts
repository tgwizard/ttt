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

export function loadKey(): string {
  return read(session, "key", "") || read(local, "key", "");
}

export function saveKey(key: string, remember: boolean) {
  write(session, "key", key || undefined);
  write(local, "key", remember && key ? key : undefined);
}

export const isKeyRemembered = () => !!read(local, "key", "");
