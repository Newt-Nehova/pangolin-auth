"use client";

/**
 * Moving accounts out of Pangolin, so nobody is ever stuck in it.
 *
 * - Google Authenticator: its own "transfer" QR codes, shown here and scanned
 *   by the other phone. Nothing is written to a file.
 * - Everything else (Aegis, 2FAS, Ente Auth, Bitwarden...): a text file of
 *   otpauth:// links, the format they all import. This file is NOT encrypted,
 *   and the screen says so before making it.
 *
 * Secrets come off the screen on their own: after three minutes, or as soon as
 * the app goes to the background.
 */
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { saveOrShare } from "@/lib/files";
import { migrationBatches, otpauthList } from "@/lib/otpauth";
import { useVault } from "@/lib/vault";
import { IdentityCheck } from "./IdentityCheck";
import { QrImage } from "./QrImage";
import { Icon, primaryButton, Screen, secondaryButton, useToast } from "./ui";

type Step = "check" | "choose" | "google" | "file";
const REVEAL_MS = 3 * 60_000;

export function Export({ back }: { back: () => void }) {
  const vault = useVault();
  const [step, setStep] = useState<Step>("check");
  const [batches, setBatches] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  // Hide secrets after a while, and the moment the app leaves the screen.
  useEffect(() => {
    if (step === "check") return;
    const timer = window.setTimeout(() => setStep("check"), REVEAL_MS);
    const onHide = () => document.visibilityState === "hidden" && setStep("check");
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [step]);

  const count = vault.entries.length;

  if (count === 0) {
    return (
      <Screen title="Move to another app" onBack={back}>
        <p className="text-muted">There are no accounts to move yet.</p>
      </Screen>
    );
  }

  if (step === "check") {
    return (
      <Screen title="Move to another app" onBack={back}>
        <IdentityCheck
          why={
            <>
              <strong className="block text-ink">Confirm it&apos;s you</strong>
              <span className="text-muted">Exporting shows the secret behind every account, so it needs your passcode or fingerprint.</span>
            </>
          }
          onConfirmed={() => setStep("choose")}
          onCancel={back}
        />
      </Screen>
    );
  }

  if (step === "google") {
    return (
      <Screen title="To Google Authenticator" onBack={() => setStep("choose")}>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>On the other phone, open Google Authenticator.</li>
          <li>
            Tap <span className="text-ink">+</span> → <span className="text-ink">Scan a QR code</span>, and scan the code below.
          </li>
          {batches.length > 1 && <li>Then tap Next here and scan each remaining code.</li>}
        </ol>
        <QrImage value={batches[page]} label={`Transfer code ${page + 1} of ${batches.length}`} />
        <p className="mt-3 text-center text-sm font-medium">
          Code {page + 1} of {batches.length}
        </p>
        {batches.length > 1 && (
          <div className="mt-3 flex gap-2">
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className={`${secondaryButton} flex-1`}>
              Previous
            </button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page === batches.length - 1} className={`${primaryButton} flex-1`}>
              Next
            </button>
          </div>
        )}
        <p className="mt-6 text-center text-sm text-muted">These codes hide themselves after 3 minutes or when you leave the app.</p>
      </Screen>
    );
  }

  if (step === "file") return <FileExport back={() => setStep("choose")} done={back} />;

  return (
    <Screen title="Move to another app" onBack={back}>
      <p className="mb-4 text-sm text-muted">
        This copies your {count} account{count === 1 ? "" : "s"} into another authenticator. Nothing is removed from {BRAND.name}.
      </p>
      <ul className="space-y-3">
        <li>
          <button
            onClick={() => {
              setBatches(migrationBatches(vault.entries));
              setPage(0);
              setStep("google");
            }}
            className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm active:scale-[.99]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon name="camera" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">Google Authenticator</span>
              <span className="block text-sm text-muted">Show transfer QR codes for the other phone to scan. No file.</span>
            </span>
          </button>
        </li>
        <li>
          <button
            onClick={() => setStep("file")}
            className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm active:scale-[.99]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon name="download" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">Aegis, 2FAS, Ente Auth, Bitwarden…</span>
              <span className="block text-sm text-muted">A list of setup links they can all import.</span>
            </span>
          </button>
        </li>
      </ul>
      <p className="mt-6 text-sm text-muted">
        To move a single account, open it from the main screen and choose <span className="text-ink">Show QR code</span>.
      </p>
    </Screen>
  );
}

function FileExport({ back, done }: { back: () => void; done: () => void }) {
  const vault = useVault();
  const toast = useToast();
  const [understood, setUnderstood] = useState(false);

  async function save() {
    const name = `${BRAND.name.toLowerCase()}-export-${new Date().toISOString().slice(0, 10)}.txt`;
    if (await saveOrShare(otpauthList(vault.entries), name, "text/plain")) {
      toast("Export saved");
      done();
    }
  }

  return (
    <Screen title="Export as setup links" onBack={back}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <Icon name="alert" className="mt-0.5 shrink-0 text-warn" />
          <div>
            <strong className="block text-ink">This file is not encrypted</strong>
            <span className="text-muted">
              Anyone who opens it can make your codes. Import it into the other app straight away, then delete the file — and
              don&apos;t email it or leave it in Downloads. For a safe copy to keep, use Settings → Backup instead.
            </span>
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Save the file below.</li>
          <li>
            In the other app, look for <span className="text-ink">Import</span> → <span className="text-ink">plain text</span> or{" "}
            <span className="text-ink">otpauth URIs</span>.
          </li>
          <li>Check a code matches in both apps, then delete the file.</li>
        </ol>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-accent-soft p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>I&apos;ll import it straight away and delete the file afterwards.</span>
        </label>
        <button onClick={save} disabled={!understood} className={`${primaryButton} w-full`}>
          <Icon name="download" size={18} /> Save {vault.entries.length} setup link{vault.entries.length === 1 ? "" : "s"}
        </button>
      </div>
    </Screen>
  );
}
