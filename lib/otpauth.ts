/**
 * Reading what QR codes carry.
 *
 * - `otpauth://totp/Issuer:account?secret=…` -- the de-facto standard every
 *   site's "set up authenticator" QR uses (Google's Key Uri Format).
 * - `otpauth-migration://offline?data=…` -- Google Authenticator's
 *   "Transfer accounts" export: a base64 protobuf holding many accounts.
 *
 * Everything parsed here is a draft. Nothing is saved until the user has
 * seen it on the review screen.
 */
import { base32Decode, base32Encode, isValidBase32, normalizeBase32 } from "./base32";
import type { Algorithm, EntryDraft } from "./types";

export class ParseError extends Error {}

const ALGORITHMS: Algorithm[] = ["SHA1", "SHA256", "SHA512"];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseOtpauth(text: string): EntryDraft {
  const raw = text.trim();
  const match = /^otpauth:\/\/(totp|hotp)\/([^?]*)(?:\?(.*))?$/i.exec(raw);
  if (!match) throw new ParseError("That isn't an authenticator link. It should start with otpauth://");
  const type = match[1].toLowerCase() as "totp" | "hotp";
  const label = safeDecode(match[2]);
  const params = new URLSearchParams(match[3] ?? "");

  const secret = normalizeBase32(params.get("secret") ?? "");
  if (!secret) throw new ParseError("The link has no secret in it.");
  if (!isValidBase32(secret)) throw new ParseError("The secret in the link is damaged or too short.");

  // Label is "Issuer:account" or just "account". The issuer parameter wins
  // when both exist, as the spec asks.
  let issuer = "";
  let account = label;
  const colon = label.indexOf(":");
  if (colon >= 0) {
    issuer = label.slice(0, colon).trim();
    account = label.slice(colon + 1).trim();
  }
  issuer = (params.get("issuer") ?? issuer).trim();

  const algorithm = (params.get("algorithm") ?? "SHA1").toUpperCase() as Algorithm;
  if (!ALGORITHMS.includes(algorithm)) throw new ParseError(`Unsupported algorithm: ${algorithm}`);

  const digits = Number(params.get("digits") ?? 6);
  if (digits !== 6 && digits !== 7 && digits !== 8) throw new ParseError(`Unsupported code length: ${digits}`);

  const period = Number(params.get("period") ?? 30);
  if (!Number.isInteger(period) || period < 1 || period > 300) throw new ParseError(`Unsupported period: ${period}`);

  const counter = Number(params.get("counter") ?? 0);
  if (type === "hotp" && (!Number.isSafeInteger(counter) || counter < 0)) throw new ParseError("Bad counter.");

  return { type, issuer, account, secret, algorithm, digits, period, counter: type === "hotp" ? counter : 0 };
}

