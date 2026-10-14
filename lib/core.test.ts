import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, isValidBase32 } from "./base32";
import { generate, groupCode, hotpFromKey, secondsLeft } from "./otp";
import { buildMigration, buildOtpauth, ParseError, parseMigration, parseOtpauth } from "./otpauth";
import {
  changePasscode,
  createBackup,
  createVault,
  openBackup,
  sealEntries,
  unlockVault,
  WrongPasscodeError,
} from "./crypto";
import { newEntry, splitDuplicates } from "./entries";
import type { Algorithm, EntryDraft } from "./types";

const ascii = (s: string) => new TextEncoder().encode(s);

describe("base32", () => {
  it("round-trips", () => {
    const bytes = ascii("12345678901234567890");
    expect(base32Encode(bytes)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).toEqual(bytes);
  });
  it("forgives case, spaces, dashes and padding", () => {
    expect(base32Decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq====")).toEqual(ascii("12345678901234567890"));
  });
  it("rejects junk and truncation", () => {
    expect(isValidBase32("JBSWY3DPEHPK3PXP")).toBe(true);
    expect(isValidBase32("JBSWY3DPEHPK3PX1")).toBe(false); // 1 is not base32
    expect(isValidBase32("JBSWY3DP")).toBe(false); // too short
    expect(() => base32Decode("JBSWY3DPE")).toThrow(); // 9 chars: impossible tail
  });
});

describe("HOTP — RFC 4226 Appendix D", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  for (const [counter, code] of expected.entries()) {
    it(`counter ${counter} → ${code}`, async () => {
      expect(await hotpFromKey(ascii("12345678901234567890"), counter, 6, "SHA1")).toBe(code);
    });
  }
});

describe("TOTP — RFC 6238 Appendix B", () => {
  const keys: Record<Algorithm, string> = {
    SHA1: "12345678901234567890",
    SHA256: "12345678901234567890123456789012",
    SHA512: "1234567890123456789012345678901234567890123456789012345678901234",
  };
  const vectors: [number, Record<Algorithm, string>][] = [
    [59, { SHA1: "94287082", SHA256: "46119246", SHA512: "90693936" }],
    [1111111109, { SHA1: "07081804", SHA256: "68084774", SHA512: "25091201" }],
    [1111111111, { SHA1: "14050471", SHA256: "67062674", SHA512: "99943326" }],
    [1234567890, { SHA1: "89005924", SHA256: "91819424", SHA512: "93441116" }],
    [2000000000, { SHA1: "69279037", SHA256: "90698825", SHA512: "38618901" }],
    [20000000000, { SHA1: "65353130", SHA256: "77737706", SHA512: "47863826" }],
  ];
  for (const [time, codes] of vectors) {
    for (const algorithm of ["SHA1", "SHA256", "SHA512"] as Algorithm[]) {
      it(`${algorithm} at t=${time}`, async () => {
        const entry = newEntry({
          type: "totp",
          issuer: "",
          account: "rfc",
          secret: base32Encode(ascii(keys[algorithm])),
          algorithm,
          digits: 8,
          period: 30,
          counter: 0,
        });
        expect(await generate(entry, time * 1000)).toBe(codes[algorithm]);
      });
    }
  }

  it("counts down", () => {
    expect(secondsLeft(0, 30)).toBe(30);
    expect(secondsLeft(29_000, 30)).toBe(1);
    expect(secondsLeft(30_000, 30)).toBe(30);
  });

  it("groups for display", () => {
    expect(groupCode("123456")).toBe("123 456");
    expect(groupCode("12345678")).toBe("1234 5678");
  });
});

