import { useCallback } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { motion } from "framer-motion";

import { api } from "../api.js";
import { Logo } from "../Logo.js";
import { t } from "../i18n.js";
import { IconKey, IconLock, IconRefresh, IconSettings, IconShield, IconUnlock } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import {
  fingerprint,
  generated,
  hasPin,
  historyEnabled,
  previousView,
  screen,
  view as currentView,
  type ShellView,
} from "../state.js";
import { syncServerStatus } from "../sync/status.js";

interface NavItem {
  id: ShellView;
  labelKey:
    | "sidebar_generator"
    | "sidebar_accounts"
    | "sidebar_sync"
    | "sidebar_vaults"
    | "sidebar_settings";
  icon: ComponentChildren;
}

const NAV: NavItem[] = [
  { id: "generator", labelKey: "sidebar_generator", icon: <IconKey size={16} /> },
  { id: "accounts", labelKey: "sidebar_accounts", icon: <IconUnlock size={16} /> },
  { id: "sync", labelKey: "sidebar_sync", icon: <IconRefresh size={16} /> },
  { id: "vaults", labelKey: "sidebar_vaults", icon: <IconShield size={16} /> },
  { id: "settings", labelKey: "sidebar_settings", icon: <IconSettings size={16} /> },
];

export function Sidebar() {
  const onLock = useCallback(async () => {
    await api.lock();
    generated.value = null;
    // Refresh hasPin so the unlock screen offers the PIN option. The signal
    // is only primed at bootstrap, so a PIN enabled later this session would
    // otherwise be missed here (the unlock screen would hide the PIN tab
    // until the app is relaunched).
    try {
      const status = await api.status();
      hasPin.value = status.hasPin;
    } catch {
      /* keep the last-known hasPin */
    }
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
          <span class="mono-tag !text-[9px]">{t("sidebar_tagline")}</span>
        </div>
      </div>

      {fingerprint.value ? (
        <div class="mx-3 mb-4 px-3 py-2 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) flex items-center gap-2">
          <span class="fingerprint-sm">{fingerprint.value}</span>
        </div>
      ) : null}

      <nav class="flex-1 px-2 flex flex-col gap-0.5">
        {NAV.filter((item) => {
          // Accounts + Sync are the two surfaces that only matter when
          // the user opted in to "remember the accounts I generate
          // passwords for". With history off we have nothing to list
          // and nothing to keep in sync, so we hide the entries to
          // keep the sidebar honest. The setting toggle (in
          // SettingsScreen) is the single source of truth.
          if (historyEnabled.value) return true;
          return item.id !== "accounts" && item.id !== "sync";
        }).map((item) => (
          <NavLink key={item.id} {...item} active={currentView.value === item.id} />
        ))}
      </nav>

      <div class="px-2 pb-4 pt-2 border-t border-(--color-line) mx-2">
        <motion.button
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-(--color-ink-muted) hover:text-(--color-ink) hover:bg-(--color-surface-elev) transition-colors duration-150 cursor-pointer bg-transparent border-0"
          whileTap={TAP_SCALE}
          onClick={onLock}
          aria-label={t("sidebar_lock")}
        >
          <IconLock size={16} />
          <span>{t("sidebar_lock")}</span>
        </motion.button>
      </div>
    </aside>
  );
}

function NavLink({ id, labelKey, icon, active }: NavItem & { active: boolean }) {
  return (
    <motion.button
      type="button"
      whileTap={TAP_SCALE}
      onClick={() => {
        // Sidebar nav is its own back path — clear any breadcrumb
        // that a previous Settings → Sync/Vaults jump left behind.
        previousView.value = null;
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
      <span class="flex-1 text-left">{t(labelKey)}</span>
      {id === "sync" ? <SyncStatusDot /> : null}
    </motion.button>
  );
}

/**
 * Tiny coloured dot that reflects the live `/health` status of the
 * configured sync server. Painted next to the "Sync" nav row so the
 * user always sees whether their server is reachable, without
 * having to open the screen.
 */
function SyncStatusDot() {
  const status = syncServerStatus.value;
  if (status === "disconnected") return null;
  const colour =
    status === "online"
      ? "bg-emerald-500"
      : status === "offline"
        ? "bg-red-500"
        : "bg-amber-400 animate-pulse";
  const label =
    status === "online"
      ? t("sync_status_dot_online")
      : status === "offline"
        ? t("sync_status_dot_offline")
        : t("sync_status_dot_checking");
  return (
    <span
      class={`inline-block h-2 w-2 rounded-full shrink-0 ${colour}`}
      role="status"
      aria-label={label}
      title={label}
    />
  );
}
