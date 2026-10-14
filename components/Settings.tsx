"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BiometricCancelledError, BiometricUnsupportedError, platformAuthenticatorAvailable } from "@/lib/biometric";
import { BRAND } from "@/lib/brand";
import { clockSkew, describeSkew, SKEW_WARN_SECONDS } from "@/lib/clock";
import { saveOrShare } from "@/lib/files";
import { createBackup, isBackupFile, openBackup, passcodeAdvice, WrongPasscodeError, type BackupFile } from "@/lib/crypto";
import { splitDuplicates, toDraft } from "@/lib/entries";
import type { EntryDraft } from "@/lib/types";
import { useVault } from "@/lib/vault";
import { dangerButton, Field, Icon, inputClass, primaryButton, Screen, secondaryButton, useToast } from "./ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

export function Settings({ back }: { back: () => void }) {
  const vault = useVault();
  return (
    <Screen title="Settings" onBack={back}>
      <div className="space-y-4">
        <BackupSection />
        <RestoreSection />
        <Section title="Move to another app">
          <p className="mb-3 text-sm text-muted">
            Copy your accounts into Google Authenticator, Aegis, 2FAS or any other app — so you&apos;re never stuck in {BRAND.name}.
          </p>
          <button
            onClick={() => (window.location.hash = "export")}
            disabled={!vault.entries.length}
            className={`${secondaryButton} w-full`}
          >
            <Icon name="upload" size={18} /> Export accounts
          </button>
        </Section>
        <Section title="Auto-lock">
          <Field label="Lock after the app has been in the background for" hint="Idle on screen gets five times as long.">
            <select
              className={`${inputClass} appearance-none`}
              value={vault.meta.autoLockSeconds}
              onChange={(e) => vault.setMeta({ autoLockSeconds: Number(e.target.value) })}
            >
              <option value={0}>Immediately</option>
              <option value={30}>30 seconds</option>
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
            </select>
          </Field>
        </Section>
        <BiometricSection />
        <PasscodeSection />
        <Section title="Privacy">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
              checked={vault.meta.clearClipboard}
              onChange={(e) => vault.setMeta({ clearClipboard: e.target.checked })}
            />
            <span>
              <span className="block font-medium">Clear copied codes after 30 seconds</span>
              <span className="text-muted">Works while {BRAND.name} is open; browsers don&apos;t allow it from the background.</span>
            </span>
          </label>
        </Section>
        <Section title="This device">
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Icon name={vault.persisted ? "check" : "alert"} size={18} className={`mt-0.5 shrink-0 ${vault.persisted ? "text-ok" : "text-warn"}`} />
              <span>
                {vault.persisted
                  ? "Storage is marked as permanent: the browser won't clear it to free space."
                  : "The browser may clear this app's storage if space runs low or it goes unused. Install the app to your home screen, and keep a backup."}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-ok" />
              <span>Accounts and their names are encrypted (AES-256). Nothing leaves this phone. The app makes no network requests with your data.</span>
            </li>
            <ClockRow />
          </ul>
        </Section>
        <EraseSection />
        <p className="pt-2 text-center text-xs text-muted">
          {BRAND.name} · {vault.entries.length} account{vault.entries.length === 1 ? "" : "s"}
        </p>
      </div>
    </Screen>
  );
}

function ClockRow() {
  const [skew, setSkew] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    clockSkew().then((s) => live && setSkew(s));
    return () => {
      live = false;
    };
  }, []);
  const off = typeof skew === "number" && Math.abs(skew) >= SKEW_WARN_SECONDS;
  return (
    <li className="flex items-start gap-2">
      <Icon name={off ? "alert" : skew === undefined || skew === null ? "refresh" : "check"} size={18} className={`mt-0.5 shrink-0 ${off ? "text-warn" : skew === null || skew === undefined ? "text-muted" : "text-ok"}`} />
      <span>
        {skew === undefined
          ? "Checking this phone's clock…"
          : skew === null
            ? "Couldn't check the clock (offline). Codes are made from the time, so keep date and time set to automatic."
            : off
              ? `${describeSkew(skew)}. Set the date and time to automatic, or sites may reject your codes.`
              : `Clock checked: correct to within ${Math.max(1, Math.abs(skew))} second${Math.abs(skew) > 1 ? "s" : ""}.`}
      </span>
    </li>
  );
}

