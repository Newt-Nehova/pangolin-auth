"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { isValidBase32, normalizeBase32 } from "@/lib/base32";
import { splitDuplicates } from "@/lib/entries";
import { parseImportFile } from "@/lib/importers";
import { takePendingImport } from "@/lib/pendingImport";
import { isMigrationUri, parseMigration, parseOtpauth, ParseError } from "@/lib/otpauth";
import { decodeFile, decodeImageData, toImageData } from "@/lib/qr";
import type { Algorithm, EntryDraft } from "@/lib/types";
import { useVault } from "@/lib/vault";
import { Field, Icon, inputClass, primaryButton, Screen, secondaryButton, useToast } from "./ui";

type Mode = "choose" | "scan" | "paste" | "manual" | "review";

interface Review {
  drafts: EntryDraft[];
  skipped: string[];
  /** Where a file import came from, e.g. "Aegis". */
  source?: string;
  batch?: { index: number; size: number };
}

/** Turns scanned or pasted text into drafts, or a readable reason it can't. */
function interpret(text: string): Review {
  if (isMigrationUri(text)) {
    const r = parseMigration(text);
    return { drafts: r.drafts, skipped: r.skipped, batch: r.batchSize > 1 ? { index: r.batchIndex, size: r.batchSize } : undefined };
  }
  if (/^otpauth:\/\//i.test(text.trim())) return { drafts: [parseOtpauth(text)], skipped: [] };
  throw new ParseError(
    /^https?:\/\//i.test(text.trim())
      ? "That QR code is a web link, not an authenticator code."
      : "That QR code isn't an authenticator code."
  );
}

const reason = (err: unknown) => (err instanceof ParseError ? err.message : "Couldn't read that.");

export function AddFlow({ back, done }: { back: () => void; done: () => void }) {
  // Arriving from Settings → Import with a file already read: go straight to review.
  const [initial] = useState(() => {
    const r = takePendingImport();
    return r ? { drafts: r.drafts, skipped: r.skipped, source: r.format } : null;
  });
  const [mode, setMode] = useState<Mode>(initial ? "review" : "choose");
  const [review, setReview] = useState<Review | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  function accept(text: string): boolean {
    try {
      setReview(interpret(text));
      setError(null);
      setMode("review");
      return true;
    } catch (err) {
      setError(reason(err));
      return false;
    }
  }

  async function onImage(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const text = await decodeFile(file);
      if (text) accept(text);
      else setError("No QR code found in that picture. Crop closer to the code and try again.");
    } catch {
      setError("Couldn't open that picture.");
    } finally {
      setReading(false);
    }
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 5_000_000) return setError("That file is too big to be an authenticator export.");
    try {
      const result = parseImportFile(await file.text());
      if (!result.drafts.length && !result.skipped.length) return setError("No accounts found in that file.");
      setReview({ drafts: result.drafts, skipped: result.skipped, source: result.format });
      setMode("review");
    } catch (err) {
      setError(reason(err));
    }
  }

  const goBack = () => {
    setError(null);
    if (mode === "choose") back();
    else setMode("choose");
  };

  if (mode === "scan") return <Scanner onBack={goBack} onText={accept} error={error} />;
  if (mode === "paste") return <Paste onBack={goBack} onText={accept} error={error} />;
  if (mode === "manual") return <Manual onBack={goBack} onDraft={(d) => (setReview({ drafts: [d], skipped: [] }), setMode("review"))} />;
  if (mode === "review" && review) return <ReviewScreen review={review} onBack={goBack} done={done} />;

  const options: { icon: string; title: string; text: string; onClick?: () => void; file?: "image" | "export" }[] = [
    { icon: "camera", title: "Scan a QR code", text: "Point the camera at the code on screen", onClick: () => setMode("scan") },
    { icon: "image", title: "From a screenshot", text: "Pick a picture that has the QR code in it", file: "image" },
    { icon: "link", title: "Paste a setup link", text: "otpauth://… or a Google Authenticator transfer", onClick: () => setMode("paste") },
    { icon: "keyboard", title: "Type the key in", text: "When the site shows a text key instead", onClick: () => setMode("manual") },
    { icon: "upload", title: "Import from another app", text: "An export file from Aegis, 2FAS, Bitwarden or Ente Auth", file: "export" },
  ];

  return (
    <Screen title="Add account" onBack={goBack}>
      <ul className="space-y-3">
        {options.map((o) => {
          const body = (
            <>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon name={o.icon} />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-sm text-muted">{o.text}</span>
              </span>
            </>
          );
          const cls = "flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm active:scale-[.99] cursor-pointer";
          return (
            <li key={o.title}>
              {o.file ? (
                // A real label for a clipped (not display:none) input: some phone
                // browsers ignore script-triggered clicks on hidden file inputs.
                <label className={cls}>
                  {o.file === "image" ? (
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => onImage(e.target.files?.[0])} />
                  ) : (
                    <input
                      type="file"
                      accept=".json,.txt,.2fas,application/json,text/plain"
                      className="sr-only"
                      onChange={(e) => {
                        onImportFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  )}
                  {body}
                </label>
              ) : (
                <button onClick={o.onClick} className={cls}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {reading && <p className="mt-4 text-center text-muted">Reading the picture…</p>}
      {error && <p className="mt-4 rounded-xl bg-warn/10 p-3 text-sm text-warn" role="alert">{error}</p>}
      <p className="mt-8 text-sm text-muted">
        Everything is read on this phone. Pictures and codes are never uploaded anywhere.
      </p>
    </Screen>
  );
}

// -- camera -----------------------------------------------------------------

function Scanner({ onBack, onText, error }: { onBack: () => void; onText: (t: string) => boolean; error: string | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lastBad = useRef("");
  // Read through a ref: the parent's callback is new on every render, and as
  // an effect dependency it would restart the camera each time.
  const handler = useRef(onText);
  useEffect(() => {
    handler.current = onText;
  }, [onText]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    let busy = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This browser can't use the camera here. Use a screenshot instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (err) {
        const name = (err as DOMException)?.name;
        setProblem(
          name === "NotAllowedError"
            ? "Camera permission was refused. Allow it in the browser's site settings, or use a screenshot instead."
            : "Couldn't start the camera. Use a screenshot instead."
        );
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const el = video.current!;
      el.srcObject = stream;
      await el.play().catch(() => undefined);

      timer = window.setInterval(async () => {
        if (busy || el.readyState < 2 || !el.videoWidth) return;
        busy = true;
        try {
          const text = await decodeImageData(toImageData(el, el.videoWidth, el.videoHeight, 720));
          // The same unreadable code sits in frame for many ticks; report it once.
          if (text && text !== lastBad.current && !handler.current(text)) lastBad.current = text;
        } finally {
          busy = false;
        }
      }, 250);
    })();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Screen title="Scan QR code" onBack={onBack}>
      {problem ? (
        <p className="rounded-xl bg-warn/10 p-4 text-warn" role="alert">{problem}</p>
      ) : (
        <>
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-black">
            <video ref={video} playsInline muted className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-[14%] rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,.35)]" />
          </div>
          <p className="mt-4 text-center text-muted">Fit the QR code inside the square.</p>
          {error && <p className="mt-3 rounded-xl bg-warn/10 p-3 text-center text-sm text-warn" role="alert">{error}</p>}
        </>
      )}
    </Screen>
  );
}

// -- paste ------------------------------------------------------------------

function Paste({ onBack, onText, error }: { onBack: () => void; onText: (t: string) => boolean; error: string | null }) {
  const [text, setText] = useState("");
  return (
    <Screen title="Paste a setup link" onBack={onBack}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onText(text);
        }}
        className="space-y-4"
      >
        <Field label="Setup link" hint="Starts with otpauth:// or otpauth-migration://">
          <textarea
            className={`${inputClass} h-32 py-3 font-mono text-sm`}
            style={{ fontSize: 16 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </Field>
        {error && <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn" role="alert">{error}</p>}
        <button className={`${primaryButton} w-full`} disabled={!text.trim()}>
          Continue
        </button>
      </form>
    </Screen>
  );
}

// -- manual -----------------------------------------------------------------

function Manual({ onBack, onDraft }: { onBack: () => void; onDraft: (d: EntryDraft) => void }) {
  const [issuer, setIssuer] = useState("");
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [type, setType] = useState<"totp" | "hotp">("totp");
  const [algorithm, setAlgorithm] = useState<Algorithm>("SHA1");
  const [digits, setDigits] = useState<6 | 7 | 8>(6);
  const [period, setPeriod] = useState(30);
  const [counter, setCounter] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!issuer.trim() && !account.trim()) return setError("Give the account a name so you can tell it apart.");
    if (!isValidBase32(secret)) return setError("That key doesn't look right. It should be letters A–Z and digits 2–7, at least 16 of them.");
    onDraft({ type, issuer, account, secret: normalizeBase32(secret), algorithm, digits, period, counter: type === "hotp" ? counter : 0 });
  }

  const select = `${inputClass} appearance-none`;
  return (
    <Screen title="Type the key in" onBack={onBack}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Service" hint="e.g. GitHub, Google, Standard Bank">
          <input className={inputClass} value={issuer} onChange={(e) => setIssuer(e.target.value)} autoFocus />
        </Field>
        <Field label="Account" hint="Usually your email or username">
          <input className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)} autoCapitalize="off" />
        </Field>
        <Field label="Secret key" hint="Spaces don't matter">
          <input
            className={`${inputClass} font-mono uppercase`}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        <details className="rounded-xl border border-line bg-surface">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-medium">Advanced (leave as is unless told otherwise)</summary>
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <Field label="Type">
              <select className={select} value={type} onChange={(e) => setType(e.target.value as "totp" | "hotp")}>
                <option value="totp">Time-based</option>
                <option value="hotp">Counter-based</option>
              </select>
            </Field>
            <Field label="Algorithm">
              <select className={select} value={algorithm} onChange={(e) => setAlgorithm(e.target.value as Algorithm)}>
                <option>SHA1</option>
                <option>SHA256</option>
                <option>SHA512</option>
              </select>
            </Field>
            <Field label="Digits">
              <select className={select} value={digits} onChange={(e) => setDigits(Number(e.target.value) as 6 | 7 | 8)}>
                <option>6</option>
                <option>7</option>
                <option>8</option>
              </select>
            </Field>
            {type === "totp" ? (
              <Field label="Seconds">
                <input type="number" inputMode="numeric" min={1} max={300} className={inputClass} value={period} onChange={(e) => setPeriod(Number(e.target.value) || 30)} />
              </Field>
            ) : (
              <Field label="Counter">
                <input type="number" inputMode="numeric" min={0} className={inputClass} value={counter} onChange={(e) => setCounter(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            )}
          </div>
        </details>
        {error && <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn" role="alert">{error}</p>}
        <button className={`${primaryButton} w-full`}>Continue</button>
      </form>
    </Screen>
  );
}

// -- review -----------------------------------------------------------------

function ReviewScreen({ review, onBack, done }: { review: Review; onBack: () => void; done: () => void }) {
  const vault = useVault();
  const toast = useToast();
  const { fresh, duplicates } = splitDuplicates(vault.entries, review.drafts);
  const [items, setItems] = useState(() => review.drafts.map((d) => ({ draft: d, keep: fresh.includes(d) })));
  const [busy, setBusy] = useState(false);
  const single = items.length === 1;

  const edit = (i: number, patch: Partial<EntryDraft>) =>
    setItems((list) => list.map((it, j) => (j === i ? { ...it, draft: { ...it.draft, ...patch } } : it)));

  async function save() {
    const chosen = items.filter((i) => i.keep).map((i) => i.draft);
    if (!chosen.length) return;
    setBusy(true);
    try {
      const n = await vault.add(chosen);
      toast(`Added ${n} account${n === 1 ? "" : "s"}`);
      done();
    } catch {
      toast("Couldn't save. Nothing was added.");
      setBusy(false);
    }
  }

  const count = items.filter((i) => i.keep).length;
  return (
    <Screen title={single ? "Check and save" : `Import ${review.drafts.length} accounts`} onBack={onBack}>
      {review.source && (
        <p className="mb-4 text-sm text-muted">
          From your {review.source} export. Once these are saved here, delete the export file — it isn&apos;t encrypted.
        </p>
      )}
      {review.batch && (
        <p className="mb-4 rounded-xl bg-accent-soft p-3 text-sm">
          This is QR code {review.batch.index + 1} of {review.batch.size} from Google Authenticator. Save these, then scan the next one.
        </p>
      )}
      {duplicates.length > 0 && (
        <p className="mb-4 rounded-xl bg-accent-soft p-3 text-sm">
          {duplicates.length === items.length && single
            ? "This account is already in the vault."
            : duplicates.length === 1
              ? "One of these is already in the vault and has been unticked."
              : `${duplicates.length} of these are already in the vault and have been unticked.`}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            {single ? (
              <div className="space-y-3">
                <Field label="Service">
                  <input className={inputClass} value={it.draft.issuer} onChange={(e) => edit(i, { issuer: e.target.value })} />
                </Field>
                <Field label="Account">
                  <input className={inputClass} value={it.draft.account} onChange={(e) => edit(i, { account: e.target.value })} autoCapitalize="off" />
                </Field>
              </div>
            ) : (
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                  checked={it.keep}
                  onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{it.draft.issuer || it.draft.account || "Unnamed"}</span>
                  {it.draft.issuer && <span className="block truncate text-sm text-muted">{it.draft.account}</span>}
                </span>
              </label>
            )}
            <p className="mt-3 text-xs text-muted">
              {it.draft.type === "hotp" ? `Counter-based · counter ${it.draft.counter}` : `Every ${it.draft.period}s`} · {it.draft.digits} digits ·{" "}
              {it.draft.algorithm}
            </p>
          </li>
        ))}
      </ul>
      {review.skipped.length > 0 && (
        <div className="mt-4 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          <strong>Could not bring across:</strong>
          <ul className="mt-1 list-disc pl-5">
            {review.skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-6 flex gap-2">
        <button onClick={onBack} className={`${secondaryButton} flex-1`}>
          Cancel
        </button>
        <button onClick={save} disabled={busy || count === 0} className={`${primaryButton} flex-1`}>
          {busy ? "Saving…" : single ? "Save" : `Add ${count}`}
        </button>
      </div>
    </Screen>
  );
}
