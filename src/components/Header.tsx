import type { ComponentChildren } from "preact";
import { Logo } from "../Logo.js";

interface HeaderProps {
  subtitle?: string | undefined;
  fingerprint?: string | null | undefined;
  actions?: ComponentChildren;
}

export function Header({ subtitle, fingerprint, actions }: HeaderProps) {
  return (
    <header class="flex items-start justify-between gap-3 px-1">
      <div class="flex items-center gap-3 min-w-0">
        <Logo class="shrink-0 w-7 h-7" />
        <div class="flex flex-col min-w-0">
          <span class="font-mono text-[11px] uppercase tracking-[0.22em] text-(--color-ink-subtle)">
            Keyfount
          </span>
          {subtitle ? (
            <span class="text-sm text-(--color-ink) truncate" title={subtitle}>
              {subtitle}
            </span>
          ) : null}
          {fingerprint ? (
            <span class="fingerprint-sm text-(--color-ink-muted) mt-0.5">{fingerprint}</span>
          ) : null}
        </div>
      </div>
      {actions ? <div class="flex items-center gap-1 shrink-0">{actions}</div> : null}
    </header>
  );
}
