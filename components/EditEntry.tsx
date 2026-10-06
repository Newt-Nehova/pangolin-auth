"use client";

import { useState } from "react";
import { displayName } from "@/lib/entries";
import { useVault } from "@/lib/vault";
import { Field, Icon, inputClass, primaryButton, Screen, secondaryButton, useToast } from "./ui";

export function EditEntry({ id, back }: { id: string; back: () => void }) {
  const vault = useVault();
  const toast = useToast();
  const index = vault.entries.findIndex((e) => e.id === id);
  const entry = vault.entries[index];
  const [issuer, setIssuer] = useState(entry?.issuer ?? "");
  const [account, setAccount] = useState(entry?.account ?? "");

  if (!entry) {
    return (
      <Screen title="Account" onBack={back}>
        <p className="text-muted">That account isn&apos;t in the vault any more.</p>
      </Screen>
    );
  }

  async function save() {
    await vault.update(id, { issuer: issuer.trim(), account: account.trim() });
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
        <button onClick={save} className={`${primaryButton} w-full`} disabled={!issuer.trim() && !account.trim()}>
          Save
        </button>

        <div className="pt-2">
          <p className="mb-2 text-sm font-medium">Position in list</p>
          <div className="flex gap-2">
            <button onClick={() => vault.move(id, -1)} disabled={index === 0} className={`${secondaryButton} flex-1`}>
              <Icon name="up" size={18} /> Move up
            </button>
            <button onClick={() => vault.move(id, 1)} disabled={index === vault.entries.length - 1} className={`${secondaryButton} flex-1`}>
              <Icon name="down" size={18} /> Move down
            </button>
          </div>
        </div>

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
        <p className="text-sm text-muted">To remove an account, use Select on the main screen.</p>
      </div>
    </Screen>
  );
}
