import type { ComponentChildren } from "preact";
import { TopBar } from "./TopBar.js";
import { BottomNav, type MobileTab } from "./BottomNav.js";

interface Props {
  active: MobileTab;
  platform: "ios" | "android";
  fingerprint: string | null;
  onChange: (tab: MobileTab) => void;
  children: ComponentChildren;
}

export function MobileShell({ active, platform, fingerprint, onChange, children }: Props) {
  const isIos = platform === "ios";
  return (
    <div class="relative h-full w-full overflow-hidden text-(--color-ink)">
      {/* Translucent top header overlay */}
      <div
        class={`absolute top-0 left-0 right-0 z-40 ${isIos ? "glass-ios-top" : "bg-(--color-surface) border-b border-(--color-line)"}`}
      >
        <TopBar fingerprint={fingerprint} />
      </div>

      {/* Main scrolling content area */}
      <main class="mobile-main">{children}</main>

      {/* Translucent bottom tab bar overlay */}
      <div class="absolute left-0 right-0 bottom-0 z-40">
        <BottomNav active={active} platform={platform} onChange={onChange} />
      </div>
    </div>
  );
}
