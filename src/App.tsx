import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api } from "./api.js";
import { DotGrid } from "./DotGrid.js";
import { AccountsView } from "./components/AccountsView.js";
import { AppShell } from "./components/AppShell.js";
import { GeneratorView } from "./components/GeneratorView.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { QuickSearchScreen } from "./components/QuickSearchScreen.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { SyncScreen } from "./components/SyncScreen.js";
import { UnlockScreen } from "./components/UnlockScreen.js";
import { VaultsScreen } from "./components/VaultsScreen.js";
import {
  defaultProfile,
  errorMessage,
  fingerprint,
  hasPin,
  historyEnabled,
  screen,
  view,
} from "./state.js";

export function App() {
  useEffect(() => {
    void bootstrap();
    const onHash = () => {
      const target = window.location.hash.replace(/^#\/?/, "") || "";
      if (target === "quick-search") {
        screen.value = "quick-search";
        return;
      }
      if (
        target === "settings" ||
        target === "sync" ||
        target === "vaults" ||
        target === "accounts" ||
        target === "generator"
      ) {
        screen.value = "shell";
        view.value = target;
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <DotGrid />
      <AnimatePresence mode="wait" initial={false}>
        {renderScreen()}
      </AnimatePresence>
    </div>
  );
}

function renderScreen() {
  switch (screen.value) {
    case "loading":
      return <LoadingScreen key="loading" />;
    case "setup":
      return (
        <FullBleed key="setup">
          <SetupScreen />
        </FullBleed>
      );
    case "unlock":
      return (
        <FullBleed key="unlock">
          <UnlockScreen hasPin={hasPin.value} />
        </FullBleed>
      );
    case "quick-search":
      return <QuickSearchScreen key="quick-search" />;
    case "shell":
      return (
        <motion.div
          key="shell"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          class="relative z-10 h-full"
        >
          <AppShell>{renderShellView()}</AppShell>
        </motion.div>
      );
  }
}

function renderShellView() {
  switch (view.value) {
    case "generator":
      return <GeneratorView key="generator" />;
    case "accounts":
      return <AccountsView key="accounts" />;
    case "settings":
      return <SettingsScreen key="settings" />;
    case "sync":
      return <SyncScreen key="sync" />;
    case "vaults":
      return <VaultsScreen key="vaults" />;
  }
}

function FullBleed({ children }: { children: ComponentChildren }) {
  return <div class="relative z-10 h-full w-full">{children}</div>;
}

async function bootstrap() {
  try {
    const status = await api.status();
    fingerprint.value = status.fingerprint;
    hasPin.value = status.hasPin;

    if (status.isFirstRun) {
      screen.value = "setup";
      return;
    }
    if (status.locked) {
      screen.value = "unlock";
      return;
    }

    const state = await api.getState();
    historyEnabled.value = state.historyEnabled;
    defaultProfile.value = state.defaultProfile;
    screen.value = "shell";
    view.value = "generator";
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "could not initialise";
    screen.value = "unlock";
  }
}
