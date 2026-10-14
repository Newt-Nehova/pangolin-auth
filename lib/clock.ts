/**
 * Is this phone's clock right? TOTP codes are just the time, hashed: a clock
 * a minute out makes every code wrong, and it is the commonest reason codes
 * get rejected.
 *
 * The reference is the Date header on a HEAD request to Pangolin's own site,
 * so nothing is sent anywhere new (and the CSP allows nothing else anyway).
 * HEAD is never handled by the service worker, so the answer is always fresh.
 * Offline, there is simply no check.
 */

/** Warn at this many seconds out. Most services accept a code one step (30s) either side. */
export const SKEW_WARN_SECONDS = 20;

let cached: Promise<number | null> | null = null;

/** Seconds the phone is ahead of real time (negative = behind), or null if unknown. Measured once per page load. */
export function clockSkew(): Promise<number | null> {
  cached ??= measure().catch(() => null);
  return cached;
}

async function measure(): Promise<number | null> {
  if (!navigator.onLine) return null;
  const sent = Date.now();
  const res = await fetch("/", { method: "HEAD", cache: "no-store" });
  const received = Date.now();
  const header = res.headers.get("date");
  if (!header) return null;
  // The header is truncated to the whole second, so on average it is half a
  // second behind; the midpoint of the round trip is when it was stamped.
  const server = Date.parse(header) + 500;
  if (Number.isNaN(server) || received - sent > 5000) return null; // too slow to trust
  return skewSeconds((sent + received) / 2, server);
}

export function skewSeconds(phoneMs: number, serverMs: number): number {
  return Math.round((phoneMs - serverMs) / 1000);
}

export function describeSkew(seconds: number): string {
  const abs = Math.abs(seconds);
  const amount = abs >= 90 ? `${Math.round(abs / 60)} minutes` : `${abs} seconds`;
  return `This phone's clock is ${amount} ${seconds > 0 ? "fast" : "slow"}`;
}
