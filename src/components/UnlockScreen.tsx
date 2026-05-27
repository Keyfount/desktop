import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconTouchId, IconWindowsHello } from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { detectPlatform } from "../platform.js";
import {
  busy,
  defaultProfile,
  errorMessage,
  fingerprint,
  historyEnabled,
  livePreview,
  screen,
  view,
} from "../state.js";
import { Header } from "./Header.js";

interface Props {
  hasPin: boolean;
}

export function UnlockScreen({ hasPin }: Props) {
  // Default to the PIN tab whenever the vault has one configured —
  // it's the faster path, and matches the extension's UnlockScreen
  // behaviour. The user can still flip to "Use master password" via
  // the toggle below.
  const [mode, setMode] = useState<"master" | "pin">(hasPin ? "pin" : "master");
  const [value, setValue] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void api
      .biometricAvailable()
      .then((r) => setBioAvailable(r.supported && r.enrolled && r.vaultEnrolled))
      .catch(() => setBioAvailable(false));
  }, []);

  // Live fingerprint preview while the user types the master. Lets us
  // warn early when they're typing the wrong vault's master before
  // they hit Unlock — the actual unlock path eats Argon2 latency, but
  // a debounced fingerprint() call is cheap enough to run on every
  // pause. PIN mode skips this (the PIN never derives a fingerprint
  // directly).
  useEffect(() => {
    if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    if (mode !== "master" || value.length === 0) {
      livePreview.value = null;
      return;
    }
    previewTimer.current = setTimeout(() => {
      void api
        .fingerprint(value)
        .then((r) => {
          livePreview.value = r.fingerprint;
        })
        .catch(() => {
          livePreview.value = null;
        });
    }, 500);
    return () => {
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    };
  }, [value, mode]);

  // Reset the live preview when leaving the master tab so it doesn't
  // linger after a tab switch.
  useEffect(() => {
    if (mode !== "master") livePreview.value = null;
  }, [mode]);

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
        errorMessage.value = describeError(err) || t("err_unlock_failed");
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
      errorMessage.value = describeError(err) || t("err_biometric_failed");
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
        {mode === "master" &&
        livePreview.value !== null &&
        fingerprint.value !== null &&
        livePreview.value !== fingerprint.value ? (
          <motion.div
            key="mismatch"
            class="callout flex flex-col gap-2 items-start border border-amber-500/40 bg-amber-500/8"
            variants={POP_IN}
            initial="initial"
            animate="animate"
            exit="exit"
            aria-live="polite"
          >
            <span class="field-label">{t("unlock_typed_label")}</span>
            <span class="fingerprint">{livePreview.value}</span>
            <span class="field-hint">{t("unlock_mismatch_hint")}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
