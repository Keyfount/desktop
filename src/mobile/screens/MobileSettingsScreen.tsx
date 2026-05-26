import type { ComponentChildren } from "preact";
import { motion } from "framer-motion";
import { t } from "../../i18n.js";
import { IconLock } from "../../icons.js";
import { SOFT_SPRING } from "../../motion.js";
import { syncServerStatus } from "../../sync/status.js";

interface Props {
  onLock?: () => void;
}

const SECTION_CLASSES =
  "rounded-2xl bg-(--color-surface-elev) border border-(--color-line) overflow-hidden";
const ROW_CLASSES =
  "w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink)";

function SectionHeader({ children }: { children: ComponentChildren }) {
  return (
    <h2 class="text-[10px] uppercase tracking-wider text-(--color-ink-muted) px-4 pt-5 pb-2 font-medium">
      {children}
    </h2>
  );
}

export function MobileSettingsScreen({ onLock }: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="flex flex-col pt-2 pb-6"
    >
      <SectionHeader>{t("mobile_settings_section_lock")}</SectionHeader>
      <div class={SECTION_CLASSES}>
        <button
          type="button"
          data-action="lock"
          class={ROW_CLASSES}
          onClick={() => onLock?.()}
        >
          <IconLock size={18} />
          <span>{t("sidebar_lock")}</span>
        </button>
      </div>

      <SectionHeader>{t("mobile_settings_section_account")}</SectionHeader>
      <div class={SECTION_CLASSES} />

      <SectionHeader>{t("mobile_settings_section_sync")}</SectionHeader>
      <div class={SECTION_CLASSES}>
        <div class="px-4 py-3 flex items-center gap-2 text-[13px]">
          <span
            class={
              "inline-block h-2 w-2 rounded-full " +
              (syncServerStatus.value === "online"
                ? "bg-emerald-500"
                : syncServerStatus.value === "offline"
                  ? "bg-red-500"
                  : "bg-amber-400")
            }
          />
          <span class="text-(--color-ink-muted)">
            {syncServerStatus.value === "online" ? t("sync_status_dot_online")
              : syncServerStatus.value === "offline" ? t("sync_status_dot_offline")
              : syncServerStatus.value === "checking" ? t("sync_status_dot_checking")
              : ""}
          </span>
        </div>
      </div>

      <SectionHeader>{t("mobile_settings_section_data")}</SectionHeader>
      <div class={SECTION_CLASSES} />

      <SectionHeader>{t("mobile_settings_section_about")}</SectionHeader>
      <div class={SECTION_CLASSES}>
        <p class="px-4 py-3 text-[13px] text-(--color-ink-muted)">Keyfount</p>
      </div>
    </motion.section>
  );
}
