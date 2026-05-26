import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { IconTouchId } from "../../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { detectPlatform } from "../../platform.js";
import {
  busy,
  defaultProfile,
  errorMessage,
  fingerprint,
  historyEnabled,
  screen,
  view,
} from "../../state.js";

interface Props {
  hasPin: boolean;
}

export function MobileUnlockScreen({ hasPin }: Props) {
  const [mode, setMode] = useState<"master" | "pin">("master");
  const [value, setValue] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    if (hasPin && mode === "master") setMode("master");
  }, [hasPin]);

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
        errorMessage.value = describeError(err) || "unlock failed";
      } finally {
        busy.value = false;
      }
    },
    [mode, value],
  );

  const platform = detectPlatform();
  const isApple = platform === "ios" || platform === "macos";
  const biometricLabel = isApple ? (t("unlock_use_touchid") + " / Face ID") : t("unlock_use_biometric");

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
          <span class="text-xs text-(--color-ink-muted)">
            {biometricLabel}
          </span>
        </div>
      ) : null}
    </motion.section>
  );
}

