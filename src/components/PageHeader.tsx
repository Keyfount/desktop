import type { ComponentChildren } from "preact";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ComponentChildren;
}

/**
 * Standardised page header used inside the app shell. The title sits
 * under the macOS drag region; actions align to the right.
 */
export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <header class="flex items-end justify-between gap-4 pt-12 px-8 pb-6 border-b border-(--color-line)/60">
      <div class="flex flex-col gap-1 min-w-0">
        <span class="mono-tag">{subtitle ?? "Keyfount"}</span>
        <h1 class="text-2xl font-medium text-(--color-ink) tracking-[-0.02em] leading-none">
          {title}
        </h1>
      </div>
      {actions ? <div class="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </header>
  );
}
