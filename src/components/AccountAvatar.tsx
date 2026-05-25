/**
 * Tinted monogram avatar derived deterministically from the domain.
 *
 * We do not fetch favicons (they leak the user's account list to a third
 * party); instead we hash the domain into one of a small palette of
 * accent tints and render the first letter of the registrable name. The
 * palette is curated to look natural on both light and dark surfaces.
 */
interface Props {
  domain: string;
  size?: number;
}

const PALETTE = [
  ["oklch(0.92 0.05 240)", "oklch(0.4 0.12 240)"],
  ["oklch(0.92 0.06 160)", "oklch(0.4 0.12 160)"],
  ["oklch(0.94 0.06 60)", "oklch(0.45 0.14 60)"],
  ["oklch(0.93 0.05 320)", "oklch(0.42 0.13 320)"],
  ["oklch(0.93 0.06 20)", "oklch(0.45 0.16 20)"],
  ["oklch(0.93 0.06 200)", "oklch(0.42 0.12 200)"],
  ["oklch(0.93 0.07 290)", "oklch(0.42 0.15 290)"],
  ["oklch(0.94 0.05 100)", "oklch(0.42 0.12 100)"],
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function AccountAvatar({ domain, size = 36 }: Props) {
  const trimmed = domain.replace(/^www\./, "");
  const root = trimmed.split(".")[0] ?? "?";
  const letter = root.charAt(0).toUpperCase() || "?";
  const palette = PALETTE[hash(trimmed) % PALETTE.length] ?? PALETTE[0];
  const [bg, fg] = palette!;
  return (
    <span
      class="grid place-items-center rounded-2xl shrink-0 select-none font-medium"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background: bg,
        color: fg,
        fontSize: `${Math.round(size * 0.42)}px`,
      }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
