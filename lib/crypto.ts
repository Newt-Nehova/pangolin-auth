/**
 * The vault's encryption. Web Crypto only; no library.
 *
 * Layout: a random 256-bit data key encrypts the account list (AES-GCM).
 * The data key is stored only in *wrapped* form -- encrypted by a key derived
 * from the passcode (PBKDF2-SHA256). Two layers rather than one so that:
 *   - changing the passcode re-wraps 32 bytes instead of re-encrypting data;
 *   - a second unlock method (fingerprint via WebAuthn PRF) can be added later
 *     as just another wrap of the same data key.
 *
 * While unlocked the data key is held as a NON-extractable CryptoKey: page
 * script can use it but cannot read its bytes out. It is never written
 * anywhere in unwrapped form.
 *
 * Backups use one password-derived key directly, with no wrap, so a backup
 * file is self-contained and portable.
 */
import type { Entry } from "./types";

/** OWASP's 2023 figure for PBKDF2-HMAC-SHA256. Stored per blob so it can be raised later. */
export const PBKDF2_ITERATIONS = 600_000;

export interface PasscodeWrap {
  kind: "passcode";
  salt: string;
  iterations: number;
  iv: string;
  wrapped: string;
}

/**
 * The data key wrapped by a secret only this device's authenticator can
 * produce, and only after a fingerprint/face/screen-lock check (WebAuthn PRF).
 * Copying the stored blob is useless without the phone's secure hardware.
 */
export interface PrfWrap {
  kind: "prf";
  /** base64 credential id, to ask the authenticator for the right passkey. */
  credentialId: string;
  /** The PRF input. Random per wrap; not secret. */
  prfSalt: string;
  iv: string;
  wrapped: string;
  createdAt: string;
}

export type Wrap = PasscodeWrap | PrfWrap;

export interface VaultBlob {
  format: "pangolin-vault";
  v: 1;
  wraps: Wrap[];
  iv: string;
  ct: string;
}

export interface BackupFile {
  format: "pangolin-backup";
  v: 1;
  created: string;
  count: number;
  salt: string;
  iterations: number;
  iv: string;
  ct: string;
}

export class WrongPasscodeError extends Error {
  constructor() {
    super("That passcode is not right.");
  }
}

// -- encoding ---------------------------------------------------------------

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromB64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// -- primitives -------------------------------------------------------------

async function deriveKey(passcode: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode.normalize("NFC")) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

async function encryptJson(key: CryptoKey, value: unknown): Promise<{ iv: string; ct: string }> {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(value)) as BufferSource
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function decryptJson<T>(key: CryptoKey, iv: string, ct: string): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) as BufferSource },
    key,
    fromB64(ct) as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

async function wrapWithPasscode(dataKey: CryptoKey, passcode: string): Promise<PasscodeWrap> {
  const salt = random(16);
  const iv = random(12);
  const kek = await deriveKey(passcode, salt, PBKDF2_ITERATIONS);
  const wrapped = await crypto.subtle.wrapKey("raw", dataKey, kek, { name: "AES-GCM", iv: iv as BufferSource });
  return { kind: "passcode", salt: toB64(salt), iterations: PBKDF2_ITERATIONS, iv: toB64(iv), wrapped: toB64(wrapped) };
}

async function unwrapWithPasscode(wrap: PasscodeWrap, passcode: string, extractable: boolean): Promise<CryptoKey> {
  const kek = await deriveKey(passcode, fromB64(wrap.salt), wrap.iterations);
  try {
    return await crypto.subtle.unwrapKey(
      "raw",
      fromB64(wrap.wrapped) as BufferSource,
      kek,
      { name: "AES-GCM", iv: fromB64(wrap.iv) as BufferSource },
      { name: "AES-GCM", length: 256 },
      extractable,
      ["encrypt", "decrypt"]
    );
  } catch {
    // AES-GCM authentication failing is the only signal of a wrong passcode,
    // and it is a reliable one.
    throw new WrongPasscodeError();
  }
}

// -- vault ------------------------------------------------------------------

/** First run: a fresh data key, wrapped by the new passcode, sealing an empty list. */
export async function createVault(passcode: string): Promise<{ blob: VaultBlob; key: CryptoKey }> {
  const extractable = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrap = await wrapWithPasscode(extractable, passcode);
  // Re-import as non-extractable for use while the vault is open.
  const key = await unwrapWithPasscode(wrap, passcode, false);
  const sealed = await encryptJson(key, [] as Entry[]);
  return { blob: { format: "pangolin-vault", v: 1, wraps: [wrap], ...sealed }, key };
}

export async function unlockVault(blob: VaultBlob, passcode: string): Promise<{ key: CryptoKey; entries: Entry[] }> {
  const wrap = passcodeWrap(blob);
  const key = await unwrapWithPasscode(wrap, passcode, false);
  const entries = await decryptJson<Entry[]>(key, blob.iv, blob.ct);
  return { key, entries };
}

/** Re-encrypts the account list with a fresh IV, keeping the existing wraps. */
export async function sealEntries(blob: VaultBlob, key: CryptoKey, entries: Entry[]): Promise<VaultBlob> {
  return { ...blob, ...(await encryptJson(key, entries)) };
}

