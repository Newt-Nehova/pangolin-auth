/**
 * IndexedDB, used as a tiny key-value store.
 *
 * Two keys only:
 *   "vault" -- the encrypted blob. Everything sensitive, including account names.
 *   "meta"  -- plain settings with nothing secret in them (auto-lock, last backup).
 */
import type { VaultBlob } from "./crypto";

const DB_NAME = "pangolin";
const STORE = "kv";

export interface Meta {
  autoLockSeconds: number;
  lastBackupAt: string | null;
  /** Bumped on every vault change; compared with lastBackupAt to know if a backup is stale. */
  lastChangeAt: string | null;
  /**
   * Last time the passcode itself was typed correctly. Fingerprint unlock
   * stops working after 30 days without it, so the passcode -- the only way
   * in after a biometric reset -- doesn't get forgotten. Not secret: editing
   * it only skips a reminder, it never bypasses the fingerprint.
   */
  lastPasscodeAt: string | null;
  /** Overwrite the clipboard 30s after copying a code, if nothing else was copied since. */
  clearClipboard: boolean;
  /** One-line cards for long lists. */
  compact: boolean;
  createdAt: string;
}

export const DEFAULT_META: Meta = {
  autoLockSeconds: 60,
  lastBackupAt: null,
  lastChangeAt: null,
  lastPasscodeAt: null,
  clearClipboard: true,
  compact: false,
  createdAt: new Date(0).toISOString(),
};

/** Fingerprint unlock pauses after this long without the passcode being typed. */
export const PASSCODE_CHECK_DAYS = 30;

export function passcodeCheckDue(meta: Meta, now = Date.now()): boolean {
  if (!meta.lastPasscodeAt) return true;
  return now - Date.parse(meta.lastPasscodeAt) > PASSCODE_CHECK_DAYS * 86_400_000;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    // Resolve on commit, not on request success: only then is it on disk.
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const loadVault = () => get<VaultBlob>("vault");
export const saveVault = (blob: VaultBlob) => put("vault", blob);

export async function loadMeta(): Promise<Meta> {
  return { ...DEFAULT_META, ...((await get<Meta>("meta")) ?? {}) };
}
export const saveMeta = (meta: Meta) => put("meta", meta);

/** Erase everything. Only reachable from Settings behind a typed confirmation. */
export async function wipe(): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Ask the browser not to evict our data under storage pressure. Without this,
 * Safari in particular may clear a site's storage after a spell of disuse --
 * which for an authenticator means losing every account.
 */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
