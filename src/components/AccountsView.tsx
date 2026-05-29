import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import {
  activeDomain,
  activeEmail,
  allAccounts,
  errorMessage,
  selectedAccount,
  view,
} from "../state.js";
import { pullInBackground } from "../sync/auto.js";
import { syncServerStatus } from "../sync/status.js";
import type { AccountEntry, Profile } from "../types.js";
import { AccountAvatar } from "./AccountAvatar.js";
import { ConfirmModal } from "./ConfirmModal.js";
import { LastSyncedLine } from "./LastSyncedLine.js";
import { PageHeader } from "./PageHeader.js";
import { ProfileEditor } from "./ProfileEditor.js";
import { RotationPanel } from "./RotationPanel.js";

export function AccountsView() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    void api
      .listAccounts()
      .then((r) => {
        allAccounts.value = r.entries;
        if (selectedAccount.value === null && r.entries.length > 0) {
          selectedAccount.value = r.entries[0] ?? null;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return allAccounts.value;
    return allAccounts.value.filter(
      (e) => e.domain.includes(q) || e.username.toLowerCase().includes(q),
    );
  }, [query, allAccounts.value]);

  const onCreate = useCallback(() => {
    activeDomain.value = null;
    activeEmail.value = "";
    view.value = "generator";
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await pullInBackground();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  // The refresh button only makes sense when a sync session is
  // configured. `syncServerStatus === "disconnected"` means no
  // approved session — hide the button instead of failing silently.
  const syncReady = syncServerStatus.value !== "disconnected";

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={t("accounts_title")}
        subtitle={t("accounts_count", String(allAccounts.value.length))}
        actions={
          <>
            {syncReady ? (
              <motion.button
                type="button"
                class="btn btn-ghost btn-sm"
                whileTap={TAP_SCALE}
                onClick={onRefresh}
                disabled={refreshing}
                aria-label={t("accounts_refresh")}
                title={t("accounts_refresh")}
              >
                <motion.span
                  animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
                  transition={
                    refreshing
                      ? { repeat: Infinity, duration: 0.8, ease: "linear" }
                      : { duration: 0.15 }
                  }
                  class="grid place-items-center"
                >
                  <IconRefresh size={14} />
                </motion.span>
                {refreshing ? t("accounts_refreshing") : t("accounts_refresh")}
              </motion.button>
            ) : null}
            <motion.button type="button" class="btn btn-sm" whileTap={TAP_SCALE} onClick={onCreate}>
              <IconPlus size={14} />
              {t("common_new")}
            </motion.button>
          </>
        }
      />

      <div class="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "320px 1fr" }}>
        <aside class="flex flex-col border-r border-(--color-line)/60 min-h-0">
          <div class="px-4 py-3 border-b border-(--color-line)/60">
            <div class="flex items-center gap-2 px-3 py-2 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) focus-within:border-(--color-accent-500)/60">
              <IconSearch size={14} />
              <input
                type="text"
                class="flex-1 bg-transparent outline-none text-sm text-(--color-ink) placeholder:text-(--color-ink-subtle)"
                placeholder={t("accounts_search_placeholder")}
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto p-2">
            {loading ? (
              <ul class="flex flex-col gap-1.5 p-2">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} class="skeleton h-12 w-full rounded-2xl" />
                ))}
              </ul>
            ) : matches.length === 0 ? (
              <EmptyState
                title={
                  allAccounts.value.length === 0
                    ? t("accounts_empty_title")
                    : t("common_no_matches")
                }
                hint={
                  allAccounts.value.length === 0
                    ? t("accounts_empty_hint")
                    : t("accounts_no_matches_hint")
                }
              />
            ) : (
              <ul class="flex flex-col gap-1">
                {matches.map((entry) => (
                  <li key={`${entry.domain}|${entry.username}`}>
                    <AccountListItem
                      entry={entry}
                      active={
                        selectedAccount.value?.domain === entry.domain &&
                        selectedAccount.value?.username === entry.username
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section class="flex flex-col min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            {selectedAccount.value ? (
              <AccountDetail
                key={`${selectedAccount.value.domain}|${selectedAccount.value.username}`}
                entry={selectedAccount.value}
              />
            ) : (
              <motion.div
                key="empty"
                class="flex flex-1 items-center justify-center p-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <EmptyState title={t("accounts_pick_title")} hint={t("accounts_pick_hint")} />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}

function AccountListItem({ entry, active }: { entry: AccountEntry; active: boolean }) {
  return (
    <motion.button
      type="button"
      whileTap={TAP_SCALE}
      onClick={() => {
        selectedAccount.value = entry;
      }}
      class={
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer bg-transparent border-0 text-left transition-colors duration-150 " +
        (active
          ? "bg-(--color-surface-elev) ring-1 ring-(--color-accent-500)/40"
          : "hover:bg-(--color-surface-elev)/70")
      }
    >
      <AccountAvatar domain={entry.domain} size={32} />
      <div class="flex flex-col min-w-0 flex-1">
        <span class="text-sm text-(--color-ink) truncate font-medium tracking-[-0.01em]">
          {entry.domain.replace(/^www\./, "")}
        </span>
        <span class="text-xs text-(--color-ink-muted) truncate">{entry.username}</span>
      </div>
    </motion.button>
  );
}

function AccountDetail({ entry }: { entry: AccountEntry }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(entry.profile);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Username editing mirrors the extension's AccountDetailScreen: a
  // pre-submit callout previews the about-to-change derived password
  // so the user understands renaming is a destructive op (the
  // derivation eats the username, so a new username == new
  // password). They get a Show/Hide/Copy on the preview before
  // committing.
  const [usernameDraft, setUsernameDraft] = useState(entry.username);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameToast, setRenameToast] = useState<string | null>(null);
  const [previewPassword, setPreviewPassword] = useState<string | null>(null);
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const [previewCopied, setPreviewCopied] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    setUsernameDraft(entry.username);
    setRenameError(null);
    setRenameToast(null);
    setPreviewPassword(null);
    setPreviewRevealed(false);
    setPreviewCopied(false);
  }, [entry.domain, entry.username]);

  const usernameDirty = usernameDraft.trim() !== entry.username && usernameDraft.trim().length > 0;

  // Recompute the future password whenever the draft changes, with
  // a short debounce so we don't run Argon2 on every keystroke.
  useEffect(() => {
    if (!usernameDirty) {
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
  }, [usernameDraft, usernameDirty, entry.domain, profile]);

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
      setBusy(true);
      try {
        const r = await api.generate(entry.domain, entry.username, withProfile);
        setPassword(r.password);
        setRevealed(false);
        setCopied(false);
      } catch (err) {
        errorMessage.value = describeError(err) || t("err_generation_failed");
      } finally {
        setBusy(false);
      }
    },
    [entry.domain, entry.username],
  );

  useEffect(() => {
    setProfile(entry.profile);
    setPassword(null);
    void regenerate(entry.profile);
  }, [entry.domain, entry.username]);

  const updateProfile = useCallback(
    async (next: Profile) => {
      setProfile(next);
      try {
        await api.updateAccountProfile(entry.domain, entry.username, next);
        allAccounts.value = allAccounts.value.map((e) =>
          e.domain === entry.domain && e.username === entry.username ? { ...e, profile: next } : e,
        );
      } catch {
        /* swallow */
      }
      await regenerate(next);
    },
    [entry.domain, entry.username, regenerate],
  );

  const addLink = useCallback(
    async (event: Event) => {
      event.preventDefault();
      const linked = linkDraft.trim().toLowerCase();
      if (linked.length === 0) return;
      setLinkError(null);
      try {
        const r = await api.linkAccountDomain(entry.domain, entry.username, linked);
        allAccounts.value = allAccounts.value.map((e) =>
          e.domain === entry.domain && e.username === entry.username ? r.entry : e,
        );
        selectedAccount.value = r.entry;
        setLinkDraft("");
      } catch (err) {
        setLinkError(describeError(err) || t("detail_link_failed"));
      }
    },
    [entry.domain, entry.username, linkDraft],
  );

  const removeLink = useCallback(
    async (linked: string) => {
      try {
        const r = await api.unlinkAccountDomain(entry.domain, entry.username, linked);
        allAccounts.value = allAccounts.value.map((e) =>
          e.domain === entry.domain && e.username === entry.username ? r.entry : e,
        );
        selectedAccount.value = r.entry;
      } catch {
        /* swallow */
      }
    },
    [entry.domain, entry.username],
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

  const performDelete = useCallback(async () => {
    try {
      await api.deleteAccount(entry.domain, entry.username);
      allAccounts.value = allAccounts.value.filter(
        (e) => !(e.domain === entry.domain && e.username === entry.username),
      );
      selectedAccount.value = allAccounts.value[0] ?? null;
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_delete_failed");
    } finally {
      setConfirmingDelete(false);
    }
  }, [entry.domain, entry.username]);

  const renameSubmit = useCallback(
    async (event: Event) => {
      event.preventDefault();
      setRenameError(null);
      const next = usernameDraft.trim();
      if (next.length === 0 || next === entry.username) return;
      setBusy(true);
      try {
        const r = await api.renameAccount(entry.domain, entry.username, next);
        const updated = r.entry;
        allAccounts.value = allAccounts.value.map((e) =>
          e.domain === entry.domain && e.username === entry.username ? updated : e,
        );
        selectedAccount.value = updated;
        // The derivation uses the username, so the derived password
        // just changed. Recompute right away and let the user copy
        // the freshly-derived value so they can update it on the
        // actual site.
        try {
          const r2 = await api.generate(updated.domain, updated.username, updated.profile);
          setPassword(r2.password);
          setRenameToast(r2.password);
          setRevealed(false);
          setTimeout(() => setRenameToast(null), 12_000);
        } catch {
          /* swallow — useEffect on entry will re-regenerate */
        }
      } catch (err) {
        setRenameError(describeError(err) || t("detail_rename_failed"));
      } finally {
        setBusy(false);
      }
    },
    [entry.domain, entry.username, usernameDraft],
  );

  return (
    <motion.div
      class="flex flex-col gap-6 p-8 min-h-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={SOFT_SPRING}
    >
      <header class="flex items-center gap-4">
        <AccountAvatar domain={entry.domain} size={52} />
        <div class="flex flex-col min-w-0 flex-1 gap-1">
          <h2 class="text-xl font-medium tracking-[-0.02em] text-(--color-ink) truncate">
            {entry.domain.replace(/^www\./, "")}
          </h2>
          <form class="flex items-center gap-2 min-w-0" onSubmit={renameSubmit}>
            <input
              type="text"
              class="input flex-1 min-w-0 !py-1 !text-sm"
              value={usernameDraft}
              autocomplete="off"
              onInput={(e) => setUsernameDraft((e.target as HTMLInputElement).value)}
              disabled={busy}
              aria-label={t("main_username_label")}
            />
            <AnimatePresence>
              {usernameDirty ? (
                <motion.button
                  key="save-username"
                  type="submit"
                  class="btn btn-sm"
                  whileTap={TAP_SCALE}
                  disabled={busy}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  <IconCheck size={14} />
                  {t("common_save")}
                </motion.button>
              ) : null}
            </AnimatePresence>
          </form>
          {renameError !== null ? (
            <span class="field-error" role="alert">
              {renameError}
            </span>
          ) : null}
        </div>
      </header>

      <AnimatePresence>
        {usernameDirty ? (
          <motion.div
            key="rename-warn"
            class="callout flex flex-col gap-2"
            role="status"
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <strong class="text-sm text-(--color-ink)">{t("detail_rename_warning_title")}</strong>
            <span class="text-xs text-(--color-ink-muted) leading-relaxed">
              {t("detail_rename_warning_body")}
            </span>
            {previewPassword !== null ? (
              <div class="flex flex-col gap-2 pt-2">
                <span class="field-label">{t("detail_rename_preview_label")}</span>
                <code
                  class={
                    previewRevealed
                      ? "font-mono text-sm break-all select-all text-(--color-ink)"
                      : "font-mono text-sm break-all select-all text-(--color-ink-muted) tracking-[0.15em]"
                  }
                >
                  {previewRevealed
                    ? previewPassword
                    : "•".repeat(Math.min(previewPassword.length, 24))}
                </code>
                <div class="flex gap-2 flex-wrap">
                  <motion.button
                    type="button"
                    class="btn btn-ghost btn-sm flex-1"
                    whileTap={TAP_SCALE}
                    onClick={() => setPreviewRevealed((v) => !v)}
                  >
                    {previewRevealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                    {previewRevealed ? t("common_hide") : t("common_reveal")}
                  </motion.button>
                  <motion.button
                    type="button"
                    class="btn btn-ghost btn-sm flex-1"
                    whileTap={TAP_SCALE}
                    onClick={copyPreview}
                  >
                    {previewCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {previewCopied ? t("common_copied") : t("common_copy")}
                  </motion.button>
                </div>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {renameToast !== null ? (
          <motion.div
            key="rename-toast"
            class="callout callout-info flex flex-col gap-2"
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <span class="text-sm">{t("detail_rename_password_changed")}</span>
            <code class="font-mono text-xs break-all select-all text-(--color-ink)">
              {renameToast}
            </code>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        class="flex flex-col gap-3 p-5 rounded-3xl bg-(--color-surface-elev) border border-(--color-line) shadow-[0_24px_48px_-24px_oklch(0_0_0/0.18)]"
        variants={POP_IN}
        initial="initial"
        animate="animate"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="mono-tag">{t("accounts_derived_password")}</span>
          {password ? (
            <span class="mono-tag !text-[9px] text-(--color-ink-subtle)">
              {t("accounts_chars", String(password.length))}
            </span>
          ) : null}
        </div>
        {busy ? (
          <div class="skeleton h-6 w-3/4 rounded-md" />
        ) : password === null ? (
          <span class="font-mono text-sm text-(--color-ink-subtle)">—</span>
        ) : (
          <code
            class={
              revealed
                ? "font-mono text-base break-all select-all cursor-text text-(--color-ink)"
                : "font-mono text-base break-all select-all cursor-text text-(--color-ink-muted) tracking-[0.18em]"
            }
          >
            {revealed ? password : "•".repeat(Math.min(password.length, 32))}
          </code>
        )}
        <div class="flex gap-2 flex-wrap">
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm"
            whileTap={TAP_SCALE}
            onClick={() => setRevealed((v) => !v)}
            disabled={password === null}
          >
            {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            {revealed ? t("common_hide") : t("common_reveal")}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-sm"
            whileTap={TAP_SCALE}
            onClick={copy}
            disabled={password === null}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? t("common_copied") : t("common_copy")}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm ml-auto"
            whileTap={TAP_SCALE}
            onClick={() => regenerate(profile)}
            disabled={busy}
            aria-label={t("main_recompute")}
          >
            <IconRefresh size={14} />
            {t("main_recompute")}
          </motion.button>
        </div>
      </motion.div>

      <section class="flex flex-col gap-3">
        <span class="field-label">{t("accounts_generation_profile")}</span>
        <div class="card !p-5">
          <ProfileEditor profile={profile} onChange={updateProfile} />
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <span class="field-label">{t("detail_linked_section")}</span>
        <div class="card !p-5 flex flex-col gap-3">
          <span class="text-xs text-(--color-ink-muted) leading-relaxed">
            {t("detail_linked_hint")}
          </span>
          {entry.linkedDomains && entry.linkedDomains.length > 0 ? (
            <ul class="flex flex-col gap-1.5">
              {entry.linkedDomains.map((linked) => (
                <li
                  key={linked}
                  class="flex items-center justify-between gap-2 rounded-xl bg-(--color-surface-sunken) border border-(--color-line) px-3 py-2"
                >
                  <span class="font-mono text-xs truncate text-(--color-ink)">{linked}</span>
                  <motion.button
                    type="button"
                    class="btn btn-quiet btn-sm"
                    whileTap={TAP_SCALE}
                    onClick={() => void removeLink(linked)}
                  >
                    {t("detail_linked_remove")}
                  </motion.button>
                </li>
              ))}
            </ul>
          ) : (
            <span class="text-xs text-(--color-ink-subtle)">{t("detail_linked_empty")}</span>
          )}
          <form class="flex gap-2" onSubmit={addLink}>
            <input
              type="text"
              class="input flex-1"
              inputMode="url"
              autocomplete="off"
              placeholder={t("detail_linked_placeholder")}
              value={linkDraft}
              onInput={(e) => setLinkDraft((e.target as HTMLInputElement).value)}
            />
            <motion.button
              type="submit"
              class="btn btn-sm"
              whileTap={TAP_SCALE}
              disabled={linkDraft.trim().length === 0}
            >
              {t("detail_linked_add")}
            </motion.button>
          </form>
          {linkError !== null ? (
            <span class="text-xs text-(--color-danger)">{linkError}</span>
          ) : null}
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <RotationPanel
          entry={entry}
          onUpdated={(next) => {
            allAccounts.value = allAccounts.value.map((e) =>
              e.domain === entry.domain && e.username === entry.username ? next : e,
            );
            selectedAccount.value = next;
            setProfile(next.profile);
            void regenerate(next.profile);
          }}
        />
      </section>

      <footer class="flex items-center justify-between gap-3 pt-4 border-t border-(--color-line)/60">
        <LastSyncedLine domain={entry.domain} username={entry.username} />
        <motion.button
          type="button"
          class="btn btn-danger btn-sm"
          whileTap={TAP_SCALE}
          onClick={() => setConfirmingDelete(true)}
        >
          <IconTrash size={14} />
          {t("accounts_delete")}
        </motion.button>
      </footer>

      {confirmingDelete ? (
        <ConfirmModal
          title={t("accounts_delete_confirm_title")}
          body={t("accounts_delete_confirm_body")}
          confirmLabel={t("accounts_delete")}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void performDelete()}
        />
      ) : null}
    </motion.div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div class="flex flex-col items-center text-center gap-2 px-6 py-12 max-w-sm mx-auto">
      <span class="grid place-items-center w-12 h-12 rounded-2xl bg-(--color-surface-sunken) border border-(--color-line) text-(--color-ink-subtle)">
        <IconSearch size={18} />
      </span>
      <h3 class="text-sm font-medium text-(--color-ink)">{title}</h3>
      <p class="text-xs leading-relaxed text-(--color-ink-muted)">{hint}</p>
    </div>
  );
}
