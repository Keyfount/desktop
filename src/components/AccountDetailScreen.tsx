import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { IconCheck, IconChevronRight, IconCopy, IconEye, IconEyeOff } from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { allAccounts, busy, errorMessage, generated, screen, selectedAccount } from "../state.js";
import type { Profile } from "../types.js";
import { Header } from "./Header.js";
import { ProfileEditor } from "./ProfileEditor.js";

export function AccountDetailScreen() {
  const entry = selectedAccount.value;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(entry?.profile ?? null);

  useEffect(() => {
    if (entry === null) return;
    busy.value = true;
    void api
      .generate(entry.domain, entry.username, profile ?? undefined)
      .then((r) => (generated.value = r.password))
      .catch((err) => {
        errorMessage.value = err instanceof Error ? err.message : "generation failed";
      })
      .finally(() => {
        busy.value = false;
      });
  }, [entry?.domain, entry?.username]);

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

  const updateProfile = useCallback(
    async (next: Profile) => {
      if (entry === null) return;
      setProfile(next);
      generated.value = null;
      try {
        await api.updateAccountProfile(entry.domain, entry.username, next);
        allAccounts.value = allAccounts.value.map((e) =>
          e.domain === entry.domain && e.username === entry.username ? { ...e, profile: next } : e,
        );
        const r = await api.generate(entry.domain, entry.username, next);
        generated.value = r.password;
      } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : "update failed";
      }
    },
    [entry],
  );

  const onDelete = useCallback(async () => {
    if (entry === null) return;
    await api.deleteAccount(entry.domain, entry.username);
    allAccounts.value = allAccounts.value.filter(
      (e) => !(e.domain === entry.domain && e.username === entry.username),
    );
    screen.value = "main";
  }, [entry]);

  if (entry === null) {
    screen.value = "main";
    return null;
  }

  return (
    <motion.div
      class="flex flex-col gap-4 p-6 max-w-md mx-auto pt-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={entry.domain}
        actions={
          <motion.button
            type="button"
            class="btn btn-quiet btn-icon"
            whileTap={TAP_SCALE}
            onClick={() => {
              screen.value = "main";
            }}
            aria-label={t("common_back")}
          >
            <IconChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
          </motion.button>
        }
      />
      <div class="flex flex-col gap-1">
        <span class="field-label">{t("main_username_label")}</span>
        <span class="text-sm text-(--color-ink) truncate" title={entry.username}>
          {entry.username}
        </span>
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
                  ? "font-mono text-sm break-all select-all cursor-text text-(--color-ink)"
                  : "font-mono text-sm break-all select-all cursor-text text-(--color-ink-muted) tracking-[0.15em]"
              }
            >
              {revealed ? generated.value : "•".repeat(Math.min(generated.value.length, 24))}
            </code>
            <div class="flex gap-2">
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
                class="btn btn-sm flex-1"
                whileTap={TAP_SCALE}
                onClick={copy}
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                {copied ? t("common_copied") : t("common_copy")}
              </motion.button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {profile !== null ? (
        <ProfileEditor profile={profile} onChange={updateProfile} compact />
      ) : null}

      <motion.button type="button" class="btn btn-danger" whileTap={TAP_SCALE} onClick={onDelete}>
        Delete account
      </motion.button>
    </motion.div>
  );
}
