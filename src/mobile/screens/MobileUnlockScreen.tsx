import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { IconTouchId } from "../../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { detectPlatform } from "../../platform.js";
import {
  busy,
  defaultProfile,
  errorMessage,
  fingerprint,
  historyEnabled,
  livePreview,
  screen,
  view,
} from "../../state.js";

interface Props {
  hasPin: boolean;
}

export function MobileUnlockScreen({ hasPin }: Props) {
  // Default to the PIN tab whenever the vault has one configured —
  // it's the faster path, and matches the extension's UnlockScreen.
  const [mode, setMode] = useState<"master" | "pin">(hasPin ? "pin" : "master");
  const [value, setValue] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live fingerprint preview while typing the master, so a mismatch
  // (i.e. wrong-vault master) surfaces before the user hits Unlock.
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

  useEffect(() => {
    if (mode !== "master") livePreview.value = null;
  }, [mode]);

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

  useEffect(() => {
    let active = true;
    void api
      .biometricAvailable()
      .then((r) => {
        if (!active) return;
        const available = r.supported && r.enrolled && r.vaultEnrolled;
        setBioAvailable(available);
        if (available) {
          void onBiometric();
        }
      })
      .catch(() => {
        if (active) setBioAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [onBiometric]);

  const onSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      busy.value = true;
      errorMessage.value = null;
      try {
        const response =
          mode === "master" ? await api.unlock(value) : await api.unlockWithPin(value);
        fingerprint.value = response.fingerprint;
        const state = await api.getState();
        historyEnabled.value = state.historyEnabled;
        defaultProfile.value = state.defaultProfile;
        view.value = "generator";
        screen.value = "shell";
        setValue("");
      } catch (err) {
        errorMessage.value = describeError(err) || t("err_unlock_failed");
      } finally {
        busy.value = false;
      }
    },
    [mode, value],
  );

  const platform = detectPlatform();
  const isApple = platform === "ios" || platform === "macos";
  const biometricLabel = isApple
    ? t("unlock_use_touchid") + " / Face ID"
    : t("unlock_use_biometric");

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="safe-top safe-bottom px-5 pt-12 flex flex-col gap-6 min-h-screen"
    >
      <header>
        <h1 class="text-[22px] font-semibold tracking-tight text-(--color-ink)">
          {t("unlock_title")}
        </h1>
        <p class="text-[13px] text-(--color-ink-muted) mt-1">
          {mode === "master" ? t("unlock_subtitle") : t("unlock_pin_subtitle")}
        </p>
      </header>

      <form class="flex flex-col gap-4" onSubmit={onSubmit}>
        <input
          type="password"
          inputMode={mode === "pin" ? "numeric" : "text"}
          autocomplete="current-password"
          autofocus
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          placeholder={mode === "master" ? t("setup_master_label") : t("settings_pin")}
          class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-4 py-3 text-[15px] text-(--color-ink) outline-none"
        />

        <AnimatePresence>
          {mode === "master" &&
          livePreview.value !== null &&
          fingerprint.value !== null &&
          livePreview.value !== fingerprint.value ? (
            <motion.div
              key="mismatch"
              class="callout flex flex-col gap-1.5 items-start border border-amber-500/40 bg-amber-500/10 p-3 rounded-2xl"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
              aria-live="polite"
            >
              <span class="field-label text-[10px]">{t("unlock_typed_label")}</span>
              <span class="fingerprint text-sm">{livePreview.value}</span>
              <span class="field-hint text-[11px] leading-snug">{t("unlock_mismatch_hint")}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {errorMessage.value ? (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              class="text-(--color-danger) text-[13px]"
            >
              {errorMessage.value}
            </motion.p>
          ) : null}
        </AnimatePresence>

        <motion.button
          type="submit"
          whileTap={TAP_SCALE}
          disabled={busy.value}
          class="rounded-full bg-(--color-ink) text-(--color-surface) py-3 text-[15px] font-medium disabled:opacity-40"
        >
          {t("unlock_button")}
        </motion.button>

        {hasPin ? (
          <motion.button
            type="button"
            class="text-(--color-ink-muted) text-sm font-medium py-2 text-center bg-transparent border-0 cursor-pointer outline-none"
            whileTap={TAP_SCALE}
            onClick={() => {
              setMode(mode === "master" ? "pin" : "master");
              setValue("");
            }}
          >
            {mode === "master" ? t("unlock_use_pin") : t("unlock_use_master")}
          </motion.button>
        ) : null}
      </form>

      {bioAvailable ? (
        <div class="flex flex-col items-center justify-center gap-2 mt-4">
          <motion.button
            type="button"
            class="h-14 w-14 rounded-full bg-(--color-surface-elev) border border-(--color-line) flex items-center justify-center shadow-sm text-(--color-ink) active:bg-(--color-surface-sunken) transition-colors outline-none"
            whileTap={TAP_SCALE}
            onClick={onBiometric}
            aria-label={biometricLabel}
          >
            <IconTouchId size={28} />
          </motion.button>
          <span class="text-xs text-(--color-ink-muted)">{biometricLabel}</span>
        </div>
      ) : null}
    </motion.section>
  );
}
