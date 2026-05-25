import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLock,
  IconSettings,
} from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import {
  activeDomain,
  activeEmail,
  allAccounts,
  busy,
  canGenerate,
  errorMessage,
  fingerprint,
  generated,
  historyEnabled,
  screen,
} from "../state.js";
import type { Profile } from "../types.js";
import { AccountList } from "./AccountList.js";
import { Header } from "./Header.js";
import { ProfileEditor } from "./ProfileEditor.js";

export function MainScreen() {
  const [forceGenerate, setForceGenerate] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api
      .listAccounts()
      .then((r) => {
        allAccounts.value = r.entries;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    generated.value = null;
    setRevealed(false);
    setCopied(false);
    setProfile(null);
    setShowProfile(false);
    setSaved(false);
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
      errorMessage.value = err instanceof Error ? err.message : "generation failed";
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

  const onLock = useCallback(async () => {
    await api.lock();
    generated.value = null;
    screen.value = "unlock";
  }, []);

  const onSettings = useCallback(() => {
    screen.value = "settings";
  }, []);

  const canShowList = historyEnabled.value && allAccounts.value.length > 0;
  const showList = canShowList && !forceGenerate;

  return (
    <motion.div
      class="flex flex-col gap-4 p-6 max-w-md mx-auto pt-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={activeDomain.value ?? undefined}
        fingerprint={fingerprint.value}
        actions={
          <>
            <motion.button
              type="button"
              class="btn btn-quiet btn-icon"
              whileTap={TAP_SCALE}
              onClick={onSettings}
              aria-label={t("common_settings")}
            >
              <IconSettings />
            </motion.button>
            <motion.button
              type="button"
              class="btn btn-quiet btn-icon"
              whileTap={TAP_SCALE}
              onClick={onLock}
              aria-label={t("common_lock")}
            >
              <IconLock />
            </motion.button>
          </>
        }
      />

      {showList ? (
        <AccountList onAddNew={() => setForceGenerate(true)} />
      ) : (
        <>
          <label class="flex flex-col gap-2">
            <span class="field-label">{t("main_domain_label")}</span>
            <input
              class="input input-mono"
              type="text"
              value={activeDomain.value ?? ""}
              placeholder={t("main_domain_placeholder")}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value.trim();
                activeDomain.value = v.length === 0 ? null : v.toLowerCase();
              }}
            />
          </label>

          <label class="flex flex-col gap-2">
            <span class="field-label">{t("main_username_label")}</span>
            <input
              class="input"
              type="text"
              value={activeEmail.value}
              autocomplete="off"
              placeholder={t("main_username_placeholder")}
              onInput={(e) => {
                activeEmail.value = (e.target as HTMLInputElement).value;
              }}
            />
          </label>

          <motion.button
            type="button"
            class="btn"
            whileTap={TAP_SCALE}
            onClick={generate}
            disabled={busy.value || !canGenerate.value}
          >
            {busy.value ? t("common_generating") : t("common_generate")}
          </motion.button>

          <div class="flex flex-col">
            <button
              type="button"
              class="flex items-center justify-between gap-2 py-1.5 px-1 text-xs text-(--color-ink-muted) hover:text-(--color-ink) transition-colors cursor-pointer bg-transparent border-0 font-medium"
              onClick={() => setShowProfile((v) => !v)}
              aria-expanded={showProfile}
            >
              <span>{t("main_customize")}</span>
              <motion.span
                animate={{ rotate: showProfile ? 180 : 0 }}
                transition={SOFT_SPRING}
                class="grid place-items-center"
              >
                <IconChevronDown size={14} />
              </motion.span>
            </button>
            <AnimatePresence>
              {showProfile && profile !== null ? (
                <motion.div
                  key="profile"
                  class="overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1, transition: SOFT_SPRING }}
                  exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
                >
                  <div class="pt-3 pb-1">
                    <ProfileEditor profile={profile} onChange={updateProfile} compact />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {generated.value !== null ? (
              <motion.div
                key="generated"
                class="flex flex-col gap-3 p-4 rounded-2xl bg-(--color-surface-sunken) border border-(--color-line)"
                variants={POP_IN}
                initial="initial"
                animate="animate"
                exit="exit"
                layout
              >
                <code
                  class={
                    revealed
                      ? "font-mono text-sm break-all select-all cursor-text text-(--color-ink) min-h-5"
                      : "font-mono text-sm break-all select-all cursor-text text-(--color-ink-muted) min-h-5 tracking-[0.15em]"
                  }
                >
                  {revealed ? generated.value : "•".repeat(Math.min(generated.value.length, 24))}
                </code>
                <div class="flex gap-2 flex-wrap">
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
                      class="btn btn-sm flex-1"
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
              <p class="field-hint">{t("main_no_email")}</p>
            ) : null}
          </AnimatePresence>

          {errorMessage.value !== null ? (
            <div class="field-error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}
        </>
      )}
    </motion.div>
  );
}
