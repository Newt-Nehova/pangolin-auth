/** The mark: three overlapping scales, the way a pangolin's armour lies. */
export function Mark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className}>
      <path d="M32 6c10 0 18 7 18 17 0 9-8 17-18 21-10-4-18-12-18-21C14 13 22 6 32 6z" fill="currentColor" opacity=".35" />
      <path d="M32 16c9 0 16 6 16 15 0 8-7 15-16 19-9-4-16-11-16-19 0-9 7-15 16-15z" fill="currentColor" opacity=".6" />
      <path d="M32 26c8 0 14 5 14 13 0 7-6 13-14 17-8-4-14-10-14-17 0-8 6-13 14-13z" fill="currentColor" />
    </svg>
  );
}
