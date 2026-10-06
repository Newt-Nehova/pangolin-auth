"use client";

/** First run (create a passcode) and the lock screen. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BRAND } from "@/lib/brand";
import { passcodeAdvice, WrongPasscodeError } from "@/lib/crypto";
import { useVault } from "@/lib/vault";
import { Mark } from "./Mark";
import { Field, inputClass, primaryButton } from "./ui";

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
            I understand there is <strong>no reset</strong>. Nobody — not even the app&apos;s maker — can open the vault without this passcode.
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

  return (
    <Shell>
      <Brand />
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
          autoFocus
          disabled={busy}
        />
        {error && <p className="text-center text-sm text-warn" role="alert">{error}</p>}
        <button className={`${primaryButton} h-14 w-full text-lg`} disabled={busy || !passcode || waitLeft > 0}>
          {busy ? "Unlocking…" : waitLeft ? `Try again in ${waitLeft}s` : "Unlock"}
        </button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">Locked. Your codes are encrypted on this device.</p>
    </Shell>
  );
}
