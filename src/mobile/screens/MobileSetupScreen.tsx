import { useState } from "preact/hooks";
import { motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { errorMessage, fingerprint, screen, view } from "../../state.js";
import { additionalVaultMode } from "../state.js";

const MIN_LENGTH = 12;

interface Props {
  mode: "first-run" | "additional";
  onCancel: () => void;
}

export function MobileSetupScreen({ mode, onCancel }: Props) {
  const [master, setMaster] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    errorMessage.value = null;
    if (master.length < MIN_LENGTH) {
      errorMessage.value = t("setup_min_length_error", String(MIN_LENGTH));
      return;
    }
    if (master !== confirm) {
      errorMessage.value = t("setup_mismatch_error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.setup(master);
      fingerprint.value = res.fingerprint;
      additionalVaultMode.value = false;
      screen.value = "shell";
      view.value = "generator";
    } catch (err) {
      errorMessage.value = describeError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="safe-top safe-bottom px-5 pt-6 flex flex-col gap-5 min-h-screen"
    >
      <header class="flex items-center justify-between">
        <h1 class="text-[22px] font-semibold tracking-tight text-(--color-ink)">
          {mode === "first-run" ? t("setup_welcome") : t("mobile_setup_additional_vault_title")}
        </h1>
        {mode === "additional" ? (
          <button
            type="button"
            class="text-[14px] text-(--color-ink-muted) bg-transparent border-0"
            onClick={onCancel}
          >
            {t("mobile_setup_additional_vault_cancel")}
          </button>
        ) : null}
      </header>

      <p class="text-[14px] leading-relaxed text-(--color-ink-muted)">{t("setup_intro")}</p>

      <form class="flex flex-col gap-4" onSubmit={onSubmit}>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] uppercase tracking-wider text-(--color-ink-muted)">
            {t("setup_master_label")}
          </span>
          <input
            type="password"
            autocomplete="new-password"
            value={master}
            onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
            class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-4 py-3 text-[15px] text-(--color-ink) outline-none"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] uppercase tracking-wider text-(--color-ink-muted)">
            {t("setup_confirm_label")}
          </span>
          <input
            type="password"
            autocomplete="new-password"
            value={confirm}
            onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
            class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-4 py-3 text-[15px] text-(--color-ink) outline-none"
          />
        </label>

        {errorMessage.value ? (
          <p class="text-(--color-danger) text-[13px]">{errorMessage.value}</p>
        ) : null}

        <motion.button
          type="submit"
          whileTap={TAP_SCALE}
          disabled={busy}
          class="rounded-full bg-(--color-ink) text-(--color-surface) py-3 text-[15px] font-medium disabled:opacity-40"
        >
          {busy ? t("setup_creating") : t("setup_create_button")}
        </motion.button>
      </form>
    </motion.section>
  );
}
