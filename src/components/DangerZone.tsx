import { useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconTrash } from "../icons.js";
import { TAP_SCALE } from "../motion.js";
import { errorMessage, fingerprint, screen } from "../state.js";
import { ConfirmModal } from "./ConfirmModal.js";

interface Props {
  /**
   * Called after a successful wipe so the parent can refresh state.
   * Routing back to the locked/setup screen is handled here.
   */
  onWiped?: () => void | Promise<void>;
}

/**
 * Single dangerous action: wipe the active vault. Gated behind a
 * ConfirmModal that spells out what disappears. Mirrors the
 * extension's DangerSection but folded into the existing settings
 * page since desktop doesn't have the categorised settings layout
 * yet (deferred to Chantier 3).
 */
export function DangerZone({ onWiped }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true);
    try {
      await api.wipe();
      fingerprint.value = null;
      // After wipe, the Rust side returns to a fresh-vault state.
      // Send the user to the setup screen so they can recreate
      // (or import) something.
      screen.value = "setup";
      if (onWiped) await onWiped();
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_wipe_failed");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-(--color-ink)">{t("settings_danger_hint")}</span>
      <motion.button
        type="button"
        class="btn btn-danger btn-sm"
        whileTap={TAP_SCALE}
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        <IconTrash size={14} />
        {busy ? t("settings_wipe_wiping") : t("settings_wipe_button")}
      </motion.button>

      {confirming ? (
        <ConfirmModal
          title={t("settings_wipe_confirm_title")}
          body={t("settings_wipe_confirm_body")}
          confirmLabel={t("settings_wipe_button")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void wipe()}
        />
      ) : null}
    </div>
  );
}
