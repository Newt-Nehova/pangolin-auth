export type Algorithm = "SHA1" | "SHA256" | "SHA512";
export type OtpType = "totp" | "hotp";

/** One account in the vault. Lives only inside the encrypted blob. */
export interface Entry {
  id: string;
  type: OtpType;
  issuer: string;
  account: string;
  /** Normalised base32, no padding. */
  secret: string;
  algorithm: Algorithm;
  digits: 6 | 7 | 8;
  /** TOTP step in seconds. */
  period: number;
  /** HOTP moving counter: the value the NEXT generated code uses. */
  counter: number;
  createdAt: string;
  updatedAt: string;
}

/** An account parsed from a QR code or link, before the user has saved it. */
export type EntryDraft = Omit<Entry, "id" | "createdAt" | "updatedAt">;