export function buildOtpauth(entry: EntryDraft): string {
  const label = entry.issuer
    ? `${encodeURIComponent(entry.issuer)}:${encodeURIComponent(entry.account)}`
    : encodeURIComponent(entry.account);
  const params = new URLSearchParams({ secret: entry.secret });
  if (entry.issuer) params.set("issuer", entry.issuer);
  params.set("algorithm", entry.algorithm);
  params.set("digits", String(entry.digits));
  if (entry.type === "totp") params.set("period", String(entry.period));
  else params.set("counter", String(entry.counter));
  return `otpauth://${entry.type}/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Google Authenticator migration payload.
//
// message MigrationPayload {
//   repeated OtpParameters otp_parameters = 1;
//   int32 version = 2; int32 batch_size = 3; int32 batch_index = 4; int32 batch_id = 5;
// }
// message OtpParameters {
//   bytes secret = 1; string name = 2; string issuer = 3;
//   Algorithm algorithm = 4;  // 0 unspecified, 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
//   DigitCount digits = 5;    // 0 unspecified, 1 six, 2 eight
//   OtpType type = 6;         // 0 unspecified, 1 HOTP, 2 TOTP
//   int64 counter = 7;
// }
// ---------------------------------------------------------------------------

export interface MigrationResult {
  drafts: EntryDraft[];
  /** Accounts in the payload we could not carry over, with the reason. */
  skipped: string[];
  batchIndex: number;
  batchSize: number;
}

type Field = { field: number; wire: number; value: number | Uint8Array };

function readFields(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) throw new ParseError("The transfer code is cut short.");
      const byte = bytes[pos++];
      result += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return result;
      multiplier *= 128;
    }
    throw new ParseError("The transfer code is damaged.");
  };
  while (pos < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) fields.push({ field, wire, value: varint() });
    else if (wire === 2) {
      const length = varint();
      if (pos + length > bytes.length) throw new ParseError("The transfer code is cut short.");
      fields.push({ field, wire, value: bytes.slice(pos, pos + length) });
      pos += length;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new ParseError("The transfer code is damaged.");
  }
  return fields;
}

const text = (value: number | Uint8Array) =>
  value instanceof Uint8Array ? new TextDecoder().decode(value) : "";

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function isMigrationUri(text: string): boolean {
  return /^otpauth-migration:\/\//i.test(text.trim());
}

export function parseMigration(uri: string): MigrationResult {
  const raw = uri.trim();
  const query = raw.slice(raw.indexOf("?") + 1);
  // URLSearchParams turns "+" into a space, which would corrupt base64.
  const data = /(?:^|&)data=([^&]*)/.exec(query)?.[1];
  if (!data) throw new ParseError("The transfer code has no data in it.");

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(safeDecode(data));
  } catch {
    throw new ParseError("The transfer code is damaged.");
  }

  const result: MigrationResult = { drafts: [], skipped: [], batchIndex: 0, batchSize: 1 };
  for (const top of readFields(bytes)) {
    if (top.field === 3 && typeof top.value === "number") result.batchSize = top.value || 1;
    if (top.field === 4 && typeof top.value === "number") result.batchIndex = top.value;
    if (top.field !== 1 || !(top.value instanceof Uint8Array)) continue;

    let secret: Uint8Array = new Uint8Array();
    let name = "";
    let issuer = "";
    let algorithm = 1;
    let digits = 1;
    let type = 2;
    let counter = 0;
    for (const f of readFields(top.value)) {
      if (f.field === 1 && f.value instanceof Uint8Array) secret = f.value;
      else if (f.field === 2) name = text(f.value);
      else if (f.field === 3) issuer = text(f.value);
      else if (f.field === 4 && typeof f.value === "number") algorithm = f.value;
      else if (f.field === 5 && typeof f.value === "number") digits = f.value;
      else if (f.field === 6 && typeof f.value === "number") type = f.value;
      else if (f.field === 7 && typeof f.value === "number") counter = f.value;
    }

    // Name is often "Issuer:account" here too.
    let account = name;
    const colon = name.indexOf(":");
    if (colon >= 0) {
      if (!issuer) issuer = name.slice(0, colon).trim();
      account = name.slice(colon + 1).trim();
    }
    const label = [issuer, account].filter(Boolean).join(" · ") || "Unnamed account";

    if (algorithm === 4) {
      result.skipped.push(`${label}: uses MD5, which is not supported`);
      continue;
    }
    if (secret.length < 10) {
      result.skipped.push(`${label}: secret is too short to be real`);
      continue;
    }

    result.drafts.push({
      type: type === 1 ? "hotp" : "totp",
      issuer,
      account,
      secret: base32Encode(secret),
      algorithm: algorithm === 2 ? "SHA256" : algorithm === 3 ? "SHA512" : "SHA1",
      digits: digits === 2 ? 8 : 6,
      period: 30,
      counter: type === 1 ? counter : 0,
    });
  }
  if (result.drafts.length === 0 && result.skipped.length === 0) {
    throw new ParseError("The transfer code had no accounts in it.");
  }
  return result;
}

/** Builds a migration URI. Used by the tests; also the basis for a future "export to Google Authenticator". */
export function buildMigration(drafts: EntryDraft[]): string {
  const bytes: number[] = [];
  const varint = (out: number[], n: number) => {
    let value = n;
    while (value >= 128) {
      out.push((value % 128) | 0x80);
      value = Math.floor(value / 128);
    }
    out.push(value);
  };
  const lenField = (out: number[], field: number, data: Uint8Array) => {
    varint(out, field * 8 + 2);
    varint(out, data.length);
    out.push(...data);
  };
  const intField = (out: number[], field: number, n: number) => {
    varint(out, field * 8);
    varint(out, n);
  };
  const enc = new TextEncoder();
  for (const d of drafts) {
    const inner: number[] = [];
    const secretBytes = base32Decode(d.secret);
    lenField(inner, 1, secretBytes);
    lenField(inner, 2, enc.encode(d.issuer ? `${d.issuer}:${d.account}` : d.account));
    if (d.issuer) lenField(inner, 3, enc.encode(d.issuer));
    intField(inner, 4, d.algorithm === "SHA256" ? 2 : d.algorithm === "SHA512" ? 3 : 1);
    intField(inner, 5, d.digits === 8 ? 2 : 1);
    intField(inner, 6, d.type === "hotp" ? 1 : 2);
    if (d.type === "hotp") intField(inner, 7, d.counter);
    lenField(bytes, 1, new Uint8Array(inner));
  }
  intField(bytes, 2, 1);
  intField(bytes, 3, 1);
  intField(bytes, 4, 0);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `otpauth-migration://offline?data=${encodeURIComponent(btoa(binary))}`;
}
