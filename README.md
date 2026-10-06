# Pangolin

A two-factor authenticator (TOTP/HOTP) that runs as an offline web app. Accounts are encrypted
and stored only on the device: no account, no server, no cloud sync.

Live: https://pangolin-auth.vercel.app

## Features

- 6–8 digit codes with a countdown ring; tap to copy; the next code shows in the last 8 seconds
- Add accounts by camera QR scan, QR screenshot, pasted `otpauth://` link, or typed key
- Imports Google Authenticator "Transfer accounts" QR codes; skips duplicates
- Passcode lock, auto-lock after time in the background, back-off on repeated wrong guesses
- Encrypted backup file + restore; a banner warns when accounts are not backed up
- Installable PWA, works fully offline

## Security design

- A random AES-GCM-256 data key encrypts the whole account list, names included.
- That key is stored only wrapped by a passcode-derived key (PBKDF2-SHA256, 600,000 rounds).
  While unlocked it is held as a non-extractable `CryptoKey`. The `wraps[]` layout leaves room for
  further unlock methods (e.g. WebAuthn PRF) without re-encrypting data.
- Backups are self-contained: a separate password-derived key, same cipher.
- Restored records are re-validated, never trusted.
- Production CSP limits `connect-src` to `'self'`, so injected script would have nowhere to send
  secrets. HSTS, `X-Frame-Options: DENY`, `no-referrer`.
- **There is no passcode reset.** Forgetting it means restoring from a backup.

Web Crypto only, no crypto libraries. The one runtime dependency beyond Next/React is `jsqr`,
the QR fallback for browsers without `BarcodeDetector` (iPhone Safari).

## Layout

| Path | What |
|---|---|
| `lib/otp.ts` | HOTP/TOTP (RFC 4226 / 6238) |
| `lib/base32.ts` | RFC 4648 base32 |
| `lib/otpauth.ts` | `otpauth://` links and the Google migration protobuf |
| `lib/crypto.ts` | Vault and backup encryption |
| `lib/vault.tsx` | Vault state, serialized saves, auto-lock |
| `lib/db.ts` | IndexedDB (`vault` blob + non-secret `meta`) |
| `app/sw.js/route.ts` | Service worker, stamped per deploy |
| `app/page.tsx` | The one page; screens live in the URL `#hash` |

The app is a single static route on purpose: the unlocked key lives only in page memory, so a
real navigation would lock the vault.

## Commands

```bash
npm run dev      # http://localhost:3000 (use -p 3700 to match the launch config)
npm test         # vitest: RFC vectors, crypto, parsing
npm run build    # production build
npx vercel deploy --prod --yes
```

The service worker and CSP apply to production builds only. To test offline, run `npm run build`
followed by `npm start`.
