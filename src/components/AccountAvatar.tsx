/**
 * Account avatar with a graceful fallback chain:
 *
 *   1. Google's s2 favicon CDN — opt-in, gated by `faviconFallbackEnabled`
 *      (matches the extension's behaviour). When off, we never reach out
 *      to a third party.
 *   2. A tinted monogram derived deterministically from the domain.
 *
 * Each `<img onError>` advances to the monogram so a missing favicon
 * never leaves a broken image in the list. The component reads the
 * fallback flag from the global signal so toggling it in Settings
 * updates every avatar instantly.
 */
import { useEffect, useState } from "preact/hooks";

import { faviconFallbackEnabled } from "../state.js";

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
  const allowFavicon = faviconFallbackEnabled.value;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [trimmed, allowFavicon]);

  if (allowFavicon && !failed) {
    const px = Math.max(16, Math.min(128, size));
    return (
      <span
        class="grid place-items-center rounded-2xl shrink-0 overflow-hidden bg-(--color-surface-elev) border border-(--color-line)/60"
        style={{ width: `${size}px`, height: `${size}px` }}
        aria-hidden="true"
      >
        <img
          src={`https://www.google.com/s2/favicons?sz=${px * 2}&domain=${encodeURIComponent(trimmed)}`}
          alt=""
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ display: "block" }}
        />
      </span>
    );
  }

  return <Monogram domain={trimmed} size={size} />;
}

function Monogram({ domain, size }: { domain: string; size: number }) {
  const root = domain.split(".")[0] ?? "?";
  const letter = root.charAt(0).toUpperCase() || "?";
  const palette = PALETTE[hash(domain) % PALETTE.length] ?? PALETTE[0];
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
