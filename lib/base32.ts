/**
 * RFC 4648 base32, the encoding every authenticator secret is shared in.
 *
 * Decoding is forgiving about what people actually paste -- lower case,
 * spaces, dashes, missing "=" padding -- and strict about everything else,
 * because a silently mangled secret produces codes that are simply wrong.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Upper-cases and strips spaces, dashes and padding. Does not validate. */
export function normalizeBase32(input: string): string {
  return input.toUpperCase().replace(/[\s\-=]/g, "");
}

export function isValidBase32(input: string): boolean {
  const clean = normalizeBase32(input);
  // A secret shorter than 80 bits is below what RFC 4226 allows (it asks for
  // 128, recommends 160). Some services do use 80; nothing legitimate is shorter.
  return clean.length >= 16 && /^[A-Z2-7]+$/.test(clean) && validTail(clean.length);
}

// Lengths that cannot come from whole bytes (1, 3, 6 leftover chars) mean the
// secret was truncated in copying.
function validTail(length: number): boolean {
  return ![1, 3, 6].includes(length % 8);
}

export function base32Decode(input: string): Uint8Array {
  const clean = normalizeBase32(input);
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error("Secret contains characters that are not base32.");
  if (!validTail(clean.length)) throw new Error("Secret looks truncated.");
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
