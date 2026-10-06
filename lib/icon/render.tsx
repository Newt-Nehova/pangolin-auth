/**
 * App icons, drawn from the same three-scale mark as the UI and rendered to
 * PNG at build time. `maskable` keeps the mark inside the safe zone Android
 * crops icons to.
 */
import { ImageResponse } from "next/og";

export function renderIcon(size: number, maskable = false) {
  const mark = Math.round(size * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0e1110",
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 64 64">
          <path d="M32 6c10 0 18 7 18 17 0 9-8 17-18 21-10-4-18-12-18-21C14 13 22 6 32 6z" fill="#d4924f" fillOpacity={0.35} />
          <path d="M32 16c9 0 16 6 16 15 0 8-7 15-16 19-9-4-16-11-16-19 0-9 7-15 16-15z" fill="#d4924f" fillOpacity={0.6} />
          <path d="M32 26c8 0 14 5 14 13 0 7-6 13-14 17-8-4-14-10-14-17 0-8 6-13 14-13z" fill="#d4924f" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
