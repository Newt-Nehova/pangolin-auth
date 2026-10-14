/**
 * Fingerprint / face unlock via WebAuthn's PRF extension.
 *
 * A passkey is created on this device's platform authenticator (Android
 * fingerprint, Face ID / Touch ID, Windows Hello). Asking it to evaluate PRF
 * on a stored salt returns a 32-byte secret -- but only after a successful
 * biometric or screen-lock check, and only on this device. That secret wraps
 * the vault key (see crypto.ts PrfWrap).
 *
 * Deliberately NOT done: storing the vault key anywhere and using the
 * fingerprint check as a mere gate in front of it. That would look the same
 * on screen and protect nothing. If a device cannot do PRF, biometric unlock
 * is simply unavailable there and the passcode remains.
 *
 * There is no server, so challenges are random and nothing is verified
 * remotely; the security comes entirely from the PRF secret.
 */
import { BRAND } from "./brand";
import { fromB64, toB64 } from "./crypto";

export class BiometricUnsupportedError extends Error {
  constructor() {
    super(
      "This phone or browser can't use fingerprint unlock securely. Try Chrome on Android or Safari on iPhone, with an up-to-date system."
    );
  }
}

export class BiometricCancelledError extends Error {
  constructor() {
    super("Cancelled.");
  }
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer } };
const prfOf = (cred: PublicKeyCredential): PrfResults | undefined =>
  (cred.getClientExtensionResults() as { prf?: PrfResults }).prf;

/** Is there a fingerprint/face/screen-lock authenticator at all? (PRF is only known once tried.) */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === "undefined") return false;
    const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> })
      .getClientCapabilities?.()
      .catch(() => undefined);
    // Where the browser can say for sure that PRF is missing, believe it.
    if (caps && caps["extension:prf"] === false) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function rethrow(err: unknown): never {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "AbortError") throw new BiometricCancelledError();
  throw err;
}

/** Asks the authenticator for the PRF secret of an existing passkey. Prompts for fingerprint/face. */
export async function evaluatePrf(credentialId: string, prfSalt: Uint8Array): Promise<ArrayBuffer> {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32) as BufferSource,
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: fromB64(credentialId) as BufferSource }],
        userVerification: "required",
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (err) {
    rethrow(err);
  }
  const first = prfOf(cred)?.results?.first;
  if (!first) throw new BiometricUnsupportedError();
  return first;
}

/**
 * Creates the passkey and returns its PRF secret. Some authenticators hand
 * back the secret at creation; others only report "enabled", in which case
 * one immediate sign-in fetches it (a second prompt, unavoidable there).
 */
export async function enrollBiometric(): Promise<{ credentialId: string; prfSalt: Uint8Array; prfOutput: ArrayBuffer }> {
  const prfSalt = random(32);
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: random(32) as BufferSource,
        rp: { name: BRAND.name, id: location.hostname },
        user: { id: random(16) as BufferSource, name: `${BRAND.name} vault`, displayName: `${BRAND.name} vault unlock` },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        timeout: 60_000,
        attestation: "none",
        extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (err) {
    rethrow(err);
  }
  const credentialId = toB64(cred.rawId);
  const prf = prfOf(cred);
  if (prf?.results?.first) return { credentialId, prfSalt, prfOutput: prf.results.first };
  if (!prf?.enabled) {
    forgetPasskey(credentialId);
    throw new BiometricUnsupportedError();
  }
  return { credentialId, prfSalt, prfOutput: await evaluatePrf(credentialId, prfSalt) };
}

/**
 * Tells the phone's password manager this passkey is no longer used, where the
 * browser supports it (Chrome 132+). Elsewhere the user can delete
 * "Pangolin vault" from their password manager by hand. Best effort only.
 */
export function forgetPasskey(credentialId: string): void {
  try {
    const signal = (PublicKeyCredential as unknown as {
      signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
    }).signalUnknownCredential;
    const b64url = credentialId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    signal?.({ rpId: location.hostname, credentialId: b64url }).catch(() => undefined);
  } catch {
    // Not supported; nothing to do.
  }
}
