"use client";

import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { matchesQuery } from "@/lib/entries";
import { clockSkew, describeSkew, SKEW_WARN_SECONDS } from "@/lib/clock";
import { warmQrReader } from "@/lib/qr";
import { useVault } from "@/lib/vault";
import { CodeCard } from "./CodeCard";
import { Mark } from "./Mark";
import { dangerButton, Icon, iconButton, inputClass, primaryButton, secondaryButton, useToast } from "./ui";

/** One clock for every card, so all rings tick together. setInterval, not rAF: rAF stalls in background panes. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Tick just after each whole second, so a code never outlives its step
    // on screen by up to a second.
    let t: number | undefined;
    const schedule = () => {
      t = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, 1000 - (Date.now() % 1000) + 15);
    };
    schedule();
    const wake = () => setNow(Date.now());
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return now;
}

export function Home({ go, focusSearch = false }: { go: (route: string) => void; focusSearch?: boolean }) {
  const vault = useVault();
  const toast = useToast();
  const now = useNow();
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  useEffect(warmQrReader, []);

  // A wrong clock makes every code wrong; say so before the user finds out the hard way.
  const [skew, setSkew] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    clockSkew().then((s) => live && s !== null && Math.abs(s) >= SKEW_WARN_SECONDS && setSkew(s));
    return () => {
      live = false;
    };
  }, []);

  const list = useMemo(() => vault.entries.filter((e) => matchesQuery(e, query)), [vault.entries, query]);
  const { meta, entries } = vault;
  const unbacked =
    entries.length > 0 && (!meta.lastBackupAt || (meta.lastChangeAt !== null && meta.lastChangeAt > meta.lastBackupAt));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
    setConfirming(false);
  }

  async function removeSelected() {
    const count = selected.size;
    await vault.remove([...selected]);
    exitSelect();
    toast(`Removed ${count} account${count === 1 ? "" : "s"}`);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 px-3 py-2 backdrop-blur">
        {selecting ? (
          <div className="flex items-center gap-2">
            <button onClick={exitSelect} className={iconButton} aria-label="Cancel selection">
              <Icon name="x" />
            </button>
            <span className="min-w-0 flex-1 font-semibold">{selected.size} selected</span>
            <button
              onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((e) => e.id)))}
              className="h-11 rounded-xl px-3 text-sm font-medium text-accent"
            >
              {selected.size === list.length ? "None" : "All"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Mark size={28} className="ml-1 text-accent" />
            <span className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{BRAND.name}</span>
            {entries.length > 0 && (
              <button onClick={() => setSelecting(true)} className="h-11 rounded-xl px-3 text-sm font-medium text-muted hover:bg-raised">
                Select
              </button>
            )}
            <button onClick={() => go("settings")} className={iconButton} aria-label="Settings">
              <Icon name="gear" />
            </button>
            <button onClick={vault.lock} className={iconButton} aria-label="Lock now">
              <Icon name="lock" />
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 px-4 pb-40 pt-4">
        {skew !== null && !selecting && (
          <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
            <Icon name="alert" className="mt-0.5 shrink-0 text-warn" />
            <span>
              <strong className="block text-ink">{describeSkew(skew)}</strong>
              <span className="text-muted">
                Codes are made from the time, so sites may reject them. In your phone&apos;s settings, set the date and time to
                automatic.
              </span>
            </span>
          </div>
        )}
        {unbacked && !selecting && (
          <button
            onClick={() => go("settings")}
            className="mb-4 flex w-full items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-left"
          >
            <Icon name="alert" className="mt-0.5 shrink-0 text-warn" />
            <span className="text-sm">
              <strong className="block text-ink">
                {meta.lastBackupAt ? "You've made changes since your last backup" : "No backup yet"}
              </strong>
              <span className="text-muted">If this phone is lost or reset, these accounts go with it. Tap to back up.</span>
            </span>
          </button>
        )}

        {(entries.length > 4 || focusSearch) && entries.length > 0 && (
          <div className="relative mb-4">
            <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Search accounts"
              aria-label="Search accounts"
              className={`${inputClass} pl-10`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus={focusSearch}
            />
          </div>
        )}

        {entries.length === 0 ? (
          <div className="mt-16 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Mark size={36} />
            </div>
            <h2 className="text-xl font-semibold">No accounts yet</h2>
            <p className="mx-auto mt-2 max-w-xs text-muted">
              Turn on two-factor sign-in at a website, then scan the QR code it shows you.
            </p>
            <button onClick={() => go("add")} className={`${primaryButton} mt-6`}>
              <Icon name="plus" size={20} /> Add your first account
            </button>
          </div>
        ) : list.length === 0 ? (
          <p className="mt-10 text-center text-muted">Nothing matches “{query}”.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((entry) => (
              <CodeCard
                key={entry.id}
                entry={entry}
                now={now}
                onEdit={() => go(`edit:${entry.id}`)}
                selecting={selecting}
                selected={selected.has(entry.id)}
                onToggle={() => toggle(entry.id)}
              />
            ))}
          </ul>
        )}
        {entries.length > 0 && !selecting && <p className="mt-6 text-center text-sm text-muted">Tap a code to copy it.</p>}
      </main>

      {selecting ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-lg">
            {confirming ? (
              <div className="space-y-3">
                <p className="text-sm">
                  <strong>Turn off two-factor on {selected.size === 1 ? "that account" : "those accounts"} first.</strong>{" "}
                  <span className="text-muted">Once removed here, these codes are gone unless they are in a backup.</span>
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirming(false)} className={`${secondaryButton} flex-1`}>
                    Keep
                  </button>
                  <button onClick={removeSelected} className={`${dangerButton} flex-1`}>
                    Remove {selected.size}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)} disabled={selected.size === 0} className={`${dangerButton} w-full`}>
                Remove {selected.size || ""} account{selected.size === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      ) : (
        entries.length > 0 && (
          <button
            onClick={() => go("add")}
            className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-5 z-30 inline-flex h-14 items-center gap-2 rounded-2xl bg-accent px-5 font-semibold text-accent-ink shadow-lg active:scale-95"
          >
            <Icon name="plus" size={22} /> Add
          </button>
        )
      )}
    </div>
  );
}
