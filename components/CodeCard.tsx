"use client";

import { memo, useEffect, useState } from "react";
import { badgeHue, displayName } from "@/lib/entries";
import { generate, groupCode, secondsLeft, timeStep } from "@/lib/otp";
import type { Entry } from "@/lib/types";
import { copyCode } from "@/lib/clipboard";
import { useVault } from "@/lib/vault";
import { Icon, useToast } from "./ui";

function Badge({ entry }: { entry: Entry }) {
  const name = displayName(entry);
  const hue = badgeHue(name);
  return (
    <div
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
      style={{ background: `hsl(${hue} 45% 50% / .18)`, color: `hsl(${hue} 55% 55%)` }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function Ring({ left, period }: { left: number; period: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const urgent = left <= 5;
  return (
    <div className="relative h-10 w-10 shrink-0" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={urgent ? "var(--warn)" : "var(--accent)"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - left / period)}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-mono text-xs tabular-nums ${urgent ? "text-warn" : "text-muted"}`}>
        {left}
      </span>
    </div>
  );
}

function TotpCard({ entry, now, onEdit, selecting, selected, onToggle }: CardProps) {
  const toast = useToast();
  const { meta } = useVault();
  const step = timeStep(now, entry.period);
  const left = secondsLeft(now, entry.period);
  const [codes, setCodes] = useState<{ step: number; now: string; next: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([generate(entry, step * entry.period * 1000), generate(entry, (step + 1) * entry.period * 1000)])
      .then(([current, next]) => live && setCodes({ step, now: current, next }))
      .catch(() => live && setCodes({ step, now: "—", next: "—" }));
    return () => {
      live = false;
    };
  }, [entry, step]);

  const ready = codes?.step === step;
  const code = ready ? codes.now : null;

  async function tap() {
    if (selecting) return onToggle();
    if (!code) return;
    toast((await copyCode(code, meta.clearClipboard)) ? `Copied ${groupCode(code)}` : "Couldn't copy — long-press the code instead");
  }

  return (
    <CardShell entry={entry} onTap={tap} onEdit={onEdit} selecting={selecting} selected={selected}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={`select-all font-mono text-[2rem] font-medium leading-none tracking-wide tabular-nums ${left <= 5 ? "text-warn" : "text-ink"}`}>
            {code ? groupCode(code) : groupCode("•".repeat(entry.digits))}
          </div>
          {/* In the last seconds, show what comes next so nobody types a dying code. */}
          <div className="mt-1.5 h-4 font-mono text-xs text-muted tabular-nums">
            {left <= 8 && ready ? <>next {groupCode(codes.next)}</> : null}
          </div>
        </div>
        <Ring left={left} period={entry.period} />
      </div>
    </CardShell>
  );
}

function HotpCard({ entry, onEdit, selecting, selected, onToggle }: CardProps) {
  const vault = useVault();
  const toast = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // HOTP: the counter must be saved as used BEFORE the code is shown, or a
  // crash could hand out the same code twice and desync from the server.
  async function next() {
    setBusy(true);
    try {
      const value = await generate(entry);
      await vault.update(entry.id, { counter: entry.counter + 1 });
      setCode(value);
      toast((await copyCode(value, vault.meta.clearClipboard)) ? `Copied ${groupCode(value)}` : "New code ready");
    } finally {
      setBusy(false);
    }
  }

  async function tap() {
    if (selecting) return onToggle();
    if (code) toast((await copyCode(code, vault.meta.clearClipboard)) ? `Copied ${groupCode(code)}` : "Couldn't copy");
  }

  return (
    <CardShell entry={entry} onTap={tap} onEdit={onEdit} selecting={selecting} selected={selected}>
      <div className="flex items-end justify-between gap-3">
        <div className="select-all font-mono text-[2rem] font-medium leading-none tracking-wide text-ink tabular-nums">
          {code ? groupCode(code) : groupCode("•".repeat(entry.digits))}
        </div>
        {!selecting && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            disabled={busy}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent-soft px-3 text-sm font-semibold text-accent disabled:opacity-50"
          >
            <Icon name="refresh" size={16} /> {code ? "Next" : "Get code"}
          </button>
        )}
      </div>
    </CardShell>
  );
}

interface CardProps {
  entry: Entry;
  now: number;
  onEdit: () => void;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}

function CardShell({
  entry,
  onTap,
  onEdit,
  selecting,
  selected,
  children,
}: {
  entry: Entry;
  onTap: () => void;
  onEdit: () => void;
  selecting: boolean;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onTap())}
      aria-pressed={selecting ? selected : undefined}
      className={`cursor-pointer rounded-2xl border bg-surface p-4 shadow-sm transition active:scale-[.99] ${
        selected ? "border-accent ring-2 ring-accent/40" : "border-line"
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        {selecting ? (
          <div
            aria-hidden
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 ${selected ? "border-accent bg-accent text-accent-ink" : "border-line"}`}
          >
            {selected && <Icon name="check" size={20} />}
          </div>
        ) : (
          <Badge entry={entry} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{displayName(entry)}</div>
          {entry.issuer && entry.account && <div className="truncate text-sm text-muted">{entry.account}</div>}
        </div>
        {!selecting && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-raised"
            aria-label={`Edit ${displayName(entry)}`}
          >
            <Icon name="edit" size={18} />
          </button>
        )}
      </div>
      {children}
    </li>
  );
}

export const CodeCard = memo(function CodeCard(props: CardProps) {
  return props.entry.type === "hotp" ? <HotpCard {...props} /> : <TotpCard {...props} />;
});
