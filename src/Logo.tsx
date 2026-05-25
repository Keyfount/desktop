/**
 * Inline SVG brand mark.
 *
 * Uses currentColor so it picks up whatever colour the surrounding text /
 * surface is using. Pair it with a coloured wrapper (`text-(--color-…)`)
 * to recolour without modifying the SVG.
 */
import type { JSX } from "preact";

type Props = JSX.SVGAttributes<SVGSVGElement> & { size?: number };

export function Logo({ size = 18, ...props }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="m70 10.9h-60.2c-4.4 0.1-8.1 4-8 8.7v60.8c0 4.5 3.4 8.7 8.3 8.7h59.9c4.3 0 8.7-3.4 8.7-8.7v-60.8c-0.1-4.2-3.7-8.6-8.7-8.7zm3.9 70.6c-0.5 1.4-1.9 2.7-3.9 2.7h-60.1c-1.9-0.1-3.3-1.4-3.8-3.5v-61.1c0.1-1.9 1.8-3.8 3.9-3.9h60c2.2 0 3.9 1.9 4 3.8v60.9l-0.1 1.1z" />
      <path d="m91.6 42.7c-3.7-0.3-7.5 2.4-7.5 7.1-0.1 3.6 2.5 7.5 7.3 7.6 3.5 0 7-2.8 7-7.4 0.1-3.6-2.9-6.9-6.8-7.3z" />
      <rect x="19.1" y="33.2" width="3.4" height="33" />
    </svg>
  );
}
