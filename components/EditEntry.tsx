"use client";

import { useEffect, useState } from "react";
import { displayName, groupsOf } from "@/lib/entries";
import { buildOtpauth } from "@/lib/otpauth";
import { useVault } from "@/lib/vault";
import { IdentityCheck } from "./IdentityCheck";
import { QrImage } from "./QrImage";
import { Field, Icon, inputClass, primaryButton, Screen, secondaryButton, useToast } from "./ui";

export function EditEntry({ id, back }: { id: string; back: () => void }) {
  const vault = useVault();
  const toast = useToast();
  const index = vault.entries.findIndex((e) => e.id === id);
  const entry = vault.entries[index];
  const [issuer, setIssuer] = useState(entry?.issuer ?? "");
  const [account, setAccount] = useState(entry?.account ?? "");
  const [group, setGroup] = useState(entry?.group ?? "");

  if (!entry) {
    return (
      <Screen title="Account" onBack={back}>
        <p className="text-muted">That account isn&apos;t in the vault any more.</p>
      </Screen>
    );
  }

  async function save() {
    // Reuse an existing group's spelling, so "work" joins "Work" instead of starting a twin.
    const typed = group.trim().slice(0, 40);
    const existing = groupsOf(vault.entries).find((g) => g.toLowerCase() === typed.toLowerCase());
    await vault.update(id, { issuer: issuer.trim(), account: account.trim(), group: existing ?? typed });
    toast("Saved");
    back();
  }

  return (
    <Screen title={displayName(entry)} onBack={back}>
      <div className="space-y-4">
        <Field label="Service">
          <input className={inputClass} value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        </Field>
        <Field label="Account">
          <input className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)} autoCapitalize="off" />
        </Field>
        <Field label="Group" hint="Optional, e.g. Work or Banking. Groups appear as filters on the main screen.">
          <input className={inputClass} value={group} onChange={(e) => setGroup(e.target.value)} list="pangolin-groups" maxLength={40} />
          <datalist id="pangolin-groups">
            {groupsOf(vault.entries).map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <button onClick={save} className={`${primaryButton} w-full`} disabled={!issuer.trim() && !account.trim()}>
          Save
        </button>

        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface px-4 shadow-sm">
          <Icon name="star" size={20} className={entry.pinned ? "fill-accent text-accent" : "text-muted"} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Pin to top</span>
            <span className="block text-sm text-muted">Keep this account above the rest.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            checked={!!entry.pinned}
            onChange={(e) => {
              vault.update(id, { pinned: e.target.checked });
              toast(e.target.checked ? "Pinned to top" : "Unpinned");
            }}
          />
        </label>
        <p className="text-sm text-muted">To change the order, use Reorder under the list on the main screen.</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface p-4 text-sm">
          <dt className="text-muted">Type</dt>
          <dd>{entry.type === "hotp" ? `Counter-based (next: ${entry.counter})` : `Time-based, every ${entry.period}s`}</dd>
          <dt className="text-muted">Code length</dt>
          <dd>{entry.digits} digits</dd>
          <dt className="text-muted">Algorithm</dt>
          <dd>{entry.algorithm}</dd>
          <dt className="text-muted">Added</dt>
          <dd>{new Date(entry.createdAt).toLocaleDateString()}</dd>
        </dl>
        <ShowQr entryId={id} />
        <p className="text-sm text-muted">To remove an account, use Select on the main screen.</p>
      </div>
    </Screen>
  );
}

/**
 * This one account as a standard setup QR, for scanning into any other
 * authenticator. Behind an identity check, and off the screen again after a
 * minute or when the app is left.
 */
function ShowQr({ entryId }: { entryId: string }) {
  const vault = useVault();
  const [step, setStep] = useState<"closed" | "check" | "shown">("closed");
  const entry = vault.entries.find((e) => e.id === entryId);

  useEffect(() => {
    if (step !== "shown") return;
    const timer = window.setTimeout(() => setStep("closed"), 60_000);
    const onHide = () => document.visibilityState === "hidden" && setStep("closed");
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [step]);

  if (!entry) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 className="mb-2 font-semibold">Move this account</h2>
      {step === "closed" && (
        <>
          <p className="mb-3 text-sm text-muted">Show its setup QR code to scan into another authenticator app or phone.</p>
          <button onClick={() => setStep("check")} className={`${secondaryButton} w-full`}>
            <Icon name="camera" size={18} /> Show QR code
          </button>
        </>
      )}
      {step === "check" && (
        <IdentityCheck
          why={<span className="text-muted">This QR code is the account&apos;s secret. Anyone who scans it can make its codes.</span>}
          onConfirmed={() => setStep("shown")}
          onCancel={() => setStep("closed")}
        />
      )}
      {step === "shown" && (
        <div className="space-y-3">
          <QrImage value={buildOtpauth(entry)} label={`Setup QR code for ${displayName(entry)}`} size={240} />
          <p className="text-center text-sm text-muted">Scan with the other app. This hides itself after a minute.</p>
          <button onClick={() => setStep("closed")} className={`${primaryButton} w-full`}>
            Done
          </button>
        </div>
      )}
    </section>
  );
}
