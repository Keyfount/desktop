import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconKey,
  IconRefresh,
} from "../../icons.js";
import {
  activeDomain,
  activeEmail,
  allAccounts,
  busy,
  canGenerate,
  errorMessage,
  generated,
  historyEnabled,
} from "../../state.js";
import { ProfileEditor } from "../../components/ProfileEditor.js";
import type { Profile } from "../../types.js";

export function MobileGeneratorScreen() {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    generated.value = null;
    setRevealed(false);
    setCopied(false);
    setSaved(false);
    // Drop the cached profile so the Customize panel re-fetches for
    // the new domain on next open — see GeneratorView for the same fix.
    setProfile(null);
  }, [activeDomain.value, activeEmail.value]);

  useEffect(() => {
    if (!showProfile || profile !== null || activeDomain.value === null) return;
    void api
      .getProfile(activeDomain.value)
      .then((r) => setProfile(r.profile))
      .catch(() => {});
  }, [showProfile, profile, activeDomain.value]);

  const generate = useCallback(async () => {
    if (activeDomain.value === null) return;
    errorMessage.value = null;
    busy.value = true;
    try {
      const r = await api.generate(
        activeDomain.value,
        activeEmail.value.trim(),
        profile ?? undefined,
      );
      generated.value = r.password;
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_generation_failed");
    } finally {
      busy.value = false;
    }
  }, [profile]);



  const updateProfile = useCallback(async (next: Profile) => {
    setProfile(next);
    generated.value = null;
    if (activeDomain.value !== null) {
      try {
        await api.setProfile(activeDomain.value, next);
      } catch {
        /* swallow */
      }
    }
  }, []);

  const copy = useCallback(async () => {
    if (generated.value === null) return;
    try {
      await api.copyWithAutoClear(generated.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  }, []);

  const saveToHistory = useCallback(async () => {
    if (activeDomain.value === null || activeEmail.value.trim().length === 0) return;
    let chosen: Profile | null = profile;
    if (chosen === null) {
      try {
        const r = await api.getProfile(activeDomain.value);
        chosen = r.profile;
      } catch {
        return;
      }
    }
    try {
      const r = await api.recordAccount(activeDomain.value, activeEmail.value.trim(), chosen);
      const exists = allAccounts.value.some(
        (e) => e.domain === r.entry.domain && e.username === r.entry.username,
      );
      allAccounts.value = exists
        ? allAccounts.value.map((e) =>
            e.domain === r.entry.domain && e.username === r.entry.username ? r.entry : e,
          )
        : [r.entry, ...allAccounts.value];
      setSaved(true);
    } catch {
      /* swallow */
    }
  }, [profile]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="flex flex-col gap-4 pt-2 pb-6"
    >
      <div class="grid grid-cols-1 gap-3">
        <label class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) p-3.5 flex flex-col gap-1.5 focus-within:border-(--color-accent-500)/60 transition-colors">
          <span class="text-[10px] font-mono uppercase tracking-[0.22em] text-(--color-ink-subtle)">
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
            }}
            class="bg-transparent outline-none text-[16px] text-(--color-ink) font-mono"
          />
        </label>

        <label class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) p-3.5 flex flex-col gap-1.5 focus-within:border-(--color-accent-500)/60 transition-colors">
          <span class="text-[10px] font-mono uppercase tracking-[0.22em] text-(--color-ink-subtle)">
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
            }}
            class="bg-transparent outline-none text-[16px] text-(--color-ink)"
          />
        </label>
      </div>

      <div class="flex flex-col gap-2">
        <button
          type="button"
          class="self-start flex items-center gap-2 py-1.5 px-2 text-xs text-(--color-ink-muted) hover:text-(--color-ink) transition-colors cursor-pointer bg-transparent border-0 font-medium rounded-lg"
          onClick={() => setShowProfile((v) => !v)}
          aria-expanded={showProfile}
          disabled={activeDomain.value === null}
        >
          <span>{t("main_customize")}</span>
          <motion.span
            animate={{ rotate: showProfile ? 180 : 0 }}
            transition={SOFT_SPRING}
            class="grid place-items-center"
          >
            <IconChevronDown size={12} />
          </motion.span>
        </button>

        <AnimatePresence>
          {showProfile && profile !== null && activeDomain.value !== null ? (
            <motion.div
              key="profile"
              class="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1, transition: SOFT_SPRING }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            >
              <div class="card !p-4">
                <ProfileEditor profile={profile} onChange={updateProfile} compact />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div class="flex gap-2">
        <motion.button
          type="button"
          class="btn flex-1"
          whileTap={TAP_SCALE}
          onClick={generate}
          disabled={busy.value || !canGenerate.value}
        >
          {busy.value ? (
            <span class="flex items-center gap-2">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                class="grid place-items-center"
              >
                <IconRefresh size={14} />
              </motion.span>
              {t("common_generating")}
            </span>
          ) : (
            <span class="flex items-center gap-2">
              <IconKey size={14} />
              {t("common_generate")}
            </span>
          )}
        </motion.button>
      </div>

      <AnimatePresence>
        {generated.value !== null ? (
          <motion.div
            key="generated"
            class="flex flex-col gap-3 p-4 rounded-3xl bg-(--color-surface-elev) border border-(--color-line) shadow-[0_12px_24px_-12px_oklch(0_0_0/0.12)]"
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
            layout
          >
            <div class="flex items-center justify-between gap-3">
              <span class="mono-tag">{t("generator_password_label")}</span>
              <span class="mono-tag !text-[9px] text-(--color-ink-subtle)">
                {t("generator_chars", String(generated.value.length))}
              </span>
            </div>
            <code
              class={
                revealed
                  ? "font-mono text-base break-all select-all cursor-text text-(--color-ink) leading-snug"
                  : "font-mono text-base break-all select-all cursor-text text-(--color-ink-muted) tracking-[0.18em] leading-snug"
              }
            >
              {revealed ? generated.value : "•".repeat(Math.min(generated.value.length, 24))}
            </code>
            <div class="flex gap-2 flex-wrap pt-1">
              <motion.button
                type="button"
                class="btn btn-ghost btn-sm flex-1"
                whileTap={TAP_SCALE}
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                {revealed ? t("common_hide") : t("common_reveal")}
              </motion.button>
              <motion.button
                type="button"
                class="btn btn-ghost btn-sm flex-1"
                whileTap={TAP_SCALE}
                onClick={copy}
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                {copied ? t("common_copied") : t("common_copy")}
              </motion.button>
              {historyEnabled.value ? (
                <motion.button
                  type="button"
                  class="btn btn-sm w-full mt-1"
                  whileTap={TAP_SCALE}
                  onClick={saveToHistory}
                  disabled={saved}
                >
                  {saved ? <IconCheck size={14} /> : null}
                  {saved ? t("main_saved") : t("main_save_to_history")}
                </motion.button>
              ) : null}
            </div>
          </motion.div>
        ) : !canGenerate.value ? (
          <p class="text-xs text-(--color-ink-subtle) leading-snug px-1">
            {t("main_no_email")}
          </p>
        ) : null}
      </AnimatePresence>

      {errorMessage.value ? (
        <p class="text-(--color-danger) text-[13px] px-1">{errorMessage.value}</p>
      ) : null}
    </motion.section>
  );
}
