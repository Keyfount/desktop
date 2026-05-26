import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { TAP_SCALE } from "../motion.js";
import {
  defaultProfile,
  errorMessage,
  faviconFallbackEnabled,
  historyEnabled,
  view,
} from "../state.js";
import type { GetStateResponse, Profile } from "../types.js";
import { PageHeader } from "./PageHeader.js";
import { ProfileEditor } from "./ProfileEditor.js";

export function SettingsScreen() {
  const [state, setState] = useState<GetStateResponse | null>(null);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);

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
              onChange={async (v) => {
                await api.setHistoryEnabled(v);
                historyEnabled.value = v;
                setState({ ...state, historyEnabled: v });
              }}
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
            <Section title={t("settings_biometric")}>
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
                label={t("biometric_toggle_label")}
                hint={
                  biometricEnrolled
                    ? t("biometric_toggle_hint")
                    : t("biometric_toggle_not_enrolled_hint")
                }
                disabled={!biometricEnrolled}
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
                  errorMessage.value = describeError(err) || "autofill toggle failed";
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
                view.value = "sync";
              }}
            />
            <LinkCard
              label={t("settings_vaults")}
              hint={t("settings_vaults_hint")}
              onClick={() => {
                view.value = "vaults";
              }}
            />
          </div>

          {errorMessage.value !== null ? (
            <div class="field-error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}
        </div>
      </div>
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
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div
      class={
        "card !p-4 flex items-start gap-3 " +
        (disabled ? "opacity-60 cursor-not-allowed" : "")
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
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-sm text-(--color-ink)">{label}</span>
        {hint ? <span class="field-hint">{hint}</span> : null}
      </div>
    </div>
  );
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
