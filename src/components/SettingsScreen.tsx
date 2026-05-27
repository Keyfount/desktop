import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconTouchId, IconWindowsHello } from "../icons.js";
import { POP_IN, TAP_SCALE } from "../motion.js";
import { detectPlatform } from "../platform.js";
import {
  allAccounts,
  defaultProfile,
  errorMessage,
  faviconFallbackEnabled,
  historyEnabled,
  view,
} from "../state.js";
import { clearSession, disconnect, loadStoredSession } from "../sync/manager.js";
import type { GetStateResponse, Profile } from "../types.js";
import { previousView } from "../state.js";
import { DangerZone } from "./DangerZone.js";
import { PageHeader } from "./PageHeader.js";
import { PinManager } from "./PinManager.js";
import { ProfileEditor } from "./ProfileEditor.js";
import { VaultExportImport } from "./VaultExportImport.js";

export function SettingsScreen() {
  const [state, setState] = useState<GetStateResponse | null>(null);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);

  const refreshState = useCallback(async () => {
    try {
      const next = await api.getState();
      setState(next);
    } catch {
      /* swallow — surface via the existing error path if needed */
    }
  }, []);

  useEffect(() => {
    void refreshState();
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
  }, [refreshState]);

  const setDefault = useCallback(async (next: Profile) => {
    await api.setDefaultProfile(next);
    defaultProfile.value = next;
    setState((s) => (s ? { ...s, defaultProfile: next } : s));
  }, []);

  // Disabling "remember accounts" wipes everything that only made
  // sense with history on — the saved (domain, username) pairs and
  // the sync session that propagates them. Surface a modal first so
  // the user sees exactly what's about to disappear; the body text
  // adapts to whichever combination of [accounts, sync] is non-empty.
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
      if (view.value === "accounts" || view.value === "sync") {
        view.value = "generator";
      }
      return;
    }
    setHistoryConfirm({ accountCount, syncConnected });
  }, []);

  const confirmDisableHistory = useCallback(async () => {
    if (historyConfirm === null) return;
    try {
      // Sync goes first so the local deletes don't immediately
      // re-push as `delete_account` events on a session we're about
      // to drop anyway.
      if (historyConfirm.syncConnected) {
        await disconnect();
      } else {
        // Be defensive even if we thought there was no session.
        await clearSession().catch(() => {});
      }
      // Wipe accounts. We re-fetch the list to guard against races
      // (the user could have created accounts since we probed).
      const fresh = await api.listAccounts();
      for (const e of fresh.entries) {
        await api.deleteAccount(e.domain, e.username, { skipBus: true });
      }
      allAccounts.value = [];
      await api.setHistoryEnabled(false);
      historyEnabled.value = false;
      setState((s) => (s ? { ...s, historyEnabled: false } : s));
      if (view.value === "accounts" || view.value === "sync") {
        view.value = "generator";
      }
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_history_toggle_failed");
    } finally {
      setHistoryConfirm(null);
    }
  }, [historyConfirm]);

  if (state === null) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title={t("settings_title")} subtitle={t("common_preferences")} />
        <div class="p-8 mx-auto w-full max-w-3xl flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} class="skeleton h-16 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader title={t("settings_title")} subtitle={t("common_preferences")} />

      <div class="flex-1 overflow-y-auto px-8 py-8">
        <div class="mx-auto w-full max-w-3xl flex flex-col gap-6">
          <Section title={t("settings_default_profile")}>
            <div class="card !p-5">
              <ProfileEditor profile={state.defaultProfile} onChange={setDefault} />
            </div>
          </Section>

          <div class="grid grid-cols-2 gap-4">
            <Section title={t("settings_auto_lock")}>
              <NumberRow
                value={state.autoLockMinutes}
                unit="min"
                min={0}
                max={240}
                onChange={async (n) => {
                  await api.setAutoLockMinutes(n);
                  setState({ ...state, autoLockMinutes: n });
                }}
              />
            </Section>

            <Section title={t("settings_clipboard_clear")}>
              <NumberRow
                value={state.clipboardClearSeconds}
                unit="s"
                min={0}
                max={600}
                onChange={async (n) => {
                  await api.setClipboardClearSeconds(n);
                  setState({ ...state, clipboardClearSeconds: n });
                }}
              />
            </Section>
          </div>

          <Section title={t("settings_history")}>
            <Toggle
              checked={state.historyEnabled}
              onChange={(v) => void toggleHistory(v)}
              label={t("settings_history_label")}
              hint={t("settings_history_hint")}
            />
          </Section>

          <Section title={t("settings_favicon_fallback")}>
            <Toggle
              checked={state.faviconFallbackEnabled}
              onChange={async (v) => {
                await api.setFaviconFallbackEnabled(v);
                faviconFallbackEnabled.value = v;
                setState({ ...state, faviconFallbackEnabled: v });
              }}
              label={t("settings_favicon_label")}
              hint={t("settings_favicon_hint")}
            />
          </Section>

          {biometricSupported ? (
            <Section title={biometricSectionTitle()}>
              <Toggle
                checked={biometricEnabled}
                onChange={async (v) => {
                  try {
                    if (v) {
                      await api.enableBiometric();
                    } else {
                      await api.disableBiometric();
                    }
                    setBiometricEnabled(v);
                    errorMessage.value = null;
                  } catch (err) {
                    const raw = describeError(err);
                    errorMessage.value = raw.toLowerCase().includes("unsupported")
                      ? t("biometric_unsupported")
                      : t("biometric_toggle_failed", raw);
                  }
                }}
                label={biometricToggleLabel()}
                hint={
                  biometricEnrolled
                    ? t("biometric_toggle_hint")
                    : t("biometric_toggle_not_enrolled_hint")
                }
                disabled={!biometricEnrolled}
                icon={biometricIcon()}
              />
            </Section>
          ) : null}

          <Section title={t("settings_autofill")}>
            <Toggle
              checked={autofillEnabled}
              onChange={async (v) => {
                try {
                  if (v) {
                    await api.enableAutofill();
                  } else {
                    await api.disableAutofill();
                  }
                  setAutofillEnabled(v);
                } catch (err) {
                  errorMessage.value = describeError(err) || t("err_autofill_toggle_failed");
                }
              }}
              label={t("settings_autofill_label")}
              hint={t("settings_autofill_hint")}
            />
          </Section>

          <div class="grid grid-cols-2 gap-4">
            <LinkCard
              label={t("settings_sync")}
              hint={t("settings_sync_hint")}
              onClick={() => {
                previousView.value = "settings";
                view.value = "sync";
              }}
            />
            <LinkCard
              label={t("settings_vaults")}
              hint={t("settings_vaults_hint")}
              onClick={() => {
                previousView.value = "settings";
                view.value = "vaults";
              }}
            />
          </div>

          <Section title={t("pin_section_title")}>
            <div class="card !p-5 flex flex-col gap-3">
              <p class="text-xs text-(--color-ink-muted) leading-relaxed">
                {t("pin_section_hint")}
              </p>
              <PinManager hasPin={state.hasPin} onChange={refreshState} />
            </div>
          </Section>

          <Section title={t("export_section_title")}>
            <div class="card !p-5">
              <VaultExportImport onImported={refreshState} />
            </div>
          </Section>

          <Section title={t("settings_danger")}>
            <div class="card !p-5 border border-red-500/30">
              <DangerZone />
            </div>
          </Section>

          {errorMessage.value !== null ? (
            <div class="field-error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}
        </div>
      </div>

      {historyConfirm !== null ? (
        <HistoryDisableModal
          accountCount={historyConfirm.accountCount}
          syncConnected={historyConfirm.syncConnected}
          onCancel={() => setHistoryConfirm(null)}
          onConfirm={() => void confirmDisableHistory()}
        />
      ) : null}
    </div>
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
      class="fixed inset-0 z-[200] grid place-items-center bg-(--color-surface)/70 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        class="card !p-6 w-full max-w-md flex flex-col gap-4"
        variants={POP_IN}
        initial="initial"
        animate="animate"
      >
        <h2 class="text-lg font-medium text-(--color-ink)">
          {t("settings_history_disable_title")}
        </h2>
        <p class="text-sm text-(--color-ink-muted) leading-relaxed">{body}</p>
        <div class="flex justify-end gap-2 pt-2">
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

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="flex flex-col gap-2">
      <span class="field-label">{title}</span>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  icon,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  icon?: ComponentChildren;
}) {
  return (
    <div
      class={
        "card !p-4 flex items-start gap-3 " + (disabled ? "opacity-60 cursor-not-allowed" : "")
      }
    >
      <label class="switch shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span class="switch-track" />
        <span class="switch-thumb" />
      </label>
      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
        <span class="text-sm text-(--color-ink) flex items-center gap-2">
          {icon}
          {label}
        </span>
        {hint ? <span class="field-hint">{hint}</span> : null}
      </div>
    </div>
  );
}

