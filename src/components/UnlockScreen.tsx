import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconTouchId, IconWindowsHello } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { detectPlatform } from "../platform.js";
import {
  busy,
  defaultProfile,
  errorMessage,
  fingerprint,
  historyEnabled,
  screen,
  view,
} from "../state.js";
import { Header } from "./Header.js";

interface Props {
  hasPin: boolean;
}

export function UnlockScreen({ hasPin }: Props) {
  const [mode, setMode] = useState<"master" | "pin">("master");
  const [value, setValue] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    if (hasPin && mode === "master") setMode("master");
  }, [hasPin]);

  useEffect(() => {
    void api
      .biometricAvailable()
      .then((r) => setBioAvailable(r.supported && r.enrolled && r.vaultEnrolled))
      .catch(() => setBioAvailable(false));
  }, []);

  const submit = useCallback(
    async (event: Event) => {
      event.preventDefault();
      errorMessage.value = null;
      busy.value = true;
      try {
        const response =
          mode === "master" ? await api.unlock(value) : await api.unlockWithPin(value);
        fingerprint.value = response.fingerprint;
        const state = await api.getState();
        historyEnabled.value = state.historyEnabled;
        defaultProfile.value = state.defaultProfile;
        view.value = "generator";
        screen.value = "shell";
      } catch (err) {
        errorMessage.value = describeError(err) || "unlock failed";
      } finally {
        busy.value = false;
      }
    },
    [mode, value],
  );

  const onBiometric = useCallback(async () => {
    errorMessage.value = null;
    busy.value = true;
    try {
      await api.unlockBiometric();
      const status = await api.status();
      fingerprint.value = status.fingerprint;
      const state = await api.getState();
      historyEnabled.value = state.historyEnabled;
      defaultProfile.value = state.defaultProfile;
      view.value = "generator";
      screen.value = "shell";
    } catch (err) {
      errorMessage.value = describeError(err) || "biometric unlock failed";
    } finally {
      busy.value = false;
    }
  }, []);

  return (
    <motion.form
      class="flex flex-col gap-4 p-6 max-w-md mx-auto pt-12"
      onSubmit={submit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header subtitle={t("unlock_title")} fingerprint={fingerprint.value} />

      <p class="text-(--color-ink-muted) text-sm leading-relaxed">
        {mode === "master" ? t("unlock_subtitle") : t("unlock_pin_subtitle")}
      </p>

      <label class="flex flex-col gap-2">
        <span class="field-label">
          {mode === "master" ? t("setup_master_label") : t("settings_pin")}
        </span>
        <input
          class="input"
          type="password"
          inputMode={mode === "pin" ? "numeric" : "text"}
          autoFocus
          value={value}
          autocomplete="current-password"
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        />
      </label>

      <AnimatePresence>
        {errorMessage.value !== null ? (
          <motion.div
            key="error"
            class="field-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
          >
            {errorMessage.value}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.button type="submit" class="btn" whileTap={TAP_SCALE} disabled={busy.value}>
        {t("unlock_button")}
      </motion.button>

      {hasPin ? (
        <motion.button
          type="button"
          class="btn btn-ghost"
          whileTap={TAP_SCALE}
          onClick={() => {
            setMode(mode === "master" ? "pin" : "master");
            setValue("");
          }}
        >
          {mode === "master" ? t("unlock_use_pin") : t("unlock_use_master")}
        </motion.button>
      ) : null}

      {bioAvailable ? <BiometricButton onClick={onBiometric} /> : null}
    </motion.form>
  );
}

/**
 * Biometric-unlock CTA whose label + glyph match the host OS:
 * Touch ID on macOS, Windows Hello on Windows, generic otherwise.
 * Lets the user recognise the system prompt they're about to see
 * instead of staring at an ambiguous "biometric" label.
 */
function BiometricButton({ onClick }: { onClick: () => void | Promise<void> }) {
  const platform = detectPlatform();
  const icon =
    platform === "macos" ? (
      <IconTouchId size={16} />
    ) : platform === "windows" ? (
      <IconWindowsHello size={16} />
    ) : null;
  const label =
    platform === "macos"
      ? t("unlock_use_touchid")
      : platform === "windows"
        ? t("unlock_use_windowshello")
        : t("unlock_use_biometric");
  return (
    <motion.button
      type="button"
      class="btn btn-ghost flex items-center justify-center gap-2"
      whileTap={TAP_SCALE}
      onClick={onClick}
    >
      {icon}
      {label}
    </motion.button>
  );
}
