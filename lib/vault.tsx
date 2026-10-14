"use client";

/**
 * The vault's live state, shared through React context.
 *
 * Locked means: no key and no accounts in memory, only the encrypted blob on
 * disk. Locking drops both references; there is nothing to "clear" beyond that.
 *
 * Saves are chained one after another so two quick edits can never land out
 * of order and leave the older list on disk.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { enrollBiometric, evaluatePrf, forgetPasskey } from "./biometric";
import {
  addPrfWrap,
  changePasscode as rewrap,
  createVault,
  fromB64,
  prfWrapOf,
  removePrfWrap,
  sealEntries,
  unlockVault,
  unlockVaultWithPrf,
  type VaultBlob,
} from "./crypto";
import { DEFAULT_META, PASSCODE_CHECK_DAYS, passcodeCheckDue, loadMeta, loadVault, requestPersistence, saveMeta, saveVault, wipe, type Meta } from "./db";
import { newEntry } from "./entries";
import type { Entry, EntryDraft } from "./types";

type Status = "loading" | "new" | "locked" | "open" | "unsupported";

export { PASSCODE_CHECK_DAYS, passcodeCheckDue };

export class PasscodeCheckDueError extends Error {
  constructor() {
    super("Monthly check: type your passcode this time.");
  }
}

interface VaultApi {
  status: Status;
  entries: Entry[];
  meta: Meta;
  persisted: boolean | null;
  /** When fingerprint/face unlock was turned on, or null. Readable while locked. */
  biometricSince: string | null;
  create(passcode: string): Promise<void>;
  unlock(passcode: string): Promise<void>;
  unlockWithBiometric(): Promise<void>;
  /** Re-checks who is holding the phone before something sensitive (export). Changes nothing. */
  confirmIdentity(passcode: string): Promise<void>;
  confirmIdentityWithBiometric(): Promise<void>;
  enableBiometric(passcode: string): Promise<void>;
  disableBiometric(): Promise<void>;
  lock(): void;
  add(drafts: EntryDraft[]): Promise<number>;
  update(id: string, patch: Partial<Pick<Entry, "issuer" | "account" | "counter">>): Promise<void>;
  remove(ids: string[]): Promise<void>;
  move(id: string, delta: -1 | 1): Promise<void>;
  /** Replaces every account -- only used by restore-from-backup in "replace" mode. */
  replaceAll(entries: Entry[]): Promise<void>;
  changePasscode(current: string, next: string): Promise<void>;
  setMeta(patch: Partial<Meta>): Promise<void>;
  erase(): Promise<void>;
}

const VaultContext = createContext<VaultApi | null>(null);

