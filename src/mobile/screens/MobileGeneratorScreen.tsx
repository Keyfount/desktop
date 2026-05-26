import { useCallback } from "preact/hooks";
import { motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import {
  activeDomain,
  activeEmail,
  defaultProfile,
  errorMessage,
  generated,
} from "../../state.js";

export function MobileGeneratorScreen() {
  const onGenerate = useCallback(async () => {
    if (activeDomain.value === null) return;
    errorMessage.value = null;
    try {
      const r = await api.generate(
        activeDomain.value,
        activeEmail.value.trim(),
        defaultProfile.value ?? undefined,
      );
      generated.value = r.password;
    } catch (err) {
      errorMessage.value = describeError(err);
    }
  }, []);

  const onCopy = useCallback(async () => {
    if (!generated.value) return;
    try {
      await api.copyWithAutoClear(generated.value);
    } catch (err) {
      errorMessage.value = describeError(err);
    }
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="flex flex-col gap-4 pt-2"
    >
      <label class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) p-3 flex flex-col gap-1">
        <span class="text-[10px] font-medium uppercase tracking-wider text-(--color-ink-muted)">
          {t("main_domain_label")}
        </span>
        <input
          type="text"
          inputMode="url"
          autocomplete="off"
          spellcheck={false}
          placeholder={t("main_domain_placeholder")}
          value={activeDomain.value ?? ""}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value.trim();
            activeDomain.value = v.length === 0 ? null : v.toLowerCase();
            void onGenerate();
          }}
          class="bg-transparent outline-none text-[15px] text-(--color-ink)"
        />
      </label>

      <label class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) p-3 flex flex-col gap-1">
        <span class="text-[10px] font-medium uppercase tracking-wider text-(--color-ink-muted)">
          {t("main_username_label")}
        </span>
        <input
          type="text"
          inputMode="email"
          autocomplete="off"
          spellcheck={false}
          placeholder={t("main_username_placeholder")}
          value={activeEmail.value}
          onInput={(e) => {
            activeEmail.value = (e.target as HTMLInputElement).value;
            void onGenerate();
          }}
          class="bg-transparent outline-none text-[15px] text-(--color-ink)"
        />
      </label>

      {generated.value ? (
        <div class="rounded-2xl bg-(--color-ink) text-(--color-surface) p-4 flex flex-col gap-2">
          <span class="font-mono text-[15px] leading-tight break-all">{generated.value}</span>
          <span class="text-[10px] uppercase tracking-wider text-white/60">
            {t("generator_chars", String(generated.value.length))}
          </span>
        </div>
      ) : null}

      <motion.button
        type="button"
        whileTap={TAP_SCALE}
        disabled={!generated.value}
        onClick={() => void onCopy()}
        class="rounded-full bg-(--color-ink) text-(--color-surface) py-3 font-medium text-[15px] disabled:opacity-40"
      >
        {t("common_copy")}
      </motion.button>

      {errorMessage.value ? (
        <p class="text-(--color-danger) text-[13px]">{errorMessage.value}</p>
      ) : null}
    </motion.section>
  );
}
