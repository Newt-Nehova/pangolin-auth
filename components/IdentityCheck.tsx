"use client";

/**
 * "Is this really you?" before anything that reveals secrets (export, showing
 * an account's QR). The vault being unlocked isn't enough: a phone handed over
 * unlocked for a moment shouldn't give away every account in one tap.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { BiometricCancelledError } from "@/lib/biometric";
import { WrongPasscodeError } from "@/lib/crypto";
import { useVault } from "@/lib/vault";
import { Field, Icon, inputClass, primaryButton, secondaryButton } from "./ui";

export function IdentityCheck({ why, onConfirmed, onCancel }: { why: ReactNode; onConfirmed: () => void; onCancel: () => void }) {
  const vault = useVault();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withPasscode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await vault.confirmIdentity(passcode);
      onConfirmed();
    } catch (err) {
      setError(err instanceof WrongPasscodeError ? "That passcode isn't right." : "Couldn't check that.");
      setBusy(false);
    }
  }

  async function withFingerprint() {
    setBusy(true);
    setError(null);
    try {
      await vault.confirmIdentityWithBiometric();
      onConfirmed();
    } catch (err) {
      if (!(err instanceof BiometricCancelledError)) setError("Fingerprint didn't work. Use your passcode.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm shadow-sm">
        <Icon name="shield" className="mt-0.5 shrink-0 text-accent" />
        <div>{why}</div>
      </div>
      {vault.biometricSince && (
        <button type="button" onClick={withFingerprint} disabled={busy} className={`${primaryButton} w-full`}>
          <Icon name="fingerprint" size={20} /> Confirm with fingerprint or face
        </button>
      )}
      <form onSubmit={withPasscode} className="space-y-3">
        <Field label={vault.biometricSince ? "Or type your passcode" : "Your passcode"}>
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus={!vault.biometricSince}
          />
        </Field>
        {error && <p className="text-sm text-warn" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={`${secondaryButton} flex-1`}>
            Cancel
          </button>
          <button className={`${vault.biometricSince ? secondaryButton : primaryButton} flex-1`} disabled={busy || !passcode}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
