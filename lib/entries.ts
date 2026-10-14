import { isValidBase32, normalizeBase32 } from "./base32";
import type { Entry, EntryDraft } from "./types";

/** Rebuilds a draft from untrusted data (a decrypted backup), or null if anything is off. */
export function toDraft(value: unknown): EntryDraft | null {
  const v = value as Partial<Entry> | null;
  if (!v || typeof v !== "object") return null;
  const secret = typeof v.secret === "string" ? normalizeBase32(v.secret) : "";
  if (!isValidBase32(secret)) return null;
  if (v.type !== "totp" && v.type !== "hotp") return null;
  if (v.algorithm !== "SHA1" && v.algorithm !== "SHA256" && v.algorithm !== "SHA512") return null;
  if (v.digits !== 6 && v.digits !== 7 && v.digits !== 8) return null;
  const period = Number(v.period ?? 30);
  const counter = Number(v.counter ?? 0);
  if (!Number.isInteger(period) || period < 1 || period > 300) return null;
  if (!Number.isSafeInteger(counter) || counter < 0) return null;
  const group = typeof v.group === "string" ? v.group.trim().slice(0, 40) : "";
  return {
    ...(v.pinned === true ? { pinned: true } : {}),
    ...(group ? { group } : {}),
    type: v.type,
    issuer: String(v.issuer ?? "").slice(0, 200),
    account: String(v.account ?? "").slice(0, 200),
    secret,
    algorithm: v.algorithm,
    digits: v.digits,
    period,
    counter,
  };
}

export function newEntry(draft: EntryDraft, now = new Date()): Entry {
  const stamp = now.toISOString();
  return {
    ...draft,
    issuer: draft.issuer.trim(),
    account: draft.account.trim(),
    id: crypto.randomUUID(),
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * Two entries are the same account when they would produce the same codes.
 * The secret alone decides it: names are cosmetic and often differ between
 * apps for the very same account.
 */
export function sameAccount(a: EntryDraft, b: EntryDraft): boolean {
  return (
    a.secret === b.secret &&
    a.type === b.type &&
    a.algorithm === b.algorithm &&
    a.digits === b.digits &&
    (a.type === "hotp" || a.period === b.period)
  );
}

export function splitDuplicates<T extends EntryDraft>(existing: EntryDraft[], incoming: T[]) {
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const item of incoming) {
    const seen = [...existing, ...fresh].some((e) => sameAccount(e, item));
    (seen ? duplicates : fresh).push(item);
  }
  return { fresh, duplicates };
}

export function displayName(entry: Pick<Entry, "issuer" | "account">): string {
  return entry.issuer || entry.account || "Unnamed account";
}

/** A stable colour per issuer, so the same service always wears the same badge. */
export function badgeHue(seed: string): number {
  let hash = 0;
  for (const char of seed.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/** Pinned first; otherwise the user's own order. Stable. */
export function displayOrder(entries: Entry[]): Entry[] {
  return [...entries.filter((e) => e.pinned), ...entries.filter((e) => !e.pinned)];
}

/** Every group in use, A–Z, case-insensitively de-duplicated. */
export function groupsOf(entries: Entry[]): string[] {
  const seen = new Map<string, string>();
  for (const e of entries) {
    const g = e.group?.trim();
    if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function matchesQuery(entry: Entry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.issuer.toLowerCase().includes(q) ||
    entry.account.toLowerCase().includes(q) ||
    (entry.group ?? "").toLowerCase().includes(q)
  );
}
