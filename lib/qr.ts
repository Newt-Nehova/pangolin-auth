/**
 * QR reading, on the device.
 *
 * Uses the browser's own BarcodeDetector where it exists (Chrome on Android:
 * fast, native) and falls back to jsQR everywhere else (iPhone Safari has no
 * BarcodeDetector). jsQR is loaded only when first needed.
 */

type Detector = { detect(source: CanvasImageSource | ImageData): Promise<{ rawValue: string }[]> };

let native: Detector | null | undefined;

async function nativeDetector(): Promise<Detector | null> {
  if (native !== undefined) return native;
  native = null;
  const Ctor = (globalThis as unknown as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (Ctor) {
    try {
      if ((await Ctor.getSupportedFormats()).includes("qr_code")) native = new Ctor({ formats: ["qr_code"] });
    } catch {
      native = null;
    }
  }
  return native;
}

/**
 * Fetch the fallback reader in the background once the vault is open. It is
 * not in the page's HTML, so the offline worker only caches it after a first
 * use -- and that first use may well be with no signal.
 */
export function warmQrReader(): void {
  window.setTimeout(() => void import("jsqr").catch(() => undefined), 3000);
}

export async function decodeImageData(image: ImageData): Promise<string | null> {
  const detector = await nativeDetector();
  if (detector) {
    try {
      const found = await detector.detect(image);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch {
      // fall through to jsQR
    }
  }
  const { default: jsQR } = await import("jsqr");
  return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** Draws a frame or picture into a canvas, capped in size so decoding stays quick. */
export function toImageData(source: CanvasImageSource, width: number, height: number, max = 1024): ImageData {
  const scale = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** A screenshot or photo of a QR code. Tries full size first, then smaller -- tiny QRs in big screenshots need the detail. */
export async function decodeFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const max of [2048, 1024, 640]) {
      const found = await decodeImageData(toImageData(bitmap, bitmap.width, bitmap.height, max));
      if (found) return found;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