/** Swaps the passcode wrap. Needs the current passcode: the open key is deliberately not extractable. */
export async function changePasscode(blob: VaultBlob, current: string, next: string): Promise<VaultBlob> {
  const extractable = await unwrapWithPasscode(passcodeWrap(blob), current, true);
  const fresh = await wrapWithPasscode(extractable, next);
  return { ...blob, wraps: [...blob.wraps.filter((w) => w.kind !== "passcode"), fresh] };
}

function passcodeWrap(blob: VaultBlob): PasscodeWrap {
  const wrap = blob.wraps.find((w): w is PasscodeWrap => w.kind === "passcode");
  if (!wrap) throw new Error("This vault has no passcode wrap.");
  return wrap;
}

// -- biometric (WebAuthn PRF) -------------------------------------------------

/** Turns the authenticator's 32-byte PRF output into a wrapping key. */
async function prfKek(prfOutput: BufferSource): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32) as BufferSource, info: new TextEncoder().encode("pangolin vault prf v1") as BufferSource },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

export function prfWrapOf(blob: VaultBlob): PrfWrap | null {
  return blob.wraps.find((w): w is PrfWrap => w.kind === "prf") ?? null;
}

/**
 * Adds (or replaces) the biometric wrap. Needs the passcode, because the open
 * data key is deliberately non-extractable and cannot be re-wrapped by itself.
 */
export async function addPrfWrap(
  blob: VaultBlob,
  passcode: string,
  credentialId: string,
  prfSalt: Uint8Array,
  prfOutput: BufferSource
): Promise<VaultBlob> {
  const extractable = await unwrapWithPasscode(passcodeWrap(blob), passcode, true);
  const iv = random(12);
  const wrapped = await crypto.subtle.wrapKey("raw", extractable, await prfKek(prfOutput), { name: "AES-GCM", iv: iv as BufferSource });
  const wrap: PrfWrap = {
    kind: "prf",
    credentialId,
    prfSalt: toB64(prfSalt),
    iv: toB64(iv),
    wrapped: toB64(wrapped),
    createdAt: new Date().toISOString(),
  };
  return { ...blob, wraps: [...blob.wraps.filter((w) => w.kind !== "prf"), wrap] };
}

export function removePrfWrap(blob: VaultBlob): VaultBlob {
  return { ...blob, wraps: blob.wraps.filter((w) => w.kind !== "prf") };
}

export class BiometricMismatchError extends Error {
  constructor() {
    super("That fingerprint or passkey doesn't open this vault.");
  }
}

export async function unlockVaultWithPrf(blob: VaultBlob, prfOutput: BufferSource): Promise<{ key: CryptoKey; entries: Entry[] }> {
  const wrap = prfWrapOf(blob);
  if (!wrap) throw new Error("Biometric unlock is not set up.");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.unwrapKey(
      "raw",
      fromB64(wrap.wrapped) as BufferSource,
      await prfKek(prfOutput),
      { name: "AES-GCM", iv: fromB64(wrap.iv) as BufferSource },
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } catch {
    throw new BiometricMismatchError();
  }
  const entries = await decryptJson<Entry[]>(key, blob.iv, blob.ct);
  return { key, entries };
}

export function isVaultBlob(value: unknown): value is VaultBlob {
  const v = value as VaultBlob;
  return !!v && v.format === "pangolin-vault" && v.v === 1 && Array.isArray(v.wraps);
}

// -- backup -----------------------------------------------------------------

export async function createBackup(entries: Entry[], password: string): Promise<BackupFile> {
  const salt = random(16);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const sealed = await encryptJson(key, entries);
  return {
    format: "pangolin-backup",
    v: 1,
    created: new Date().toISOString(),
    count: entries.length,
    salt: toB64(salt),
    iterations: PBKDF2_ITERATIONS,
    ...sealed,
  };
}

export function isBackupFile(value: unknown): value is BackupFile {
  const v = value as BackupFile;
  return !!v && v.format === "pangolin-backup" && v.v === 1 && typeof v.ct === "string";
}

export async function openBackup(file: BackupFile, password: string): Promise<Entry[]> {
  const key = await deriveKey(password, fromB64(file.salt), file.iterations);
  try {
    return await decryptJson<Entry[]>(key, file.iv, file.ct);
  } catch {
    throw new WrongPasscodeError();
  }
}

// -- passcode guidance ------------------------------------------------------

/**
 * Honest strength feedback. The threat that matters is someone copying the
 * phone's storage and guessing offline, where no lockout applies -- only the
 * passcode's size and PBKDF2's cost stand in the way.
 */
export function passcodeAdvice(passcode: string): { ok: boolean; level: "weak" | "fair" | "strong"; note: string } {
  if (passcode.length < 6) return { ok: false, level: "weak", note: "Use at least 6 characters." };
  const digitsOnly = /^\d+$/.test(passcode);
  if (digitsOnly && passcode.length < 10) {
    return {
      ok: true,
      level: "weak",
      note: "A short number can be guessed in hours if someone copies this phone's storage. A few words is far stronger.",
    };
  }
  if (passcode.length < 12) {
    return { ok: true, level: "fair", note: "Fair. Longer is stronger — three or four words works well." };
  }
  return { ok: true, level: "strong", note: "Strong." };
}
