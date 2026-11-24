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
import type { Algorithm, Entry, EntryDraft } from "./types";

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

describe("export formats", async () => {
  const { migrationBatches, otpauthList } = await import("./otpauth");
  const many: EntryDraft[] = Array.from({ length: 23 }, (_, i) => ({
    type: i === 5 ? "hotp" : "totp",
    issuer: `Service ${i}`,
    account: `user${i}@example.com`,
    secret: base32Encode(crypto.getRandomValues(new Uint8Array(20))),
    algorithm: i === 7 ? "SHA256" : "SHA1",
    digits: i === 7 ? 8 : 6,
    period: 30,
    counter: i === 5 ? 12 : 0,
  }));

  it("splits Google transfer codes 10 per QR and round-trips every account", () => {
    const uris = migrationBatches(many);
    expect(uris).toHaveLength(3);
    const parsed = uris.map(parseMigration);
    expect(parsed.map((p) => [p.batchIndex, p.batchSize])).toEqual([[0, 3], [1, 3], [2, 3]]);
    expect(parsed.flatMap((p) => p.drafts)).toEqual(many);
  });

  it("writes one otpauth link per line that parses back exactly", () => {
    const lines = otpauthList(many).trim().split("\n");
    expect(lines).toHaveLength(23);
    expect(lines.map(parseOtpauth)).toEqual(many);
  });
});

describe("monthly passcode check", async () => {
  const { passcodeCheckDue, DEFAULT_META } = await import("./db");
  const now = Date.parse("2026-10-14T12:00:00Z");
  it("is due when never typed, or after 30 days", () => {
    expect(passcodeCheckDue({ ...DEFAULT_META, lastPasscodeAt: null }, now)).toBe(true);
    expect(passcodeCheckDue({ ...DEFAULT_META, lastPasscodeAt: "2026-10-01T12:00:00Z" }, now)).toBe(false);
    expect(passcodeCheckDue({ ...DEFAULT_META, lastPasscodeAt: "2026-09-14T11:00:00Z" }, now)).toBe(true);
  });
});

describe("importing other apps' exports", async () => {
  const { parseImportFile } = await import("./importers");
  const S = "JBSWY3DPEHPK3PXP";

  it("reads a plain Aegis export and skips Steam", () => {
    const aegis = {
      version: 1,
      header: { slots: null, params: null },
      db: {
        version: 3,
        entries: [
          { type: "totp", uuid: "a", name: "duro@example.com", issuer: "GitHub", info: { secret: S, algo: "SHA1", digits: 6, period: 30 } },
          { type: "hotp", uuid: "b", name: "vpn", issuer: "Work", info: { secret: S, algo: "SHA256", digits: 8, counter: 4 } },
          { type: "steam", uuid: "c", name: "me", issuer: "Steam", info: { secret: S, algo: "SHA1", digits: 5, period: 30 } },
        ],
      },
    };
    const r = parseImportFile(JSON.stringify(aegis));
    expect(r.format).toBe("Aegis");
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts[1]).toMatchObject({ type: "hotp", algorithm: "SHA256", digits: 8, counter: 4, issuer: "Work" });
    expect(r.skipped[0]).toMatch(/Steam/);
  });

  it("refuses an encrypted Aegis export with instructions", () => {
    expect(() => parseImportFile(JSON.stringify({ version: 1, header: { slots: [{}], params: {} }, db: "c2VjcmV0" }))).toThrow(/encryption turned off/);
  });

  it("reads a plain 2FAS export", () => {
    const twofas = {
      schemaVersion: 4,
      services: [
        { name: "Google", secret: S, otp: { account: "someone@gmail.com", issuer: "Google", digits: 6, period: 30, algorithm: "SHA1", tokenType: "TOTP" } },
        { name: "Steam", secret: S, otp: { tokenType: "STEAM" } },
      ],
    };
    const r = parseImportFile(JSON.stringify(twofas));
    expect(r.format).toBe("2FAS");
    expect(r.drafts).toEqual([{ type: "totp", issuer: "Google", account: "someone@gmail.com", secret: S, algorithm: "SHA1", digits: 6, period: 30, counter: 0 }]);
    expect(r.skipped).toHaveLength(1);
  });

  it("refuses a password-protected 2FAS export", () => {
    expect(() => parseImportFile(JSON.stringify({ schemaVersion: 4, services: [], servicesEncrypted: "abc:def:ghi" }))).toThrow(/password-protected/);
  });

  it("reads Bitwarden: otpauth links, raw secrets, and ignores logins without 2FA", () => {
    const bw = {
      encrypted: false,
      items: [
        { name: "GitHub", login: { username: "duro", totp: `otpauth://totp/?secret=${S}` } },
        { name: "Dropbox", login: { username: "me@x.com", totp: S.toLowerCase() } },
        { name: "No 2FA", login: { username: "x", totp: null } },
        { name: "Note", type: 2 },
      ],
    };
    const r = parseImportFile(JSON.stringify(bw));
    expect(r.format).toBe("Bitwarden");
    expect(r.drafts.map((d) => [d.issuer, d.account, d.secret])).toEqual([
      ["GitHub", "duro", S],
      ["Dropbox", "me@x.com", S],
    ]);
  });

  it("reads a plain list of links (Ente Auth) and reports bad lines", () => {
    const text = `otpauth://totp/A:a?secret=${S}&issuer=A\r\n\r\notpauth://totp/B:b?secret=BAD!\nnot a link\notpauth://hotp/C:c?secret=${S}&counter=2\n`;
    const r = parseImportFile(text);
    expect(r.drafts.map((d) => d.issuer)).toEqual(["A", "C"]);
    expect(r.skipped).toHaveLength(1);
  });

  it("sends Pangolin backups to Restore, and rejects junk", () => {
    expect(() => parseImportFile(JSON.stringify({ format: "pangolin-backup", v: 1 }))).toThrow(/Restore/);
    expect(() => parseImportFile("hello")).toThrow(ParseError);
    expect(() => parseImportFile("{bad json")).toThrow(/damaged/);
    expect(() => parseImportFile(JSON.stringify({ something: 1 }))).toThrow(/format/);
  });

  it("never lets a malformed secret through", () => {
    const aegis = { header: {}, db: { entries: [{ type: "totp", issuer: "X", name: "x", info: { secret: "not base32!!", digits: 6, period: 30 } }] } };
    const r = parseImportFile(JSON.stringify(aegis));
    expect(r.drafts).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
  });
});

