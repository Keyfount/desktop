import { AnimatePresence, motion } from "framer-motion";
import { t } from "../i18n.js";
import { IconLock } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { vaultSheetOpen } from "./state.js";
import { firstEmoji } from "./VaultAvatar.js";

export interface VaultRow {
  id: string;
  name: string;
  fingerprint: string;
  active: boolean;
}

interface Props {
  platform: "ios" | "android";
  vaults: VaultRow[];
  onSwitch: (vaultId: string) => void;
  onLock: () => void;
  onNew: () => void;
}

export function VaultSheet({ platform, vaults, onSwitch, onLock, onNew }: Props) {
  const surfaceClass = platform === "ios" ? "glass-ios" : "surface-android";
  return (
    <AnimatePresence>
      {vaultSheetOpen.value ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            class="fixed inset-0 z-50 bg-black/40"
            onClick={() => {
              vaultSheetOpen.value = false;
            }}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SOFT_SPRING}
            class={`mobile-sheet ${surfaceClass} safe-bottom`}
          >
            <div class="mobile-sheet__handle" />
            <h3 class="px-4 pt-2 pb-3 text-[10px] uppercase tracking-wider text-(--color-ink-muted)">
              {t("mobile_vault_sheet_title")}
            </h3>
            <ul class="px-2 pb-2 flex flex-col">
              {vaults.map((vault) => (
                <motion.li key={vault.id} whileTap={TAP_SCALE}>
                  <button
                    type="button"
                    class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-transparent border-0 cursor-pointer text-left"
                    onClick={() => {
                      onSwitch(vault.id);
                      vaultSheetOpen.value = false;
                    }}
                  >
                    <span class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center text-[16px]">
                      {firstEmoji(vault.fingerprint)}
                    </span>
                    <span class="flex-1 text-[15px] text-(--color-ink)">{vault.name}</span>
                    {vault.active ? (
                      <span class="text-[11px] text-(--color-accent-500) font-medium">
                        {t("mobile_vault_sheet_active")}
                      </span>
                    ) : null}
                  </button>
                </motion.li>
              ))}
            </ul>
            <div class="border-t border-(--color-line) mx-2" />
            <ul class="px-2 py-2 flex flex-col">
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink)"
                  onClick={() => {
                    onNew();
                    vaultSheetOpen.value = false;
                  }}
                >
                  <span class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center text-[18px]">
                    ＋
                  </span>
                  {t("mobile_vault_sheet_new")}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink)"
                  onClick={() => {
                    onLock();
                    vaultSheetOpen.value = false;
                  }}
                >
                  <span class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center">
                    <IconLock size={16} />
                  </span>
                  {t("mobile_vault_sheet_lock")}
                </button>
              </li>
            </ul>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