// -- backup -----------------------------------------------------------------

function BackupSection() {
  const vault = useVault();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advice = passcodeAdvice(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!advice.ok) return setError(advice.note);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const file = await createBackup(vault.entries, password);
      const name = `${BRAND.name.toLowerCase()}-backup-${file.created.slice(0, 10)}.json`;
      if (!(await saveOrShare(JSON.stringify(file, null, 2), name, "application/json"))) return; // cancelled: not backed up
      await vault.setMeta({ lastBackupAt: new Date().toISOString() });
      toast("Backup saved");
      setOpen(false);
      setPassword("");
      setConfirm("");
    } catch {
      setError("Couldn't make the backup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Backup">
      <p className="mb-3 text-sm text-muted">
        Last backup: <span className="text-ink">{when(vault.meta.lastBackupAt)}</span>. The file is encrypted with its own password. Keep it
        somewhere other than this phone.
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} disabled={!vault.entries.length} className={`${primaryButton} w-full`}>
          <Icon name="download" size={18} /> Back up {vault.entries.length} account{vault.entries.length === 1 ? "" : "s"}
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="Backup password" hint={password ? advice.note : "Can be the same as your passcode. Without it the file is useless."}>
            <input type="password" autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <Field label="Type it again">
            <input type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-warn" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className={`${secondaryButton} flex-1`}>
              Cancel
            </button>
            <button className={`${primaryButton} flex-1`} disabled={busy}>
              {busy ? "Encrypting…" : "Save backup"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

// -- restore ----------------------------------------------------------------

function RestoreSection() {
  const vault = useVault();
  const toast = useToast();
  const [file, setFile] = useState<BackupFile | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ fresh: EntryDraft[]; duplicates: EntryDraft[]; invalid: number } | null>(null);

  async function pick(f: File | undefined) {
    setError(null);
    setFound(null);
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (!isBackupFile(parsed)) throw new Error();
      setFile(parsed);
    } catch {
      setError(`That isn't a ${BRAND.name} backup file.`);
    }
  }

  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await openBackup(file, password);
      // Decrypting proves the password, not that the contents are sane.
      const drafts = (Array.isArray(raw) ? raw : []).map(toDraft).filter((d): d is EntryDraft => d !== null);
      setFound({ ...splitDuplicates(vault.entries, drafts), invalid: (Array.isArray(raw) ? raw.length : 0) - drafts.length });
    } catch (err) {
      setError(err instanceof WrongPasscodeError ? "That password doesn't open this backup." : "The backup file is damaged.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!found) return;
    setBusy(true);
    try {
      // Added as new entries with fresh ids, so a restored copy never collides with what's here.
      const n = await vault.add(found.fresh);
      toast(`Restored ${n} account${n === 1 ? "" : "s"}`);
      reset();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setPassword("");
    setFound(null);
    setError(null);
  }

  return (
    <Section title="Restore from backup">
      {!file ? (
        <>
          <p className="mb-3 text-sm text-muted">Adds the accounts from a backup file. Accounts already here are kept and not doubled up.</p>
          <label className={`${secondaryButton} w-full cursor-pointer`}>
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            <Icon name="upload" size={18} /> Choose backup file
          </label>
        </>
      ) : !found ? (
        <form onSubmit={unlock} className="space-y-3">
          <p className="text-sm text-muted">
            Backup from {when(file.created)} · {file.count} account{file.count === 1 ? "" : "s"}
          </p>
          <Field label="Backup password">
            <input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <div className="flex gap-2">
            <button type="button" onClick={reset} className={`${secondaryButton} flex-1`}>
              Cancel
            </button>
            <button className={`${primaryButton} flex-1`} disabled={busy || !password}>
              {busy ? "Opening…" : "Open"}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{found.fresh.length}</strong> new account{found.fresh.length === 1 ? "" : "s"} to add
            {found.duplicates.length > 0 && <span className="text-muted"> · {found.duplicates.length} already here, skipped</span>}
            {found.invalid > 0 && <span className="text-warn"> · {found.invalid} unreadable, skipped</span>}.
          </p>
          <div className="flex gap-2">
            <button onClick={reset} className={`${secondaryButton} flex-1`}>
              Cancel
            </button>
            <button onClick={restore} className={`${primaryButton} flex-1`} disabled={busy || !found.fresh.length}>
              Add {found.fresh.length}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-warn" role="alert">{error}</p>}
    </Section>
  );
}

// -- biometric ----------------------------------------------------------------

function BiometricSection() {
  const vault = useVault();
  const toast = useToast();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    platformAuthenticatorAvailable().then((ok) => live && setAvailable(ok));
    return () => {
      live = false;
    };
  }, []);

  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await vault.enableBiometric(passcode);
      toast("Fingerprint unlock is on");
      setOpen(false);
      setPasscode("");
    } catch (err) {
      if (err instanceof BiometricCancelledError) setError(null);
      else if (err instanceof WrongPasscodeError) setError("That passcode isn't right.");
      else if (err instanceof BiometricUnsupportedError) setError(err.message);
      else setError("Couldn't set it up on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    await vault.disableBiometric();
    toast("Fingerprint unlock is off");
  }

  return (
    <Section title="Fingerprint or face unlock">
      {vault.biometricSince ? (
        <>
          <p className="mb-3 flex items-start gap-2 text-sm">
            <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ok" />
            <span>
              On since {when(vault.biometricSince)}. Your passcode still works, and is still the only way in if this phone&apos;s
              fingerprints or face are reset.
            </span>
          </p>
          <button onClick={disable} className={`${secondaryButton} w-full`}>
            Turn off
          </button>
        </>
      ) : available === false ? (
        <p className="text-sm text-muted">
          This browser or device has no fingerprint, face or screen-lock unlock available. On a phone, set up a screen lock and open
          the app in Chrome (Android) or Safari (iPhone).
        </p>
      ) : !open ? (
        <>
          <p className="mb-3 text-sm text-muted">
            Unlock with your phone&apos;s fingerprint, face or screen lock instead of typing the passcode. The vault key is protected
            by this phone&apos;s secure hardware, not just hidden behind a prompt.
          </p>
          <button onClick={() => setOpen(true)} disabled={available === null} className={`${primaryButton} w-full`}>
            <Icon name="fingerprint" size={20} /> Turn on
          </button>
        </>
      ) : (
        <form onSubmit={enable} className="space-y-3">
          <Field label="Your passcode" hint="Needed once, so someone holding your unlocked phone can't add their own fingerprint.">
            <input type="password" autoComplete="current-password" className={inputClass} value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
          </Field>
          {error && <p className="text-sm text-warn" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => (setOpen(false), setError(null))} className={`${secondaryButton} flex-1`}>
              Cancel
            </button>
            <button className={`${primaryButton} flex-1`} disabled={busy || !passcode}>
              {busy ? "Waiting for phone…" : "Continue"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

// -- passcode ---------------------------------------------------------------

function PasscodeSection() {
  const vault = useVault();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advice = passcodeAdvice(next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!advice.ok) return setError(advice.note);
    if (next !== confirm) return setError("The new passcodes don't match.");
    setBusy(true);
    setError(null);
    try {
      await vault.changePasscode(current, next);
      toast("Passcode changed");
      setOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof WrongPasscodeError ? "Your current passcode isn't right." : "Couldn't change the passcode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Passcode">
      {!open ? (
        <button onClick={() => setOpen(true)} className={`${secondaryButton} w-full`}>
          Change passcode
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="Current passcode">
            <input type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </Field>
          <Field label="New passcode" hint={next ? advice.note : undefined}>
            <input type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="New passcode again">
            <input type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-warn" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className={`${secondaryButton} flex-1`}>
              Cancel
            </button>
            <button className={`${primaryButton} flex-1`} disabled={busy || !current}>
              {busy ? "Changing…" : "Change"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

// -- erase ------------------------------------------------------------------

function EraseSection() {
  const vault = useVault();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  return (
    <Section title="Erase this vault">
      {!open ? (
        <button onClick={() => setOpen(true)} className={`${secondaryButton} w-full text-warn`}>
          Erase everything on this device
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Every account is deleted from this phone, permanently. Only a backup file can bring them back. Type <strong>ERASE</strong> to
            confirm.
          </p>
          <input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" aria-label="Type ERASE to confirm" />
          <div className="flex gap-2">
            <button onClick={() => (setOpen(false), setTyped(""))} className={`${secondaryButton} flex-1`}>
              Cancel
            </button>
            <button onClick={() => vault.erase()} disabled={typed.trim() !== "ERASE"} className={`${dangerButton} flex-1`}>
              Erase
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

