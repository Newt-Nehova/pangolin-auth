/**
 * Reading other authenticators' export files, so moving INTO Pangolin is as
 * painless as moving out.
 *
 *  - Aegis: plain (unencrypted) JSON export
 *  - 2FAS: plain .2fas export
 *  - Bitwarden: JSON export (logins with a TOTP field)
 *  - Ente Auth, and any app's "plain text": one otpauth:// link per line
 *  - Google Authenticator transfer links pasted into a text file
 *
 * Encrypted Aegis/2FAS exports are recognised and refused with instructions:
 * Aegis uses scrypt, which Web Crypto lacks, and guessing at a format we can't
 * test against real files is how secrets get silently corrupted.
 *
 * Every record goes through toDraft(), the same validator backups use. A
 * file is data from elsewhere, never trusted.
 */
import { toDraft } from "./entries";
import { isMigrationUri, parseMigration, parseOtpauth, ParseError } from "./otpauth";
import type { EntryDraft } from "./types";

export interface ImportResult {
  format: string;
  drafts: EntryDraft[];
  skipped: string[];
}

const label = (issuer: unknown, account: unknown) =>
  [issuer, account].filter((x) => typeof x === "string" && x.trim()).join(" · ") || "Unnamed account";

function keep(result: ImportResult, raw: unknown, name: string) {
  const draft = toDraft(raw);
  if (draft) result.drafts.push(draft);
  else result.skipped.push(`${name}: unreadable or unsupported settings`);
}

export function parseImportFile(text: string): ImportResult {
  const trimmed = text.trim().replace(/^﻿/, "");
  if (!trimmed) throw new ParseError("That file is empty.");

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new ParseError("That file looks like JSON but is damaged.");
    }
    return parseJson(json);
  }
  return parseLinks(trimmed);
}

function parseLinks(text: string): ImportResult {
  const result: ImportResult = { format: "Setup links", drafts: [], skipped: [] };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let any = false;
  for (const line of lines) {
    if (isMigrationUri(line)) {
      any = true;
      const m = parseMigration(line);
      result.drafts.push(...m.drafts);
      result.skipped.push(...m.skipped);
      result.format = "Google Authenticator transfer";
    } else if (/^otpauth:\/\//i.test(line)) {
      any = true;
      try {
        result.drafts.push(parseOtpauth(line));
      } catch (err) {
        result.skipped.push(`${line.slice(0, 40)}…: ${err instanceof Error ? err.message : "unreadable"}`);
      }
    }
  }
  if (!any) throw new ParseError("No authenticator accounts found in that file.");
  return result;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function parseJson(json: unknown): ImportResult {
  if (isObj(json)) {
    if (json.format === "pangolin-backup") {
      throw new ParseError("That's a Pangolin backup. Restore it from Settings → Restore from backup.");
    }
    // Aegis: { version, header: { slots, params }, db: {...} | "<base64 when encrypted>" }
    if ("db" in json && "header" in json) {
      if (typeof json.db === "string") {
        throw new ParseError("That Aegis export is encrypted. In Aegis, export again with encryption turned off, import it here, then delete the file.");
      }
      return parseAegis(json.db);
    }
    // 2FAS: { services: [...], schemaVersion, servicesEncrypted? }
    if ("services" in json || "servicesEncrypted" in json) {
      if (typeof json.servicesEncrypted === "string" && !(Array.isArray(json.services) && json.services.length)) {
        throw new ParseError("That 2FAS export is password-protected. In 2FAS, export again without a password, import it here, then delete the file.");
      }
      return parse2fas(json.services);
    }
    // Bitwarden: { encrypted: false, items: [...] }
    if ("items" in json) {
      if (json.encrypted === true) {
        throw new ParseError("That Bitwarden export is encrypted. Export it again as unencrypted JSON, import it here, then delete the file.");
      }
      return parseBitwarden(json.items);
    }
  }
  throw new ParseError("That file isn't a format Pangolin can read. Supported: Aegis, 2FAS, Bitwarden, or a list of otpauth:// links.");
}

function parseAegis(db: unknown): ImportResult {
  const result: ImportResult = { format: "Aegis", drafts: [], skipped: [] };
  const entries = isObj(db) && Array.isArray(db.entries) ? db.entries : [];
  for (const e of entries) {
    if (!isObj(e)) continue;
    const name = label(e.issuer, e.name);
    const info = isObj(e.info) ? e.info : {};
    if (e.type !== "totp" && e.type !== "hotp") {
      result.skipped.push(`${name}: ${String(e.type).toUpperCase()} codes aren't supported`);
      continue;
    }
    keep(
      result,
      {
        type: e.type,
        issuer: e.issuer,
        account: e.name,
        secret: info.secret,
        algorithm: typeof info.algo === "string" ? info.algo.toUpperCase() : "SHA1",
        digits: info.digits ?? 6,
        period: info.period ?? 30,
        counter: info.counter ?? 0,
      },
      name
    );
  }
  return result;
}

function parse2fas(services: unknown): ImportResult {
  const result: ImportResult = { format: "2FAS", drafts: [], skipped: [] };
  for (const s of Array.isArray(services) ? services : []) {
    if (!isObj(s)) continue;
    const otp = isObj(s.otp) ? s.otp : {};
    const issuer = otp.issuer || s.name;
    const name = label(issuer, otp.account);
    const tokenType = String(otp.tokenType ?? "TOTP").toUpperCase();
    if (tokenType !== "TOTP" && tokenType !== "HOTP") {
      result.skipped.push(`${name}: ${tokenType} codes aren't supported`);
      continue;
    }
    keep(
      result,
      {
        type: tokenType.toLowerCase(),
        issuer,
        account: otp.account ?? otp.label ?? "",
        secret: s.secret,
        algorithm: typeof otp.algorithm === "string" ? otp.algorithm.toUpperCase() : "SHA1",
        digits: otp.digits ?? 6,
        period: otp.period ?? 30,
        counter: otp.counter ?? 0,
      },
      name
    );
  }
  return result;
}

function parseBitwarden(items: unknown): ImportResult {
  const result: ImportResult = { format: "Bitwarden", drafts: [], skipped: [] };
  for (const item of Array.isArray(items) ? items : []) {
    if (!isObj(item) || !isObj(item.login)) continue;
    const totp = item.login.totp;
    if (typeof totp !== "string" || !totp.trim()) continue; // a login without 2FA
    const name = label(item.name, item.login.username);
    if (/^otpauth:\/\//i.test(totp.trim())) {
      try {
        const draft = parseOtpauth(totp);
        // Bitwarden links often lack names; fall back to the login's.
        result.drafts.push({
          ...draft,
          issuer: draft.issuer || String(item.name ?? ""),
          account: draft.account || String(item.login.username ?? ""),
        });
      } catch {
        result.skipped.push(`${name}: unreadable setup link`);
      }
    } else if (/^steam:\/\//i.test(totp.trim())) {
      result.skipped.push(`${name}: Steam codes aren't supported`);
    } else {
      keep(result, { type: "totp", issuer: item.name, account: item.login.username ?? "", secret: totp, algorithm: "SHA1", digits: 6, period: 30 }, name);
    }
  }
  return result;
}
