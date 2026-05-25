import { useCallback } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { motion } from "framer-motion";

import { api } from "../api.js";
import { Logo } from "../Logo.js";
import { IconKey, IconLock, IconRefresh, IconSettings, IconShield, IconUnlock } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { fingerprint, generated, screen, view as currentView, type ShellView } from "../state.js";

interface NavItem {
  id: ShellView;
  label: string;
  icon: ComponentChildren;
}

const NAV: NavItem[] = [
  { id: "generator", label: "Generator", icon: <IconKey size={16} /> },
  { id: "accounts", label: "Accounts", icon: <IconUnlock size={16} /> },
  { id: "sync", label: "Sync", icon: <IconRefresh size={16} /> },
  { id: "vaults", label: "Vaults", icon: <IconShield size={16} /> },
  { id: "settings", label: "Settings", icon: <IconSettings size={16} /> },
];

export function Sidebar() {
  const onLock = useCallback(async () => {
    await api.lock();
    generated.value = null;
    screen.value = "unlock";
  }, []);

  return (
    <aside
      class="relative h-full flex flex-col border-r border-(--color-line) bg-(--color-surface-sunken)/80"
      data-tauri-drag-region
    >
      <div class="px-4 pt-10 pb-4 flex items-center gap-3" data-tauri-drag-region>
        <Logo class="w-7 h-7 shrink-0" />
        <div class="flex flex-col leading-tight">
          <span class="text-(--color-ink) font-medium tracking-[-0.01em] text-[15px]">
            Keyfount
          </span>
          <span class="mono-tag !text-[9px]">Deterministic vault</span>
        </div>
      </div>

      {fingerprint.value ? (
        <div class="mx-3 mb-4 px-3 py-2 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) flex items-center gap-2">
          <span class="fingerprint-sm">{fingerprint.value}</span>
        </div>
      ) : null}

      <nav class="flex-1 px-2 flex flex-col gap-0.5">
        {NAV.map((item) => (
          <NavLink key={item.id} {...item} active={currentView.value === item.id} />
        ))}
      </nav>

      <div class="px-2 pb-4 pt-2 border-t border-(--color-line) mx-2">
        <motion.button
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-(--color-ink-muted) hover:text-(--color-ink) hover:bg-(--color-surface-elev) transition-colors duration-150 cursor-pointer bg-transparent border-0"
          whileTap={TAP_SCALE}
          onClick={onLock}
          aria-label="Lock vault"
        >
          <IconLock size={16} />
          <span>Lock vault</span>
        </motion.button>
      </div>
    </aside>
  );
}

function NavLink({ id, label, icon, active }: NavItem & { active: boolean }) {
  return (
    <motion.button
      type="button"
      whileTap={TAP_SCALE}
      onClick={() => {
        currentView.value = id;
      }}
      class={
        "relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm cursor-pointer bg-transparent border-0 transition-colors duration-150 " +
        (active
          ? "text-(--color-ink) bg-(--color-surface-elev)"
          : "text-(--color-ink-muted) hover:text-(--color-ink) hover:bg-(--color-surface-elev)/60")
      }
      aria-current={active ? "page" : undefined}
    >
      {active ? (
        <motion.span
          layoutId="sidebar-active"
          transition={SOFT_SPRING}
          class="absolute inset-y-1 left-1 w-1 rounded-full bg-(--color-accent-500)"
        />
      ) : null}
      <span class="grid place-items-center shrink-0">{icon}</span>
      <span>{label}</span>
    </motion.button>
  );
}
