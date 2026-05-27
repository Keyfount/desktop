import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { IconLock, IconChevronDown, IconChevronRight } from "../../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { detectPlatform } from "../../platform.js";
import {
  allAccounts,
  defaultProfile,
  errorMessage,
  faviconFallbackEnabled,
  historyEnabled,
  view,
} from "../../state.js";
import { clearSession, disconnect, loadStoredSession } from "../../sync/manager.js";
import { syncServerStatus } from "../../sync/status.js";
import type { GetStateResponse, Profile } from "../../types.js";
import { ProfileEditor } from "../../components/ProfileEditor.js";

interface Props {
  onLock?: () => void;
}

const SECTION_CLASSES =
  "rounded-2xl bg-(--color-surface-elev) border border-(--color-line) overflow-hidden flex flex-col";
const ROW_CLASSES =
  "w-full flex items-center justify-between px-4 py-3.5 text-left bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink) border-b border-(--color-line) last:border-b-0";

export function MobileSettingsScreen({ onLock }: Props) {
  const [state, setState] = useState<GetStateResponse | null>(null);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [showDefaultProfile, setShowDefaultProfile] = useState(false);

  useEffect(() => {
    void api.getState().then(setState);
    void api.autofillStatus().then((r) => setAutofillEnabled(r.enabled));
    void api
      .biometricAvailable()
      .then((r) => {
        setBiometricSupported(r.supported);
        setBiometricEnrolled(r.enrolled);
        setBiometricEnabled(r.vaultEnrolled);
      })
      .catch(() => {
        setBiometricSupported(false);
        setBiometricEnrolled(false);
        setBiometricEnabled(false);
      });
  }, []);

  const setDefault = useCallback(async (next: Profile) => {
    await api.setDefaultProfile(next);
    defaultProfile.value = next;
    setState((s) => (s ? { ...s, defaultProfile: next } : s));
  }, []);

  // History confirmation state
  const [historyConfirm, setHistoryConfirm] = useState<{
    accountCount: number;
    syncConnected: boolean;
  } | null>(null);

  const toggleHistory = useCallback(async (next: boolean) => {
    if (next) {
      await api.setHistoryEnabled(true);
      historyEnabled.value = true;
      setState((s) => (s ? { ...s, historyEnabled: true } : s));
      return;
    }
    // Disabling: probe what's at stake first.
    let accountCount = 0;
    try {
      const r = await api.listAccounts();
      accountCount = r.entries.length;
    } catch {
      /* swallow */
    }
    let syncConnected = false;
    try {
      const s = await loadStoredSession();
      syncConnected = s !== null && s.status === "approved";
    } catch {
      /* swallow */
    }
    if (accountCount === 0 && !syncConnected) {
      // Nothing to lose — just flip the toggle.
      await api.setHistoryEnabled(false);
      historyEnabled.value = false;
      setState((s) => (s ? { ...s, historyEnabled: false } : s));
      return;
    }
    setHistoryConfirm({ accountCount, syncConnected });
  }, []);

  const confirmDisableHistory = useCallback(async () => {
    if (historyConfirm === null) return;
    try {
      if (historyConfirm.syncConnected) {
        await disconnect();
      } else {
        await clearSession().catch(() => {});
      }
      const fresh = await api.listAccounts();
      for (const e of fresh.entries) {
        await api.deleteAccount(e.domain, e.username, { skipBus: true });
      }
      allAccounts.value = [];
      await api.setHistoryEnabled(false);
      historyEnabled.value = false;
      setState((s) => (s ? { ...s, historyEnabled: false } : s));
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_history_toggle_failed");
    } finally {
      setHistoryConfirm(null);
    }
  }, [historyConfirm]);

  const biometricToggleLabel = () => {
    const p = detectPlatform();
    if (p === "macos" || p === "ios") return t("biometric_toggle_label_touchid");
    if (p === "windows") return t("biometric_toggle_label_windowshello");
    return t("biometric_toggle_label");
  };

  if (state === null) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        class="flex flex-col gap-4 pt-2 pb-6"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} class="skeleton h-20 w-full rounded-2xl" />
        ))}
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="flex flex-col pt-2 pb-12 select-none"
    >
      {/* 1. Default Profile Section */}
      <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pt-4 pb-2 font-mono">
        {t("settings_default_profile")}
      </h2>
      <div class={SECTION_CLASSES}>
        <button
          type="button"
          class={ROW_CLASSES}
          onClick={() => setShowDefaultProfile((v) => !v)}
        >
          <span class="font-medium">{t("settings_default_profile")}</span>
          <motion.span
            animate={{ rotate: showDefaultProfile ? 180 : 0 }}
            transition={SOFT_SPRING}
          >
            <IconChevronDown size={16} />
          </motion.span>
        </button>
        <AnimatePresence>
          {showDefaultProfile ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SOFT_SPRING}
              class="border-t border-(--color-line) bg-(--color-surface-sunken)/40 p-4"
            >
              <ProfileEditor profile={state.defaultProfile} onChange={setDefault} compact />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* 2. Security Section */}
      <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pt-6 pb-2 font-mono">
        {t("mobile_settings_section_lock")}
      </h2>
      <div class={SECTION_CLASSES}>
        {/* Auto Lock */}
        <div class={ROW_CLASSES}>
          <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
            <span class="font-medium">{t("settings_auto_lock")}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <input
              type="number"
              min={0}
              max={240}
              value={state.autoLockMinutes}
              onInput={async (e) => {
                const val = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(val)) {
                  const bounded = Math.max(0, Math.min(240, Math.floor(val)));
                  await api.setAutoLockMinutes(bounded);
                  setState({ ...state, autoLockMinutes: bounded });
                }
              }}
              class="w-16 h-8 rounded-lg bg-(--color-surface-sunken) text-center text-[15px] font-semibold text-(--color-ink) border border-(--color-line) outline-none focus:border-(--color-accent-500) transition-colors"
            />
            <span class="text-xs text-(--color-ink-muted)">min</span>
          </div>
        </div>

        {/* Clipboard Clear */}
        <div class={ROW_CLASSES}>
          <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
            <span class="font-medium">{t("settings_clipboard_clear")}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <input
              type="number"
              min={0}
              max={600}
              value={state.clipboardClearSeconds}
              onInput={async (e) => {
                const val = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(val)) {
                  const bounded = Math.max(0, Math.min(600, Math.floor(val)));
                  await api.setClipboardClearSeconds(bounded);
                  setState({ ...state, clipboardClearSeconds: bounded });
                }
              }}
              class="w-16 h-8 rounded-lg bg-(--color-surface-sunken) text-center text-[15px] font-semibold text-(--color-ink) border border-(--color-line) outline-none focus:border-(--color-accent-500) transition-colors"
            />
            <span class="text-xs text-(--color-ink-muted)">s</span>
          </div>
        </div>

        {/* Biometrics */}
        {biometricSupported ? (
          <div class={ROW_CLASSES}>
            <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
              <span class="font-medium">{biometricToggleLabel()}</span>
              <span class="text-xs text-(--color-ink-subtle)">
                {biometricEnrolled ? t("biometric_toggle_hint") : t("biometric_toggle_not_enrolled_hint")}
              </span>
            </div>
            <label class="switch shrink-0">
              <input
                type="checkbox"
                checked={biometricEnabled}
                disabled={!biometricEnrolled}
                onChange={async (e) => {
                  const active = (e.target as HTMLInputElement).checked;
                  try {
                    if (active) {
                      await api.enableBiometric();
                    } else {
                      await api.disableBiometric();
                    }
                    setBiometricEnabled(active);
                    errorMessage.value = null;
                  } catch (err) {
                    const raw = describeError(err);
                    errorMessage.value = raw.toLowerCase().includes("unsupported")
                      ? t("biometric_unsupported")
                      : t("biometric_toggle_failed", raw);
                  }
                }}
              />
              <span class="switch-track" />
              <span class="switch-thumb" />
            </label>
          </div>
        ) : null}

        {/* Lock App Row */}
        <button type="button" data-action="lock" class={`${ROW_CLASSES} !text-red-500 font-medium`} onClick={onLock}>
          <div class="flex items-center gap-2">
            <IconLock size={16} />
            <span>{t("sidebar_lock")}</span>
          </div>
          <IconChevronRight size={16} class="opacity-50" />
        </button>
      </div>

      {/* 3. History & Favicon Section */}
      <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pt-6 pb-2 font-mono">
        {t("mobile_settings_section_data")}
      </h2>
      <div class={SECTION_CLASSES}>
        {/* Remember accounts history */}
        <div class={ROW_CLASSES}>
          <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
            <span class="font-medium">{t("settings_history_label")}</span>
            <span class="text-xs text-(--color-ink-subtle)">{t("settings_history_hint")}</span>
          </div>
          <label class="switch shrink-0">
            <input
              type="checkbox"
              checked={state.historyEnabled}
              onChange={(e) => void toggleHistory((e.target as HTMLInputElement).checked)}
            />
            <span class="switch-track" />
            <span class="switch-thumb" />
          </label>
        </div>

        {/* Favicons */}
        <div class={ROW_CLASSES}>
          <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
            <span class="font-medium">{t("settings_favicon_label")}</span>
            <span class="text-xs text-(--color-ink-subtle)">{t("settings_favicon_hint")}</span>
          </div>
          <label class="switch shrink-0">
            <input
              type="checkbox"
              checked={state.faviconFallbackEnabled}
              onChange={async (e) => {
                const active = (e.target as HTMLInputElement).checked;
                await api.setFaviconFallbackEnabled(active);
                faviconFallbackEnabled.value = active;
                setState({ ...state, faviconFallbackEnabled: active });
              }}
            />
            <span class="switch-track" />
            <span class="switch-thumb" />
          </label>
        </div>

        {/* Autofill */}
        <div class={ROW_CLASSES}>
          <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
            <span class="font-medium">{t("settings_autofill_label")}</span>
            <span class="text-xs text-(--color-ink-subtle)">{t("settings_autofill_hint")}</span>
          </div>
          <label class="switch shrink-0">
            <input
              type="checkbox"
              checked={autofillEnabled}
              onChange={async (e) => {
                const active = (e.target as HTMLInputElement).checked;
                try {
                  if (active) {
                    await api.enableAutofill();
                  } else {
                    await api.disableAutofill();
                  }
                  setAutofillEnabled(active);
                } catch (err) {
                  errorMessage.value = describeError(err) || t("err_autofill_toggle_failed");
                }
              }}
            />
            <span class="switch-track" />
            <span class="switch-thumb" />
          </label>
        </div>
      </div>

      {/* 4. Sync & Vaults Section */}
      <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pt-6 pb-2 font-mono">
        {t("mobile_settings_section_sync")}
      </h2>
      <div class={SECTION_CLASSES}>
        {/* Sync View Link */}
        <button
          type="button"
          class={ROW_CLASSES}
          onClick={() => { view.value = "sync"; }}
        >
          <div class="flex items-center gap-2">
            <span
              class={
                "inline-block h-2.5 w-2.5 rounded-full " +
                (syncServerStatus.value === "online"
                  ? "bg-emerald-500"
                  : syncServerStatus.value === "offline"
                    ? "bg-red-500"
                    : "bg-amber-400")
              }
            />
            <span class="font-medium">{t("settings_sync")}</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-(--color-ink-subtle)">
            <span>
              {syncServerStatus.value === "online" ? t("sync_status_dot_online")
                : syncServerStatus.value === "offline" ? t("sync_status_dot_offline")
                : syncServerStatus.value === "checking" ? t("sync_status_dot_checking")
                : ""}
            </span>
            <IconChevronRight size={16} class="opacity-50" />
          </div>
        </button>
      </div>

      <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pt-6 pb-2 font-mono">
        {t("settings_vaults")}
      </h2>
      <div class={SECTION_CLASSES}>
        {/* Vaults View Link */}
        <button
          type="button"
          class={ROW_CLASSES}
          onClick={() => { view.value = "vaults"; }}
        >
          <span class="font-medium">{t("settings_vaults_hint")}</span>
          <IconChevronRight size={16} class="opacity-50" />
        </button>
      </div>

      {/* About Section */}
      <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pt-6 pb-2 font-mono">
        {t("mobile_settings_section_about")}
      </h2>
      <div class={SECTION_CLASSES}>
        <div class={ROW_CLASSES}>
          <span>Keyfount</span>
          <span class="text-xs text-(--color-ink-subtle)">v0.1.0</span>
        </div>
      </div>

      {errorMessage.value !== null ? (
        <div class="text-xs text-(--color-danger) mt-4 px-2" role="alert">
          {errorMessage.value}
        </div>
      ) : null}

      {/* Confirmation Modal for Disabling History */}
      {historyConfirm !== null ? (
        <HistoryDisableModal
          accountCount={historyConfirm.accountCount}
          syncConnected={historyConfirm.syncConnected}
          onCancel={() => setHistoryConfirm(null)}
          onConfirm={() => void confirmDisableHistory()}
        />
      ) : null}
    </motion.section>
  );
}

function HistoryDisableModal({
  accountCount,
  syncConnected,
  onCancel,
  onConfirm,
}: {
  accountCount: number;
  syncConnected: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const body =
    accountCount > 0 && syncConnected
      ? t("settings_history_disable_body_both", String(accountCount))
      : accountCount > 0
        ? t("settings_history_disable_body_accounts", String(accountCount))
        : t("settings_history_disable_body_sync");

  return (
    <div
      class="fixed inset-0 z-[200] grid place-items-center bg-black/50 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        class="card !p-5 w-full max-w-sm flex flex-col gap-4 shadow-xl"
        variants={POP_IN}
        initial="initial"
        animate="animate"
      >
        <h2 class="text-base font-semibold text-(--color-ink)">
          {t("settings_history_disable_title")}
        </h2>
        <p class="text-xs text-(--color-ink-muted) leading-relaxed">{body}</p>
        <div class="flex justify-end gap-2 pt-2 border-t border-(--color-line)/50">
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm"
            whileTap={TAP_SCALE}
            onClick={onCancel}
          >
            {t("common_cancel")}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-danger btn-sm"
            whileTap={TAP_SCALE}
            onClick={onConfirm}
          >
            {t("settings_history_disable_confirm")}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
