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
  return (
    <div class="relative h-screen w-screen flex flex-col bg-(--color-surface) text-(--color-ink)">
      <TopBar fingerprint={fingerprint} />
      <main class="flex-1 min-h-0 overflow-y-auto px-4 pb-24">{children}</main>
      <div class="absolute left-0 right-0 bottom-0">
        <BottomNav active={active} platform={platform} onChange={onChange} />
      </div>
    </div>
  );
}