describe("clock check", async () => {
  const { skewSeconds, describeSkew } = await import("./clock");
  it("measures and describes skew", () => {
    expect(skewSeconds(100_000, 40_000)).toBe(60);
    expect(skewSeconds(40_000, 100_000)).toBe(-60);
    expect(describeSkew(45)).toBe("This phone's clock is 45 seconds fast");
    expect(describeSkew(-300)).toBe("This phone's clock is 5 minutes slow");
  });
});

describe("logos", async () => {
  const { logoFor, inkOn } = await import("./logos");
  it("matches common spellings, and only falls back to the email domain when there's no service name", () => {
    expect(logoFor("GitHub")?.title).toBe("GitHub");
    expect(logoFor("github.com")?.title).toBe("GitHub");
    expect(logoFor("Google Workspace")?.title).toBe("Google");
    expect(logoFor("Twitter")?.title).toBe("X");
    expect(logoFor("", "someone@gmail.com")?.title).toBe("Google");
    expect(logoFor("Standard Bank", "someone@gmail.com")).toBeNull();
    expect(logoFor("Microsoft")).toBeNull(); // not in Simple Icons: letter badge
  });
  it("picks readable ink for the brand colour", () => {
    expect(inkOn("181717")).toBe("#ffffff"); // GitHub near-black
    expect(inkOn("FFFC00")).toBe("#000000"); // Snapchat yellow
  });
});

describe("pins and groups", async () => {
  const { displayOrder, groupsOf, matchesQuery, toDraft } = await import("./entries");
  const mk = (issuer: string, extra: Partial<Entry> = {}): Entry => ({
    ...newEntry({ type: "totp", issuer, account: "a", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30, counter: 0 }),
    ...extra,
  });
  it("puts pinned first and otherwise keeps the user's order", () => {
    const list = [mk("A"), mk("B", { pinned: true }), mk("C"), mk("D", { pinned: true })];
    expect(displayOrder(list).map((e) => e.issuer)).toEqual(["B", "D", "A", "C"]);
  });
  it("lists groups once each, A–Z, ignoring case and blanks", () => {
    expect(groupsOf([mk("A", { group: "Work" }), mk("B", { group: "work" }), mk("C", { group: "Banking" }), mk("D", { group: "  " })])).toEqual(["Banking", "Work"]);
  });
  it("finds accounts by group name too", () => {
    expect(matchesQuery(mk("GitHub", { group: "Work" }), "work")).toBe(true);
  });
  it("carries pin and group through backups, and drops junk values", () => {
    expect(toDraft(mk("A", { pinned: true, group: "Work" }))).toMatchObject({ pinned: true, group: "Work" });
    const junk = toDraft({ ...mk("A"), pinned: "yes", group: 42 }) as Record<string, unknown>;
    expect("pinned" in junk || "group" in junk).toBe(false);
  });
});
