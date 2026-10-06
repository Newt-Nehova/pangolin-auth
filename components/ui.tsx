"use client";

/** Small shared pieces. Every tappable thing here is at least 44px tall. */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export const inputClass =
  "h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

export const primaryButton =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-ink transition active:scale-[.98] disabled:opacity-50";

export const secondaryButton =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 font-medium text-ink transition active:scale-[.98] disabled:opacity-50";

export const dangerButton =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-warn px-5 font-semibold text-white transition active:scale-[.98] disabled:opacity-50";

export const iconButton =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-xl text-ink transition hover:bg-raised active:scale-95";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

/** A full-screen page with a back button. Screens, not modals: phones' back gesture just works. */
export function Screen({ title, onBack, children, action }: { title: string; onBack: () => void; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-line bg-bg/90 px-2 py-2 backdrop-blur">
        <button onClick={onBack} className={iconButton} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        {action}
      </header>
      <main className="flex-1 px-4 pb-16 pt-4">{children}</main>
    </div>
  );
}

const PATHS: Record<string, string> = {
  back: "M15 18l-6-6 6-6",
  plus: "M12 5v14M5 12h14",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  camera: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z",
  image: "M3 3h18v18H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21",
  link: "M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7",
  keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  check: "M20 6L9 17l-5-5",
  up: "M18 15l-6-6-6 6",
  down: "M6 9l6 6 6-6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.8-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15",
  x: "M18 6L6 18M6 6l12 12",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
};

export function Icon({ name, size = 22, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

// -- toast ------------------------------------------------------------------

const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {message && (
          <div className="rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-bg shadow-lg">{message}</div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