// Biometric section labels follow the host OS — Touch ID on macOS,
// Windows Hello on Windows. Falls back to the generic "biometric"
// string on platforms where we don't have an established product
// name (Linux, mobile).
function biometricSectionTitle(): string {
  const p = detectPlatform();
  if (p === "macos") return t("settings_biometric_macos");
  if (p === "windows") return t("settings_biometric_windows");
  return t("settings_biometric");
}

function biometricToggleLabel(): string {
  const p = detectPlatform();
  if (p === "macos") return t("biometric_toggle_label_touchid");
  if (p === "windows") return t("biometric_toggle_label_windowshello");
  return t("biometric_toggle_label");
}

function biometricIcon(): ComponentChildren {
  const p = detectPlatform();
  if (p === "macos") return <IconTouchId size={16} />;
  if (p === "windows") return <IconWindowsHello size={16} />;
  return null;
}

function NumberRow({
  value,
  unit,
  min,
  max,
  onChange,
}: {
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div class="card !p-4 flex items-center gap-3">
      <input
        type="number"
        min={min}
        max={max}
        class="input w-24 text-center"
        value={value}
        onInput={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, Math.floor(v))));
        }}
      />
      <span class="text-(--color-ink-muted) text-sm">{unit}</span>
    </div>
  );
}

function LinkCard({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      class="card !p-4 cursor-pointer text-left flex flex-col gap-1 bg-transparent"
      whileTap={TAP_SCALE}
      onClick={onClick}
    >
      <span class="text-sm font-medium text-(--color-ink)">{label} →</span>
      <span class="field-hint">{hint}</span>
    </motion.button>
  );
}
