import { motion } from "framer-motion";
import { t } from "../i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { vaultSheetOpen } from "./state.js";

export function firstEmoji(fingerprint: string): string {
  const parts = fingerprint.trim().split(/\s+/u);
  return parts[0] && parts[0].length > 0 ? parts[0] : "?";
}

interface Props {
  fingerprint: string;
}

export function VaultAvatar({ fingerprint }: Props) {
  return (
    <motion.button
      type="button"
      class="vault-avatar"
      whileTap={TAP_SCALE}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SOFT_SPRING}
      onClick={() => {
        vaultSheetOpen.value = true;
      }}
      aria-label={t("mobile_vault_sheet_title")}
    >
      <span class="vault-avatar__emoji" aria-hidden="true">
        {firstEmoji(fingerprint)}
      </span>
    </motion.button>
  );
}