export function useVault(): VaultApi {
  const api = useContext(VaultContext);
  if (!api) throw new Error("useVault outside VaultProvider");
  return api;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [meta, setMetaState] = useState<Meta>(DEFAULT_META);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [biometricSince, setBiometricSince] = useState<string | null>(null);

  // Refs hold the authoritative copies so chained saves never see stale state.
  const blobRef = useRef<VaultBlob | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const entriesRef = useRef<Entry[]>([]);
  const metaRef = useRef<Meta>(DEFAULT_META);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  /** Every write of the blob goes through here so the biometric flag can't drift. */
  const setBlob = useCallback((blob: VaultBlob | null) => {
    blobRef.current = blob;
    setBiometricSince(blob ? (prfWrapOf(blob)?.createdAt ?? null) : null);
  }, []);

  useEffect(() => {
    (async () => {
      if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
        // crypto.subtle only exists on HTTPS or localhost.
        setStatus("unsupported");
        return;
      }
      const [blob, m] = await Promise.all([loadVault(), loadMeta()]);
      metaRef.current = m;
      setMetaState(m);
      setBlob(blob ?? null);
      setStatus(blob ? "locked" : "new");
      setPersisted(await requestPersistence().catch(() => null));
    })().catch(() => setStatus("unsupported"));
  }, [setBlob]);

  const lock = useCallback(() => {
    keyRef.current = null;
    entriesRef.current = [];
    setEntries([]);
    setStatus((s) => (s === "open" ? "locked" : s));
  }, []);

  /** Queue a write. Every mutation goes through here. */
  const commit = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(work, work);
    chain.current = next.catch(() => undefined);
    return next;
  }, []);

  const writeMeta = useCallback(async (patch: Partial<Meta>) => {
    const m = { ...metaRef.current, ...patch };
    metaRef.current = m;
    setMetaState(m);
    await saveMeta(m);
  }, []);

  const persist = useCallback(
    (next: Entry[]) =>
      commit(async () => {
        const key = keyRef.current;
        const blob = blobRef.current;
        if (!key || !blob) throw new Error("The vault is locked.");
        const sealed = await sealEntries(blob, key, next);
        await saveVault(sealed);
        setBlob(sealed);
        entriesRef.current = next;
        setEntries(next);
        await writeMeta({ lastChangeAt: new Date().toISOString() });
      }),
    [commit, writeMeta, setBlob]
  );

  const api: VaultApi = {
    status,
    entries,
    meta,
    persisted,
    biometricSince,

    create: (passcode) =>
      commit(async () => {
        const { blob, key } = await createVault(passcode);
        await saveVault(blob);
        setBlob(blob);
        keyRef.current = key;
        entriesRef.current = [];
        setEntries([]);
        const stamp = new Date().toISOString();
        await writeMeta({ createdAt: stamp, lastPasscodeAt: stamp });
        setStatus("open");
        setPersisted(await requestPersistence().catch(() => null));
      }),

    unlock: async (passcode) => {
      const blob = blobRef.current;
      if (!blob) throw new Error("No vault yet.");
      const { key, entries: list } = await unlockVault(blob, passcode);
      keyRef.current = key;
      entriesRef.current = list;
      setEntries(list);
      setStatus("open");
      await commit(() => writeMeta({ lastPasscodeAt: new Date().toISOString() }));
    },

    unlockWithBiometric: async () => {
      const blob = blobRef.current;
      const wrap = blob && prfWrapOf(blob);
      if (!blob || !wrap) throw new Error("Biometric unlock is not set up.");
      if (passcodeCheckDue(metaRef.current)) throw new PasscodeCheckDueError();
      const secret = await evaluatePrf(wrap.credentialId, fromB64(wrap.prfSalt));
      const { key, entries: list } = await unlockVaultWithPrf(blob, secret);
      keyRef.current = key;
      entriesRef.current = list;
      setEntries(list);
      setStatus("open");
    },

    confirmIdentity: async (passcode) => {
      const blob = blobRef.current;
      if (!blob) throw new Error("No vault yet.");
      await unlockVault(blob, passcode);
      await commit(() => writeMeta({ lastPasscodeAt: new Date().toISOString() }));
    },

    confirmIdentityWithBiometric: async () => {
      const blob = blobRef.current;
      const wrap = blob && prfWrapOf(blob);
      if (!blob || !wrap) throw new Error("Biometric unlock is not set up.");
      await unlockVaultWithPrf(blob, await evaluatePrf(wrap.credentialId, fromB64(wrap.prfSalt)));
    },

    // The passcode is checked FIRST (inside addPrfWrap's unwrap would be too
    // late: the passkey would already exist). A wrong passcode must not leave
    // an orphan passkey behind.
    enableBiometric: (passcode) =>
      commit(async () => {
        const blob = blobRef.current;
        if (!blob) throw new Error("No vault yet.");
        await unlockVault(blob, passcode);
        const old = prfWrapOf(blob);
        const { credentialId, prfSalt, prfOutput } = await enrollBiometric();
        const next = await addPrfWrap(blob, passcode, credentialId, prfSalt, prfOutput);
        await saveVault(next);
        setBlob(next);
        await writeMeta({ lastPasscodeAt: new Date().toISOString() });
        if (old) forgetPasskey(old.credentialId);
      }),

    disableBiometric: () =>
      commit(async () => {
        const blob = blobRef.current;
        const old = blob && prfWrapOf(blob);
        if (!blob || !old) return;
        const next = removePrfWrap(blob);
        await saveVault(next);
        setBlob(next);
        forgetPasskey(old.credentialId);
      }),

    lock,

    add: async (drafts) => {
      const added = drafts.map((d) => newEntry(d));
      await persist([...entriesRef.current, ...added]);
      return added.length;
    },

    update: (id, patch) =>
      persist(
        entriesRef.current.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e))
      ),

    remove: (ids) => persist(entriesRef.current.filter((e) => !ids.includes(e.id))),

    move: (id, delta) => {
      const list = [...entriesRef.current];
      const from = list.findIndex((e) => e.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return Promise.resolve();
      [list[from], list[to]] = [list[to], list[from]];
      return persist(list);
    },

    replaceAll: (list) => persist(list),

    changePasscode: (current, next) =>
      commit(async () => {
        const blob = blobRef.current;
        if (!blob) throw new Error("No vault yet.");
        const rewrapped = await rewrap(blob, current, next);
        await saveVault(rewrapped);
        setBlob(rewrapped);
        await writeMeta({ lastPasscodeAt: new Date().toISOString() });
      }),

    setMeta: (patch) => commit(() => writeMeta(patch)),

    erase: () =>
      commit(async () => {
        const old = blobRef.current && prfWrapOf(blobRef.current);
        await wipe();
        if (old) forgetPasskey(old.credentialId);
        setBlob(null);
        keyRef.current = null;
        entriesRef.current = [];
        metaRef.current = DEFAULT_META;
        setEntries([]);
        setMetaState(DEFAULT_META);
        setStatus("new");
      }),
  };

  // Auto-lock: after time in the background, and after idleness in front.
  // Time hidden is measured on return rather than with a timer, because
  // phones suspend timers in background tabs.
  useEffect(() => {
    if (status !== "open") return;
    const limit = meta.autoLockSeconds;
    if (limit <= 0) return;
    let hiddenAt: number | null = null;
    let lastActive = Date.now();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= limit * 1000) lock();
        hiddenAt = null;
        lastActive = Date.now();
      }
    };
    const onActivity = () => {
      lastActive = Date.now();
    };
    // Idle in the foreground gets five times as long: the screen is in the
    // user's hand and codes ticking over is the app working.
    const idle = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActive > limit * 5000) lock();
    }, 5000);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.clearInterval(idle);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [status, meta.autoLockSeconds, lock]);

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}
