"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/**
 * A QR code drawn on the device, as an <img> (no injected markup).
 * Always dark-on-white with a quiet zone, whatever the theme: scanners need
 * the contrast and the margin.
 */
export function QrImage({ value, label, size = 260 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 3, width: size * 2, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => live && (setSrc(url), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [value, size]);

  if (failed) {
    return <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">Couldn&apos;t draw this code.</p>;
  }
  return (
    <div className="mx-auto overflow-hidden rounded-2xl bg-white p-1 shadow-sm" style={{ width: size, height: size }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn on the device; nothing for next/image to optimise
        <img src={src} alt={label} width={size} height={size} className="h-full w-full" style={{ imageRendering: "pixelated" }} />
      )}
    </div>
  );
}
