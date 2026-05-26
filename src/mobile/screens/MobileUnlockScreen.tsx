import { useState } from "preact/hooks";
import { motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { errorMessage } from "../../state.js";

interface Props {
  hasPin: boolean;
}

export function MobileUnlockScreen({ hasPin }: Props) {
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    errorMessage.value = null;
    setBusy(true);
    try {
      await api.unlock(master);
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
      class="safe-top safe-bottom px-5 pt-12 flex flex-col gap-6 min-h-screen"
    >
      <header>
        <h1 class="text-[22px] font-semibold tracking-tight text-(--color-ink)">
          {t("unlock_title")}
        </h1>
        <p class="text-[13px] text-(--color-ink-muted) mt-1">
          {hasPin ? t("unlock_pin_subtitle") : t("unlock_subtitle")}
        </p>
      </header>

      <form class="flex flex-col gap-4" onSubmit={onSubmit}>
        <input
          type="password"
          autocomplete="current-password"
          autofocus
          value={master}
          onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
          class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-4 py-3 text-[15px] text-(--color-ink) outline-none"
        />

        {errorMessage.value ? (
          <p class="text-(--color-danger) text-[13px]">{errorMessage.value}</p>
        ) : null}

        <motion.button
          type="submit"
          whileTap={TAP_SCALE}
          disabled={busy}
          class="rounded-full bg-(--color-ink) text-(--color-surface) py-3 text-[15px] font-medium disabled:opacity-40"
        >
          {t("unlock_button")}
        </motion.button>
      </form>
    </motion.section>
  );
}
