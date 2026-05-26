import type { ComponentChild } from "preact";
import { motion } from "framer-motion";
import { t } from "../i18n.js";
import { IconKey, IconSettings, IconUnlock } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";

export type MobileTab = "accounts" | "generator" | "settings";

interface Props {
  active: MobileTab;
  platform: "ios" | "android";
  onChange: (tab: MobileTab) => void;
}

const TABS: Array<{
  id: MobileTab;
  labelKey: "sidebar_accounts" | "sidebar_generator" | "sidebar_settings";
  icon: (size: number) => ComponentChild;
}> = [
  { id: "accounts", labelKey: "sidebar_accounts", icon: (s) => <IconUnlock size={s} /> },
  { id: "generator", labelKey: "sidebar_generator", icon: (s) => <IconKey size={s} /> },
  { id: "settings", labelKey: "sidebar_settings", icon: (s) => <IconSettings size={s} /> },
];

export function BottomNav({ active, platform, onChange }: Props) {
  const surfaceClass = platform === "ios" ? "glass-ios" : "surface-android";
  return (
    <nav class={`safe-bottom px-3 pt-2 flex items-stretch justify-around ${surfaceClass}`}>
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <motion.button
            key={tab.id}
            type="button"
            whileTap={TAP_SCALE}
            onClick={() => onChange(tab.id)}
            class={
              "relative flex-1 flex flex-col items-center gap-1 py-2 rounded-xl bg-transparent border-0 cursor-pointer " +
              (isActive ? "text-(--color-ink)" : "text-(--color-ink-muted)")
            }
            aria-current={isActive ? "page" : undefined}
            aria-label={t(tab.labelKey)}
          >
            {isActive ? (
              <motion.span
                layoutId="mobile-bottomnav-active"
                transition={SOFT_SPRING}
                class="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-(--color-accent-500)"
              />
            ) : null}
            {tab.icon(20)}
            <span class="text-[11px] font-medium tracking-tight">{t(tab.labelKey)}</span>
          </motion.button>
        );
      })}
    </nav>
  );
}