describe("otpauth links", () => {
  it("reads a typical setup link", () => {
    const d = parseOtpauth("otpauth://totp/GitHub:duro%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub");
    expect(d).toMatchObject({ type: "totp", issuer: "GitHub", account: "duro@example.com", secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "SHA1" });
  });
  it("lets the issuer parameter win over the label", () => {
    expect(parseOtpauth("otpauth://totp/Old:me?secret=JBSWY3DPEHPK3PXP&issuer=New").issuer).toBe("New");
  });
  it("handles a label with no issuer and lower-case secret", () => {
    const d = parseOtpauth("otpauth://totp/me?secret=jbswy3dpehpk3pxp");
    expect(d.issuer).toBe("");
    expect(d.secret).toBe("JBSWY3DPEHPK3PXP");
  });
  it("reads HOTP with counter and SHA256/8 digits", () => {
    const d = parseOtpauth("otpauth://hotp/X:y?secret=JBSWY3DPEHPK3PXP&counter=42&digits=8&algorithm=sha256");
    expect(d).toMatchObject({ type: "hotp", counter: 42, digits: 8, algorithm: "SHA256" });
  });
  it("rejects bad input with a readable reason", () => {
    expect(() => parseOtpauth("https://evil.example")).toThrow(ParseError);
    expect(() => parseOtpauth("otpauth://totp/x?issuer=y")).toThrow(/no secret/);
    expect(() => parseOtpauth("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5")).toThrow(/algorithm/);
    expect(() => parseOtpauth("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4")).toThrow(/length/);
  });
  it("round-trips through buildOtpauth", () => {
    const d = parseOtpauth("otpauth://totp/A%20B:c%3Ad?secret=JBSWY3DPEHPK3PXP&issuer=A%20B&period=60&digits=8");
    expect(parseOtpauth(buildOtpauth(d))).toEqual(d);
  });
});

describe("Google Authenticator transfer", () => {
  const drafts: EntryDraft[] = [
    { type: "totp", issuer: "GitHub", account: "duro", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30, counter: 0 },
    { type: "hotp", issuer: "", account: "bank", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", algorithm: "SHA256", digits: 8, period: 30, counter: 7 },
  ];
  it("decodes what it encodes", () => {
    const result = parseMigration(buildMigration(drafts));
    expect(result.drafts).toEqual(drafts);
    expect(result.skipped).toEqual([]);
  });
  it("decodes a payload in Google Authenticator's exact export shape", () => {
    // Independently built payload, not one from this encoder: one TOTP account
    // "Example:alice@google.com", secret JBSWY3DPEHPK3PXP, and a NEGATIVE int64
    // batch_id -- a 10-byte varint, which is what real exports carry.
    const uri =
      "otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZSABKAEwAhABGAEgACjr4JKK%2BP%2F%2F%2F%2F8B";
    const { drafts: got } = parseMigration(uri);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ issuer: "Example", account: "alice@google.com", type: "totp", digits: 6, algorithm: "SHA1" });
    expect(got[0].secret).toBe("JBSWY3DPEHPK3PXP");
  });
  it("rejects garbage", () => {
    expect(() => parseMigration("otpauth-migration://offline?data=")).toThrow(ParseError);
    expect(() => parseMigration("otpauth-migration://offline?data=CjEKCk")).toThrow(ParseError);
  });
});

