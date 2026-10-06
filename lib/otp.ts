/**
 * HOTP (RFC 4226) and TOTP (RFC 6238) on Web Crypto.
 *
 * No library: the algorithm is twenty lines, and the test suite runs it
 * against the RFCs' own published vectors, which is a stronger guarantee
 * than trusting a dependency's.
 */
import { base32Decode } from "./base32";
import type { Algorithm, Entry } from "./types";

const HASH: Record<Algorithm, string> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

async function hmac(algorithm: Algorithm, key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: HASH[algorithm] },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, message as BufferSource));
}

/** Big-endian 8-byte counter. Exact well past any real counter or timestamp. */
function counterBytes(counter: number): Uint8Array {
  const out = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i--) {
    out[i] = value % 256;
    value = Math.floor(value / 256);
  }
  return out;
}

export async function hotpFromKey(
  key: Uint8Array,
  counter: number,
  digits: number,
  algorithm: Algorithm
): Promise<string> {
  const mac = await hmac(algorithm, key, counterBytes(counter));
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The TOTP time step a moment falls in. */
export function timeStep(nowMs: number, period: number): number {
  return Math.floor(nowMs / 1000 / period);
}

/** Seconds until the current code expires, 1..period. */
export function secondsLeft(nowMs: number, period: number): number {
  return period - (Math.floor(nowMs / 1000) % period);
}

/** The code for an entry. TOTP uses `step` (defaults to now); HOTP uses its counter. */
export async function generate(entry: Entry, nowMs = Date.now(), stepOffset = 0): Promise<string> {
  const key = base32Decode(entry.secret);
  const counter = entry.type === "hotp" ? entry.counter : timeStep(nowMs, entry.period) + stepOffset;
  return hotpFromKey(key, counter, entry.digits, entry.algorithm);
}

/** "123456" → "123 456", "12345678" → "1234 5678". Display only; copy the raw digits. */
export function groupCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  if (code.length === 7) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}
