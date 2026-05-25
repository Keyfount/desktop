import { useEffect } from "preact/hooks";
import { AnimatePresence } from "framer-motion";

import { api } from "./api.js";
import { DotGrid } from "./DotGrid.js";
import { AccountDetailScreen } from "./components/AccountDetailScreen.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { MainScreen } from "./components/MainScreen.js";
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
} from "./state.js";

export function App() {
  useEffect(() => {
    void bootstrap();
    const onHash = () => {
      const target = window.location.hash.replace(/^#\/?/, "") || "main";
      if (
        target === "settings" ||
        target === "sync" ||
        target === "vaults" ||
        target === "quick-search"
      ) {
        screen.value = target;
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div class="relative min-h-screen w-full">
      <DotGrid />
      <main class="relative z-10">
        <AnimatePresence mode="wait" initial={false}>
          {renderScreen()}
        </AnimatePresence>
      </main>
    </div>
  );
}

function renderScreen() {
  switch (screen.value) {
    case "loading":
      return <LoadingScreen key="loading" />;
    case "setup":
      return <SetupScreen key="setup" />;
    case "unlock":
      return <UnlockScreen key="unlock" hasPin={hasPin.value} />;
    case "main":
      return <MainScreen key="main" />;
    case "account-detail":
      return <AccountDetailScreen key="account-detail" />;
    case "settings":
      return <SettingsScreen key="settings" />;
    case "sync":
      return <SyncScreen key="sync" />;
    case "vaults":
      return <VaultsScreen key="vaults" />;
    case "quick-search":
      return <QuickSearchScreen key="quick-search" />;
  }
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
    screen.value = "main";
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "could not initialise";
    screen.value = "unlock";
  }
}
