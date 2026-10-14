"use client";

/** First run (create a passcode) and the lock screen. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BRAND } from "@/lib/brand";
import { BiometricCancelledError, BiometricUnsupportedError } from "@/lib/biometric";
import { BiometricMismatchError, passcodeAdvice, WrongPasscodeError } from "@/lib/crypto";
import { passcodeCheckDue, PasscodeCheckDueError, PASSCODE_CHECK_DAYS, useVault } from "@/lib/vault";
import { Mark } from "./Mark";
import { dangerButton, Field, Icon, inputClass, primaryButton, secondaryButton } from "./ui";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="scales scales-fade absolute inset-x-0 top-0 h-80" aria-hidden />
      <div className="relative mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">{children}</div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-8 text-center">
      <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface text-accent shadow-sm ring-1 ring-line">
        <Mark size={48} />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{BRAND.name}</h1>
    </div>
  );
}

export function Setup() {
  const vault = useVault();
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advice = passcodeAdvice(passcode);
  const tone = advice.level === "strong" ? "text-ok" : advice.level === "fair" ? "text-accent" : "text-warn";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!advice.ok) return setError(advice.note);
    if (passcode !== confirm) return setError("The two passcodes don't match.");
    if (!understood) return setError("Tick the box to confirm you understand there is no reset.");
    setBusy(true);
    setError(null);
    try {
      await vault.create(passcode);
    } catch {
      setError("Could not create the vault on this device.");
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Brand />
      <p className="mb-6 text-center text-muted">{BRAND.tagline}</p>
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Choose a passcode</h2>
        <Field
          label="Passcode"
          hint={passcode ? <span className={tone}>{advice.note}</span> : "A few words you'll remember beats a short number."}
        >
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Type it again">
          <input type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-accent-soft p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>
            I understand there is <strong>no reset</strong>. Nobody — not even the app&apos;s maker — can open the vault without this
            passcode, so I&apos;ve saved it somewhere safe (a password manager, or written down).
          </span>
        </label>
        {error && <p className="text-sm text-warn" role="alert">{error}</p>}
        <button className={`${primaryButton} w-full`} disabled={busy}>
          {busy ? "Sealing the vault…" : "Create vault"}
        </button>
      </form>
    </Shell>
  );
}

export function Lock() {
  const vault = useVault();
  const [forgot, setForgot] = useState(false);
  // Read once when the lock screen appears; a stale answer for a minute is harmless.
  const [checkDue] = useState(() => passcodeCheckDue(vault.meta));
  const fingerprint = !!vault.biometricSince && !checkDue;
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [waitLeft, setWaitLeft] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Each wrong passcode already costs ~half a second of key stretching; past
  // five in a row, add a growing pause on top so guessing at the screen is slow.
  useEffect(() => {
    if (!waitLeft) return;
    const t = window.setTimeout(() => setWaitLeft((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [waitLeft]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passcode || busy || waitLeft) return;
    setBusy(true);
    setError(null);
    try {
      await vault.unlock(passcode);
    } catch (err) {
      const count = failures + 1;
      setFailures(count);
      if (count >= 5) setWaitLeft(Math.min(300, 2 ** (count - 4) * 5));
      setError(err instanceof WrongPasscodeError ? "That passcode is not right." : "Could not open the vault.");
      setPasscode("");
      setBusy(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  async function biometric() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await vault.unlockWithBiometric();
    } catch (err) {
      // Backing out of the system prompt is a choice, not an error.
      if (err instanceof PasscodeCheckDueError) setError(err.message);
      else if (!(err instanceof BiometricCancelledError)) {
        setError(
          err instanceof BiometricMismatchError
            ? `${err.message} Use your passcode.`
            : err instanceof BiometricUnsupportedError
            ? "Fingerprint unlock isn't available here. Use your passcode."
            : "Fingerprint unlock didn't work. Use your passcode."
        );
      }
      setBusy(false);
    }
  }

  if (forgot) return <StartOver onCancel={() => setForgot(false)} />;

  return (
    <Shell>
      <Brand />
      {vault.biometricSince && checkDue && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-accent-soft p-3 text-sm">
          <Icon name="fingerprint" size={18} className="mt-0.5 shrink-0 text-accent" />
          <span>
            <strong>Monthly passcode check.</strong> Type your passcode this time so you don&apos;t forget it. Fingerprint unlock
            comes straight back afterwards, for another {PASSCODE_CHECK_DAYS} days.
          </span>
        </p>
      )}
      {fingerprint && (
        <>
          <button type="button" onClick={biometric} disabled={busy} className={`${primaryButton} h-14 w-full text-lg`}>
            <Icon name="fingerprint" /> Unlock with fingerprint or face
          </button>
          <p className="my-4 text-center text-sm text-muted">or use your passcode</p>
        </>
      )}
      <form onSubmit={submit} className="space-y-4">
        <label className="sr-only" htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          ref={input}
          type="password"
          autoComplete="current-password"
          placeholder="Passcode"
          className={`${inputClass} h-14 text-center text-lg`}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus={!fingerprint}
          disabled={busy}
        />
        {error && <p className="text-center text-sm text-warn" role="alert">{error}</p>}
        <button
          className={`${fingerprint ? secondaryButton : primaryButton} h-14 w-full text-lg`}
          disabled={busy || !passcode || waitLeft > 0}
        >
          {busy ? "Unlocking…" : waitLeft ? `Try again in ${waitLeft}s` : "Unlock"}
        </button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">Locked. Your codes are encrypted on this device.</p>
      <button
        type="button"
        onClick={() => setForgot(true)}
        className="mx-auto mt-2 min-h-11 px-3 text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        Forgot passcode?
      </button>
    </Shell>
  );
}

/**
 * The only way past a forgotten passcode: erase the vault and begin again.
 * Nothing is recovered -- the passcode is the key, so there is nothing to
 * recover with. Letting anyone holding the phone do this gives away no
 * secrets (clearing the browser's site data would do the same), so the
 * guard is a typed confirmation against accidents, not a security check.
 */
function StartOver({ onCancel }: { onCancel: () => void }) {
  const vault = useVault();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function erase() {
    setBusy(true);
    try {
      await vault.erase();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Brand />
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Forgot your passcode?</h2>
        <p className="text-sm">
          It can&apos;t be reset or recovered. The passcode is the only key to this vault, so the only way forward is to{" "}
          <strong>erase it and start a new one</strong>.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Every account in this vault is deleted from this device, permanently.</li>
          <li>
            Have a backup file? After starting over, use <span className="text-ink">Settings → Restore</span> with the backup&apos;s own
            password.
          </li>
          <li>No backup? Sign in to each site with the recovery codes it gave you, then set up two-factor again.</li>
        </ul>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Type <strong>ERASE</strong> to confirm
          </span>
          <input
            className={inputClass}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            autoFocus
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={`${secondaryButton} flex-1`} disabled={busy}>
            Back
          </button>
          <button type="button" onClick={erase} className={`${dangerButton} flex-1`} disabled={busy || typed.trim() !== "ERASE"}>
            {busy ? "Erasing…" : "Erase and start over"}
          </button>
        </div>
      </div>
    </Shell>
  );
}
