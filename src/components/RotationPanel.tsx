import { useCallback, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { IconCheck, IconCopy, IconEye, IconEyeOff } from "../icons.js";
import { POP_IN, TAP_SCALE } from "../motion.js";
import type { AccountEntry, Profile } from "../types.js";

interface Props {
  entry: AccountEntry;
  /**
   * Called after a successful rotation with the updated entry, so the
   * parent can patch its in-memory list and refresh the displayed
   * derived password.
   */
  onUpdated: (next: AccountEntry) => void;
  /** Tightens spacing on narrow mobile sheets. */
  compact?: boolean;
}

/**
 * Counter rotation flow. Bumps `profile.counter` by one, previews
 * both the current and the would-be password side by side so the
 * user can paste current + new into the "change password" form
 * most sites use, then persists on Confirm. Ported from the
 * extension's AccountDetailScreen rotation flow so the three
 * surfaces line up.
 */
export function RotationPanel({ entry, onUpdated, compact }: Props) {
  const [preview, setPreview] = useState<{ oldPassword: string; newPassword: string } | null>(
    null,
  );
  const [oldRevealed, setOldRevealed] = useState(false);
  const [newRevealed, setNewRevealed] = useState(false);
  const [copied, setCopied] = useState<"old" | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bumpedProfile = useCallback(
    (): Profile => ({
      ...entry.profile,
      counter: (entry.profile.counter ?? 1) + 1,
    }),
    [entry.profile],
  );

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const bumped = bumpedProfile();
      const [oldRes, newRes] = await Promise.all([
        api.generate(entry.domain, entry.username, entry.profile),
        api.generate(entry.domain, entry.username, bumped),
      ]);
      setPreview({ oldPassword: oldRes.password, newPassword: newRes.password });
      setOldRevealed(false);
      setNewRevealed(false);
      setCopied(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err_rotation_failed"));
    } finally {
      setBusy(false);
    }
  }, [entry.domain, entry.username, entry.profile, bumpedProfile]);

  const confirm = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const bumped = bumpedProfile();
      const r = await api.updateAccountProfile(entry.domain, entry.username, bumped);
      onUpdated(r.entry);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err_rotation_failed"));
    } finally {
      setBusy(false);
    }
  }, [entry.domain, entry.username, bumpedProfile, onUpdated]);

  const copyOne = useCallback(
    async (which: "old" | "new") => {
      if (preview === null) return;
      const value = which === "old" ? preview.oldPassword : preview.newPassword;
      try {
        await api.copyWithAutoClear(value);
        setCopied(which);
        setTimeout(() => setCopied(null), 1500);
      } catch {
        /* swallow */
      }
    },
    [preview],
  );

  const padding = compact ? "!p-4 gap-3" : "!p-5 gap-4";
  const codeSize = compact ? "text-sm" : "text-base";

  return (
    <div class="flex flex-col gap-2">
      <span class="field-label">{t("detail_rotate_section")}</span>
      <span class={`field-hint ${compact ? "text-[11px]" : ""}`}>{t("detail_rotate_hint")}</span>

      <AnimatePresence mode="wait">
        {preview === null ? (
          <motion.button
            key="start"
            type="button"
            class="btn btn-ghost btn-sm self-start"
            whileTap={TAP_SCALE}
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
            disabled={busy}
            onClick={() => void start()}
          >
            {t("detail_rotate_cta")}
          </motion.button>
        ) : (
          <motion.div
            key="preview"
            class={`card flex flex-col ${padding}`}
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <PasswordRow
              label={t("detail_rotate_old_label")}
              password={preview.oldPassword}
              revealed={oldRevealed}
              copied={copied === "old"}
              onToggleReveal={() => setOldRevealed((v) => !v)}
              onCopy={() => void copyOne("old")}
              codeSize={codeSize}
            />
            <PasswordRow
              label={t("detail_rotate_new_label")}
              password={preview.newPassword}
              revealed={newRevealed}
              copied={copied === "new"}
              onToggleReveal={() => setNewRevealed((v) => !v)}
              onCopy={() => void copyOne("new")}
              codeSize={codeSize}
            />
            <div class="flex gap-2 pt-2 border-t border-(--color-line)/50">
              <motion.button
                type="button"
                class="btn btn-sm flex-1"
                whileTap={TAP_SCALE}
                disabled={busy}
                onClick={() => void confirm()}
              >
                <IconCheck size={14} />
                {t("detail_rotate_confirm")}
              </motion.button>
              <motion.button
                type="button"
                class="btn btn-ghost btn-sm flex-1"
                whileTap={TAP_SCALE}
                onClick={() => setPreview(null)}
              >
                {t("common_cancel")}
              </motion.button>
            </div>
          </motion.div>
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

function PasswordRow({
  label,
  password,
  revealed,
  copied,
  onToggleReveal,
  onCopy,
  codeSize,
}: {
  label: string;
  password: string;
  revealed: boolean;
  copied: boolean;
  onToggleReveal: () => void;
  onCopy: () => void;
  codeSize: string;
}) {
  return (
    <div class="flex flex-col gap-2">
      <span class="field-label">{label}</span>
      <code
        class={
          revealed
            ? `font-mono ${codeSize} break-all select-all text-(--color-ink)`
            : `font-mono ${codeSize} break-all select-all text-(--color-ink-muted) tracking-[0.15em]`
        }
      >
        {revealed ? password : "•".repeat(Math.min(password.length, 24))}
      </code>
      <div class="flex gap-2">
        <motion.button
          type="button"
          class="btn btn-ghost btn-sm flex-1"
          whileTap={TAP_SCALE}
          onClick={onToggleReveal}
        >
          {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          {revealed ? t("common_hide") : t("common_reveal")}
        </motion.button>
        <motion.button
          type="button"
          class="btn btn-ghost btn-sm flex-1"
          whileTap={TAP_SCALE}
          onClick={onCopy}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          {copied ? t("common_copied") : t("common_copy")}
        </motion.button>
      </div>
    </div>
  );
}
