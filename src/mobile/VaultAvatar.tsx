import { motion } from "framer-motion";
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
      class="grid place-items-center w-9 h-9 rounded-full bg-(--color-surface-elev) border border-(--color-line) text-base"
      whileTap={TAP_SCALE}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SOFT_SPRING}
      onClick={() => {
        vaultSheetOpen.value = true;
      }}
      aria-label="Vaults"
    >
      <span aria-hidden="true">{firstEmoji(fingerprint)}</span>
    </motion.button>
  );
}
