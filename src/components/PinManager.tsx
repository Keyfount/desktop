import { useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconShield } from "../icons.js";
import { POP_IN, TAP_SCALE } from "../motion.js";

interface Props {
  hasPin: boolean;
  onChange: () => void | Promise<void>;
}

/**
 * Toggle a 4-6 digit PIN on the active vault. Set-form ↔ enabled-row
 * mirror the extension's PinSection so the two surfaces feel
 * identical. The PIN never leaves this component — the actual
 * crypto wrapping happens in the Rust side via `api.setPin`.
 */
export function PinManager({ hasPin, onChange }: Props) {
  const [confirmingEnable, setConfirmingEnable] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.setPin(pin);
      setConfirmingEnable(false);
      setPin("");
      await onChange();
    } catch (e) {
      setError(describeError(e) || t("err_pin_set_failed"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await api.removePin();
      await onChange();
    } catch (e) {
      setError(describeError(e) || t("err_pin_set_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="callout flex items-start gap-2">
        <span class="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
          <IconShield size={14} />
        </span>
        <span class="text-xs leading-relaxed">{t("pin_warning_master_only")}</span>
      </div>

      <AnimatePresence mode="wait">
        {hasPin ? (
          <motion.div
            key="active"
            class="flex items-center justify-between gap-3"
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <span class="text-sm text-(--color-ink)">{t("pin_enabled_label")}</span>
            <motion.button
              type="button"
              class="btn btn-danger btn-sm"
              whileTap={TAP_SCALE}
              disabled={busy}
              onClick={() => void disable()}
            >
              {t("pin_remove")}
            </motion.button>
          </motion.div>
        ) : confirmingEnable ? (
          <motion.div
            key="form"
            class="flex flex-col gap-3"
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <label class="flex flex-col gap-2">
              <span class="field-label">{t("pin_choose_label")}</span>
              <input
                class="input input-mono tracking-widest text-center"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={6}
                autoFocus
                value={pin}
                onInput={(e) =>
                  setPin((e.target as HTMLInputElement).value.replace(/\D/g, ""))
                }
              />
            </label>
            <div class="flex gap-2">
              <motion.button
                type="button"
                class="btn btn-sm"
                whileTap={TAP_SCALE}
                disabled={busy || pin.length < 4}
                onClick={() => void enable()}
              >
                {busy ? t("pin_saving") : t("pin_confirm_enable")}
              </motion.button>
              <motion.button
                type="button"
                class="btn btn-ghost btn-sm"
                whileTap={TAP_SCALE}
                onClick={() => {
                  setConfirmingEnable(false);
                  setPin("");
                  setError(null);
                }}
              >
                {t("common_cancel")}
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="enable"
            type="button"
            class="btn btn-ghost btn-sm self-start"
            whileTap={TAP_SCALE}
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => setConfirmingEnable(true)}
          >
            {t("pin_enable_cta")}
          </motion.button>
        )}
      </AnimatePresence>

      {error !== null ? (
        <div class="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