describe("vault encryption", () => {
  const entry = newEntry({ type: "totp", issuer: "GitHub", account: "duro", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30, counter: 0 });

  it("seals and reopens with the right passcode only", async () => {
    const { blob, key } = await createVault("correct horse");
    const sealed = await sealEntries(blob, key, [entry]);
    expect(JSON.stringify(sealed)).not.toContain("GitHub");
    expect(JSON.stringify(sealed)).not.toContain("JBSWY3DPEHPK3PXP");
    expect((await unlockVault(sealed, "correct horse")).entries).toEqual([entry]);
    await expect(unlockVault(sealed, "wrong horse")).rejects.toBeInstanceOf(WrongPasscodeError);
  });

  it("keeps the data key out of reach while open", async () => {
    const { key } = await createVault("correct horse");
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("uses a fresh IV on every save", async () => {
    const { blob, key } = await createVault("pw-123456");
    const a = await sealEntries(blob, key, [entry]);
    const b = await sealEntries(blob, key, [entry]);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("changes passcode without touching the data", async () => {
    const { blob, key } = await createVault("old passcode");
    const sealed = await sealEntries(blob, key, [entry]);
    const changed = await changePasscode(sealed, "old passcode", "new passcode");
    expect(changed.ct).toBe(sealed.ct);
    expect((await unlockVault(changed, "new passcode")).entries).toEqual([entry]);
    await expect(unlockVault(changed, "old passcode")).rejects.toBeInstanceOf(WrongPasscodeError);
    await expect(changePasscode(sealed, "not it", "x")).rejects.toBeInstanceOf(WrongPasscodeError);
  });
}, 60_000);

describe("backup files", () => {
  const entry = newEntry({ type: "totp", issuer: "Bank", account: "me", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30, counter: 0 });
  it("round-trips and refuses the wrong password", async () => {
    const file = await createBackup([entry], "backup pass");
    expect(file.count).toBe(1);
    expect(JSON.stringify(file)).not.toContain("Bank");
    expect(await openBackup(JSON.parse(JSON.stringify(file)), "backup pass")).toEqual([entry]);
    await expect(openBackup(file, "nope")).rejects.toBeInstanceOf(WrongPasscodeError);
  });
}, 60_000);

describe("duplicates", () => {
  it("matches on what makes the codes, not the names", () => {
    const base: EntryDraft = { type: "totp", issuer: "GitHub", account: "a", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30, counter: 0 };
    const renamed = { ...base, issuer: "github.com", account: "b" };
    const other = { ...base, secret: "GEZDGNBVGY3TQOJQ" };
    const { fresh, duplicates } = splitDuplicates([base], [renamed, other, other]);
    expect(duplicates).toHaveLength(2);
    expect(fresh).toEqual([other]);
  });
});

describe("restoring untrusted data", async () => {
  const { toDraft } = await import("./entries");
  it("keeps good records and drops bad ones", () => {
    const good = { type: "totp", issuer: "A", account: "b", secret: "jbswy3dpehpk3pxp", algorithm: "SHA1", digits: 6, period: 30, counter: 0 };
    expect(toDraft(good)?.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(toDraft({ ...good, secret: "nope!" })).toBeNull();
    expect(toDraft({ ...good, digits: 4 })).toBeNull();
    expect(toDraft({ ...good, algorithm: "MD5" })).toBeNull();
    expect(toDraft({ ...good, period: -1 })).toBeNull();
    expect(toDraft(null)).toBeNull();
    expect(toDraft("otpauth://x")).toBeNull();
  });
});

describe("biometric (PRF) wrap", async () => {
  const { addPrfWrap, removePrfWrap, prfWrapOf, unlockVaultWithPrf, BiometricMismatchError } = await import("./crypto");
  const entry = newEntry({ type: "totp", issuer: "GitHub", account: "duro", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30, counter: 0 });
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(32));

  it("opens with the device secret, alongside the passcode", async () => {
    const { blob, key } = await createVault("my passcode");
    const sealed = await sealEntries(blob, key, [entry]);
    const withPrf = await addPrfWrap(sealed, "my passcode", "Y3JlZA==", salt, secret);
    expect(withPrf.ct).toBe(sealed.ct); // data untouched
    expect(prfWrapOf(withPrf)?.credentialId).toBe("Y3JlZA==");
    const opened = await unlockVaultWithPrf(withPrf, secret);
    expect(opened.entries).toEqual([entry]);
    expect(opened.key.extractable).toBe(false);
    expect((await unlockVault(withPrf, "my passcode")).entries).toEqual([entry]);
  });

  it("refuses a different device secret and a wrong passcode at setup", async () => {
    const { blob } = await createVault("my passcode");
    const withPrf = await addPrfWrap(blob, "my passcode", "Y3JlZA==", salt, secret);
    await expect(unlockVaultWithPrf(withPrf, crypto.getRandomValues(new Uint8Array(32)))).rejects.toBeInstanceOf(BiometricMismatchError);
    await expect(addPrfWrap(blob, "not it", "Y3JlZA==", salt, secret)).rejects.toBeInstanceOf(WrongPasscodeError);
  });

  it("survives a passcode change and can be removed", async () => {
    const { blob } = await createVault("old passcode");
    const withPrf = await addPrfWrap(blob, "old passcode", "Y3JlZA==", salt, secret);
    const changed = await changePasscode(withPrf, "old passcode", "new passcode");
    await expect(unlockVaultWithPrf(changed, secret)).resolves.toBeTruthy();
    const off = removePrfWrap(changed);
    expect(prfWrapOf(off)).toBeNull();
    await expect(unlockVaultWithPrf(off, secret)).rejects.toThrow();
    await expect(unlockVault(off, "new passcode")).resolves.toBeTruthy();
  });

  it("re-enrolling replaces the old wrap rather than stacking", async () => {
    const { blob } = await createVault("my passcode");
    const once = await addPrfWrap(blob, "my passcode", "QQ==", salt, secret);
    const twice = await addPrfWrap(once, "my passcode", "Qg==", salt, secret);
    expect(twice.wraps.filter((w) => w.kind === "prf")).toHaveLength(1);
    expect(prfWrapOf(twice)?.credentialId).toBe("Qg==");
  });
}, 60_000);
