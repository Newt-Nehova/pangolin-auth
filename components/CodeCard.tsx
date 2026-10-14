"use client";

import { memo, useEffect, useState } from "react";
import { copyCode } from "@/lib/clipboard";
import { badgeHue, displayName } from "@/lib/entries";
import { inkOn, logoFor } from "@/lib/logos";
import { generate, groupCode, secondsLeft, timeStep } from "@/lib/otp";
import type { Entry } from "@/lib/types";
import { useVault } from "@/lib/vault";
import { Icon, useToast } from "./ui";

/** The service's logo where we have it, otherwise a stable coloured initial. */
function Badge({ entry, small = false }: { entry: Entry; small?: boolean }) {
  const size = small ? "h-9 w-9 rounded-lg" : "h-11 w-11 rounded-xl";
  const logo = logoFor(entry.issuer, entry.account);
  if (logo) {
    return (
      <div aria-hidden className={`flex shrink-0 items-center justify-center ${size}`} style={{ background: `#${logo.hex}` }}>
        <svg viewBox="0 0 24 24" className={small ? "h-5 w-5" : "h-6 w-6"} fill={inkOn(logo.hex)}>
          <path d={logo.path} />
        </svg>
      </div>
    );
  }
  const name = displayName(entry);
  const hue = badgeHue(name);
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center font-semibold ${size} ${small ? "text-base" : "text-lg"}`}
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

/** Compact mode's countdown: a hairline along the bottom of the row. */
function Bar({ left, period }: { left: number; period: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-2xl" aria-label={`${left} seconds left`}>
      <div
        className={`h-full transition-[width] duration-1000 ease-linear ${left <= 5 ? "bg-warn" : "bg-accent"}`}
        style={{ width: `${(left / period) * 100}%` }}
      />
    </div>
  );
}

function useTotp(entry: Entry, now: number) {
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
  return { left, code: ready ? codes.now : null, next: ready ? codes.next : null };
}

function TotpCard(props: CardProps) {
  const { entry, now, selecting, onToggle, compact } = props;
  const toast = useToast();
  const { meta } = useVault();
  const { left, code, next } = useTotp(entry, now);
  const urgent = left <= 5;

  async function tap() {
    if (selecting) return onToggle();
    if (!code) return;
    toast((await copyCode(code, meta.clearClipboard)) ? `Copied ${groupCode(code)}` : "Couldn't copy — long-press the code instead");
  }

  // Keyed on the code so each new code eases in: the eye catches the change
  // instead of a digit silently swapping under a thumb about to tap.
  const digits = (
    <span key={code ?? "pending"} className="code-in inline-block">
      {code ? groupCode(code) : groupCode("•".repeat(entry.digits))}
    </span>
  );

  if (compact) {
    return (
      <CardShell {...props} onTap={tap} compact>
        <div className={`shrink-0 font-mono text-xl font-medium tabular-nums ${urgent ? "text-warn" : "text-ink"}`}>{digits}</div>
        <Bar left={left} period={entry.period} />
      </CardShell>
    );
  }

  return (
    <CardShell {...props} onTap={tap}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={`select-all font-mono text-[2rem] font-medium leading-none tracking-wide tabular-nums ${urgent ? "text-warn" : "text-ink"}`}>
            {digits}
          </div>
          {/* In the last seconds, show what comes next so nobody types a dying code. */}
          <div className="mt-1.5 h-4 font-mono text-xs text-muted tabular-nums">{left <= 8 && next ? <>next {groupCode(next)}</> : null}</div>
        </div>
        <Ring left={left} period={entry.period} />
      </div>
    </CardShell>
  );
}

function HotpCard(props: CardProps) {
  const { entry, selecting, onToggle } = props;
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

  // Counter codes keep the full card even in compact mode: they need a
  // "Get code" button, and there's no room for it in a one-line row.
  return (
    <CardShell {...props} onTap={tap} compact={false}>
      <div className="flex items-end justify-between gap-3">
        <div className="select-all font-mono text-[2rem] font-medium leading-none tracking-wide text-ink tabular-nums">
          <span key={code ?? "pending"} className="code-in inline-block">
            {code ? groupCode(code) : groupCode("•".repeat(entry.digits))}
          </span>
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
  compact: boolean;
}

function CardShell({
  entry,
  onTap,
  onEdit,
  selecting,
  selected,
  compact,
  children,
}: CardProps & { onTap: () => void; children: React.ReactNode }) {
  const name = (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-semibold">{displayName(entry)}</span>
        {entry.pinned && (
          <>
            <Icon name="star" size={14} className="shrink-0 fill-accent text-accent" />
            <span className="sr-only">(pinned)</span>
          </>
        )}
      </div>
      {entry.issuer && entry.account && <div className={`truncate text-muted ${compact ? "text-xs" : "text-sm"}`}>{entry.account}</div>}
    </div>
  );
  const lead = selecting ? (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center border-2 ${compact ? "h-9 w-9 rounded-lg" : "h-11 w-11 rounded-xl"} ${
        selected ? "border-accent bg-accent text-accent-ink" : "border-line"
      }`}
    >
      {selected && <Icon name="check" size={20} />}
    </div>
  ) : (
    <Badge entry={entry} small={compact} />
  );
  const edit = !selecting && (
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
  );

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onTap())}
      aria-pressed={selecting ? selected : undefined}
      className={`relative cursor-pointer rounded-2xl border bg-surface shadow-sm transition active:scale-[.99] ${compact ? "px-3 py-2" : "p-4"} ${
        selected ? "border-accent ring-2 ring-accent/40" : "border-line"
      }`}
    >
      {compact ? (
        <div className="flex min-h-11 items-center gap-3">
          {lead}
          {name}
          {children}
          {edit}
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            {lead}
            {name}
            {edit}
          </div>
          {children}
        </>
      )}
    </li>
  );
}

export const CodeCard = memo(function CodeCard(props: CardProps) {
  return props.entry.type === "hotp" ? <HotpCard {...props} /> : <TotpCard {...props} />;
});
