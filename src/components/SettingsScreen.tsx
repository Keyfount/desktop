import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { IconChevronRight } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { defaultProfile, errorMessage, fingerprint, historyEnabled, screen } from "../state.js";
import type { GetStateResponse, Profile } from "../types.js";
import { Header } from "./Header.js";
import { ProfileEditor } from "./ProfileEditor.js";

export function SettingsScreen() {
  const [state, setState] = useState<GetStateResponse | null>(null);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  useEffect(() => {
    void api.getState().then(setState);
    void api.autofillStatus().then((r) => setAutofillEnabled(r.enabled));
    void api.biometricAvailable().then((r) => setBiometricEnabled(r.supported && r.enrolled));
  }, []);

  const setDefault = useCallback(async (next: Profile) => {
    await api.setDefaultProfile(next);
    defaultProfile.value = next;
    setState((s) => (s ? { ...s, defaultProfile: next } : s));
  }, []);

  if (state === null) return null;

  return (
    <motion.div
      class="flex flex-col gap-5 p-6 max-w-md mx-auto pt-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={t("settings_title")}
        fingerprint={fingerprint.value}
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

      <Section title={t("settings_default_profile")}>
        <ProfileEditor profile={state.defaultProfile} onChange={setDefault} />
      </Section>

      <Section title={t("settings_history")}>
        <Toggle
          checked={state.historyEnabled}
          onChange={async (v) => {
            await api.setHistoryEnabled(v);
            historyEnabled.value = v;
            setState({ ...state, historyEnabled: v });
          }}
          label="Remember accounts I generate passwords for"
        />
      </Section>

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

      <Section title={t("settings_favicon_fallback")}>
        <Toggle
          checked={state.faviconFallbackEnabled}
          onChange={async (v) => {
            await api.setFaviconFallbackEnabled(v);
            setState({ ...state, faviconFallbackEnabled: v });
          }}
          label="Use Google's favicon service as a fallback"
        />
      </Section>

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
            } catch (err) {
              errorMessage.value = err instanceof Error ? err.message : "biometric toggle failed";
            }
          }}
          label="Unlock with Touch ID / Windows Hello"
        />
      </Section>

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
              errorMessage.value = err instanceof Error ? err.message : "autofill toggle failed";
            }
          }}
          label="Watch focused password fields and offer to fill them"
        />
      </Section>

      <Section title={t("settings_sync")}>
        <motion.button
          type="button"
          class="btn btn-ghost"
          whileTap={TAP_SCALE}
          onClick={() => {
            screen.value = "sync";
          }}
        >
          {t("common_open")} →
        </motion.button>
      </Section>

      <Section title="Vaults">
        <motion.button
          type="button"
          class="btn btn-ghost"
          whileTap={TAP_SCALE}
          onClick={() => {
            screen.value = "vaults";
          }}
        >
          {t("common_open")} →
        </motion.button>
      </Section>

      {errorMessage.value !== null ? (
        <div class="field-error" role="alert">
          {errorMessage.value}
        </div>
      ) : null}
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="flex flex-col gap-2">
      <span class="field-label">{title}</span>
      <div class="card !p-4">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label class="flex items-center gap-3 text-sm cursor-pointer">
      <span class="switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span class="switch-track" />
        <span class="switch-thumb" />
      </span>
      <span class="text-(--color-ink)">{label}</span>
    </label>
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
    <div class="flex items-center gap-3">
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
