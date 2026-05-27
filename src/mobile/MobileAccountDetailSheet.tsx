import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconRefresh,
  IconTrash,
  IconClose,
} from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { selectedAccount, allAccounts } from "../state.js";
import { AccountAvatar } from "../components/AccountAvatar.js";
import { ProfileEditor } from "../components/ProfileEditor.js";
import type { Profile } from "../types.js";

interface Props {
  platform: "ios" | "android";
}

export function MobileAccountDetailSheet({ platform }: Props) {
  const entry = selectedAccount.value;
  const isOpen = entry !== null;

  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  const [usernameDraft, setUsernameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameToast, setRenameToast] = useState<string | null>(null);
  const [previewPassword, setPreviewPassword] = useState<string | null>(null);
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const [previewCopied, setPreviewCopied] = useState(false);

  useEffect(() => {
    if (entry) {
      setUsernameDraft(entry.username);
      setProfile(entry.profile);
      setRenameError(null);
      setRenameToast(null);
      setPreviewPassword(null);
      setPreviewRevealed(false);
      setPreviewCopied(false);
      setPassword(null);
      setRevealed(false);
      setCopied(false);
      void regenerate(entry.profile);
    }
  }, [entry]);

  const usernameDirty = entry ? usernameDraft.trim() !== entry.username && usernameDraft.trim().length > 0 : false;

  // Preview password debounce
  useEffect(() => {
    if (!usernameDirty || !entry || !profile) {
      setPreviewPassword(null);
      return;
    }
    const handle = setTimeout(() => {
      void api
        .generate(entry.domain, usernameDraft.trim(), profile)
        .then((r) => setPreviewPassword(r.password))
        .catch(() => setPreviewPassword(null));
    }, 250);
    return () => clearTimeout(handle);
  }, [usernameDraft, usernameDirty, entry, profile]);

  const copyPreview = useCallback(async () => {
    if (previewPassword === null) return;
    try {
      await api.copyWithAutoClear(previewPassword);
      setPreviewCopied(true);
      setTimeout(() => setPreviewCopied(false), 1500);
    } catch {
      /* swallow */
    }
  }, [previewPassword]);

  const regenerate = useCallback(
    async (withProfile: Profile) => {
      if (!entry) return;
      setBusy(true);
      try {
        const r = await api.generate(entry.domain, entry.username, withProfile);
        setPassword(r.password);
        setRevealed(false);
        setCopied(false);
      } catch (err) {
        /* swallow */
      } finally {
        setBusy(false);
      }
    },
    [entry],
  );

  const updateProfile = useCallback(
    async (next: Profile) => {
      if (!entry) return;
      setProfile(next);
      try {
        await api.updateAccountProfile(entry.domain, entry.username, next);
        allAccounts.value = allAccounts.value.map((e) =>
          e.domain === entry.domain && e.username === entry.username ? { ...e, profile: next } : e
        );
        selectedAccount.value = { ...entry, profile: next };
      } catch {
        /* swallow */
      }
      await regenerate(next);
    },
    [entry, regenerate],
  );

  const copy = useCallback(async () => {
    if (password === null) return;
    try {
      await api.copyWithAutoClear(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  }, [password]);

  const onDelete = useCallback(async () => {
    if (!entry) return;
    await api.deleteAccount(entry.domain, entry.username);
    allAccounts.value = allAccounts.value.filter(
      (e) => !(e.domain === entry.domain && e.username === entry.username)
    );
    selectedAccount.value = null;
  }, [entry]);

  const renameSubmit = useCallback(
    async (event: Event) => {
      event.preventDefault();
      if (!entry) return;
      setRenameError(null);
      const next = usernameDraft.trim();
      if (next.length === 0 || next === entry.username) return;
      setBusy(true);
      try {
        const r = await api.renameAccount(entry.domain, entry.username, next);
        const updated = r.entry;
        allAccounts.value = allAccounts.value.map((e) =>
          e.domain === entry.domain && e.username === entry.username ? updated : e
        );
        selectedAccount.value = updated;
        try {
          const r2 = await api.generate(updated.domain, updated.username, updated.profile);
          setPassword(r2.password);
          setRenameToast(r2.password);
          setRevealed(false);
          setTimeout(() => setRenameToast(null), 12_000);
        } catch {
          /* swallow */
        }
      } catch (err) {
        setRenameError(describeError(err) || t("detail_rename_failed"));
      } finally {
        setBusy(false);
      }
    },
    [entry, usernameDraft],
  );

  const surfaceClass = "bg-(--color-surface) border-t border-(--color-line)";

  return (
    <AnimatePresence>
      {isOpen && entry && profile ? (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            class="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
            onClick={() => {
              selectedAccount.value = null;
            }}
          />
          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SOFT_SPRING}
            class={`mobile-sheet ${surfaceClass} safe-bottom max-h-[85vh] overflow-y-auto px-4 pb-6 flex flex-col gap-4`}
          >
            <div class="mobile-sheet__handle shrink-0" />
            
            {/* Header */}
            <header class="flex items-center justify-between gap-3 pt-2">
              <div class="flex items-center gap-3">
                <AccountAvatar domain={entry.domain} size={44} />
                <div class="flex flex-col min-w-0">
                  <h3 class="text-base font-semibold text-(--color-ink) truncate leading-snug">
                    {entry.domain.replace(/^www\./, "")}
                  </h3>
                  <span class="text-xs text-(--color-ink-muted)">
                    {t("accounts_derived_password")}
                  </span>
                </div>
              </div>
              <motion.button
                type="button"
                whileTap={TAP_SCALE}
                onClick={() => { selectedAccount.value = null; }}
                class="w-8 h-8 rounded-full bg-(--color-surface-sunken) grid place-items-center text-(--color-ink-muted) cursor-pointer hover:bg-(--color-line) border-0"
                aria-label="Close"
              >
                <IconClose size={16} />
              </motion.button>
            </header>

            {/* Rename form */}
            <form onSubmit={renameSubmit} class="flex flex-col gap-2 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] font-mono uppercase tracking-[0.22em] text-(--color-ink-subtle)">
                  {t("main_username_label")}
                </span>
                <AnimatePresence>
                  {usernameDirty ? (
                    <motion.button
                      type="submit"
                      disabled={busy}
                      whileTap={TAP_SCALE}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      class="btn btn-sm !h-7 !px-2.5 rounded-lg"
                    >
                      <IconCheck size={12} />
                      <span class="text-xs">{t("common_save")}</span>
                    </motion.button>
                  ) : null}
                </AnimatePresence>
              </div>
              <input
                type="text"
                autocomplete="off"
                disabled={busy}
                value={usernameDraft}
                onInput={(e) => setUsernameDraft((e.target as HTMLInputElement).value)}
                class="bg-transparent outline-none text-[16px] text-(--color-ink) w-full font-medium"
              />
              {renameError !== null ? (
                <span class="text-xs text-(--color-danger) mt-1">{renameError}</span>
              ) : null}
            </form>

            {/* Rename warning and preview password */}
            <AnimatePresence>
              {usernameDirty ? (
                <motion.div
                  key="rename-warn"
                  class="callout flex flex-col gap-2 p-3 rounded-2xl border border-amber-300/40 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/5"
                  variants={POP_IN}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <strong class="text-xs text-(--color-ink) font-semibold">{t("detail_rename_warning_title")}</strong>
                  <span class="text-[11px] text-(--color-ink-muted) leading-relaxed">
                    {t("detail_rename_warning_body")}
                  </span>
                  {previewPassword !== null ? (
                    <div class="flex flex-col gap-1.5 pt-1.5 border-t border-amber-300/20 mt-1">
                      <span class="text-[9px] uppercase tracking-wider text-(--color-ink-subtle)">{t("detail_rename_preview_label")}</span>
                      <code
                        class={
                          previewRevealed
                            ? "font-mono text-sm break-all text-(--color-ink) select-all"
                            : "font-mono text-sm break-all text-(--color-ink-muted) tracking-[0.15em] select-all"
                        }
                      >
                        {previewRevealed ? previewPassword : "•".repeat(Math.min(previewPassword.length, 16))}
                      </code>
                      <div class="flex gap-2 mt-1">
                        <motion.button
                          type="button"
                          class="btn btn-ghost btn-sm flex-1 !h-7 !px-2 rounded-lg bg-transparent"
                          whileTap={TAP_SCALE}
                          onClick={() => setPreviewRevealed((v) => !v)}
                        >
                          {previewRevealed ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                          <span class="text-xs">{previewRevealed ? t("common_hide") : t("common_reveal")}</span>
                        </motion.button>
                        <motion.button
                          type="button"
                          class="btn btn-ghost btn-sm flex-1 !h-7 !px-2 rounded-lg bg-transparent"
                          whileTap={TAP_SCALE}
                          onClick={copyPreview}
                        >
                          {previewCopied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                          <span class="text-xs">{previewCopied ? t("common_copied") : t("common_copy")}</span>
                        </motion.button>
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Rename Success Toast */}
            <AnimatePresence>
              {renameToast !== null ? (
                <motion.div
                  key="rename-toast"
                  class="callout callout-info flex flex-col gap-2 p-3"
                  variants={POP_IN}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <span class="text-xs font-medium text-(--color-ink)">{t("detail_rename_password_changed")}</span>
                  <code class="font-mono text-xs break-all text-(--color-ink) select-all">{renameToast}</code>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Main password card */}
            <div class="flex flex-col gap-2 p-3.5 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) shadow-sm">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-mono uppercase tracking-[0.22em] text-(--color-ink-subtle)">
                  {t("accounts_derived_password")}
                </span>
                {password ? (
                  <span class="text-[9px] font-mono text-(--color-ink-subtle)">
                    {t("accounts_chars", String(password.length))}
                  </span>
                ) : null}
              </div>
              {busy ? (
                <div class="skeleton h-5 w-3/4 rounded mt-1" />
              ) : password === null ? (
                <span class="font-mono text-sm text-(--color-ink-subtle)">—</span>
              ) : (
                <code
                  class={
                    revealed
                      ? "font-mono text-[16px] break-all select-all text-(--color-ink) leading-snug"
                      : "font-mono text-[16px] break-all select-all text-(--color-ink-muted) tracking-[0.18em] leading-snug"
                  }
                >
                  {revealed ? password : "•".repeat(Math.min(password.length, 16))}
                </code>
              )}
              <div class="flex gap-2 mt-2 pt-1 border-t border-(--color-line)/50">
                <motion.button
                  type="button"
                  class="btn btn-ghost btn-sm flex-1 !h-8 !px-2 rounded-xl"
                  whileTap={TAP_SCALE}
                  onClick={() => setRevealed((v) => !v)}
                  disabled={password === null}
                >
                  {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  <span class="text-xs">{revealed ? t("common_hide") : t("common_reveal")}</span>
                </motion.button>
                <motion.button
                  type="button"
                  class="btn btn-sm flex-1 !h-8 !px-2 rounded-xl"
                  whileTap={TAP_SCALE}
                  onClick={copy}
                  disabled={password === null}
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  <span class="text-xs">{copied ? t("common_copied") : t("common_copy")}</span>
                </motion.button>
                <motion.button
                  type="button"
                  class="btn btn-ghost btn-sm !w-8 !h-8 !p-0 rounded-xl"
                  whileTap={TAP_SCALE}
                  onClick={() => regenerate(profile)}
                  disabled={busy}
                  aria-label={t("main_recompute")}
                >
                  <IconRefresh size={14} />
                </motion.button>
              </div>
            </div>

            {/* Profile editor */}
            <div class="flex flex-col gap-2">
              <span class="text-[10px] font-mono uppercase tracking-[0.22em] text-(--color-ink-subtle) px-1">
                {t("accounts_generation_profile")}
              </span>
              <div class="card !p-4">
                <ProfileEditor profile={profile} onChange={updateProfile} compact />
              </div>
            </div>

            {/* Footer / Delete */}
            <footer class="flex pt-3 border-t border-(--color-line)/60 mt-2 shrink-0">
              <motion.button
                type="button"
                class="btn btn-danger btn-sm w-full !h-10 rounded-xl"
                whileTap={TAP_SCALE}
                onClick={onDelete}
              >
                <IconTrash size={14} />
                <span class="text-sm font-semibold">{t("accounts_delete")}</span>
              </motion.button>
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
