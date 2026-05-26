import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { detectPlatform } from "../platform.js";
import { DotGrid } from "../DotGrid.js";
import { SyncScreen } from "../components/SyncScreen.js";
import { VaultsScreen } from "../components/VaultsScreen.js";
import { MobileAccountDetailSheet } from "./MobileAccountDetailSheet.js";
import {
  errorMessage,
  faviconFallbackEnabled,
  fingerprint,
  hasPin,
  historyEnabled,
  defaultProfile,
  screen,
  view,
  allAccounts,
} from "../state.js";
import { startAutoSync, stopAutoSync } from "../sync/auto.js";
import { startSyncStatusMonitor, stopSyncStatusMonitor } from "../sync/status.js";
import { MobileShell } from "./MobileShell.js";
import { VaultSheet } from "./VaultSheet.js";
import { vaultSheetOpen, additionalVaultMode } from "./state.js";
import { MobileGeneratorScreen } from "./screens/MobileGeneratorScreen.js";
import { MobileAccountsScreen } from "./screens/MobileAccountsScreen.js";
import { MobileSettingsScreen } from "./screens/MobileSettingsScreen.js";
import { MobileSetupScreen } from "./screens/MobileSetupScreen.js";
import { MobileUnlockScreen } from "./screens/MobileUnlockScreen.js";
import type { VaultRow } from "./VaultSheet.js";
import "./style.css";

export function MobileApp() {
  const platform = detectPlatform() === "android" ? "android" : "ios";
  const [vaults, setVaults] = useState<VaultRow[]>([]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (screen.value === "shell") {
      startAutoSync();
      startSyncStatusMonitor();
      void (async () => {
        try {
          const [acctResp, vaultResp] = await Promise.all([
            api.listAccounts(),
            api.listVaults(),
          ]);
          allAccounts.value = acctResp.entries;
          setVaults(transformVaults(vaultResp.vaults, vaultResp.activeId ?? undefined));
        } catch (err) {
          errorMessage.value = describeError(err);
        }
      })();
      return () => {
        stopAutoSync();
        stopSyncStatusMonitor();
      };
    }
    return undefined;
  }, [screen.value]);

  const onTabChange = useCallback((tab: "accounts" | "generator" | "settings") => {
    view.value = tab;
  }, []);

  const onLock = useCallback(() => {
    void api.lock()
      .then(() => { screen.value = "unlock"; })
      .catch((err) => { errorMessage.value = describeError(err); });
  }, []);

  const activeTab: "accounts" | "generator" | "settings" =
    view.value === "accounts" || view.value === "generator" || view.value === "settings"
      ? view.value
      : "generator";

  return (
    <div class="relative h-full w-full overflow-hidden">
      <DotGrid />
      <AnimatePresence mode="wait" initial={false}>
        {screen.value === "setup" ? (
          <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} class="relative z-10">
            <MobileSetupScreen
              mode={additionalVaultMode.value ? "additional" : "first-run"}
              onCancel={() => {
                additionalVaultMode.value = false;
                screen.value = "shell";
              }}
            />
          </motion.div>
        ) : screen.value === "unlock" ? (
          <motion.div key="unlock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} class="relative z-10">
            <MobileUnlockScreen hasPin={hasPin.value} />
          </motion.div>
        ) : screen.value === "shell" ? (
          <motion.div key="shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} class="relative z-10 h-full w-full">
            {view.value === "sync" ? (
              <div class="h-full w-full overflow-hidden flex flex-col pt-[calc(env(safe-area-inset-top,0px))]">
                <SyncScreen onBack={() => { view.value = "settings"; }} />
              </div>
            ) : view.value === "vaults" ? (
              <div class="h-full w-full overflow-hidden flex flex-col pt-[calc(env(safe-area-inset-top,0px))]">
                <VaultsScreen onBack={() => { view.value = "settings"; }} />
              </div>
            ) : (
              <MobileShell
                active={activeTab}
                platform={platform}
                fingerprint={fingerprint.value}
                onChange={onTabChange}
              >
                {activeTab === "generator" ? <MobileGeneratorScreen /> : null}
                {activeTab === "accounts" ? <MobileAccountsScreen /> : null}
                {activeTab === "settings" ? <MobileSettingsScreen onLock={onLock} /> : null}
              </MobileShell>
            )}
            <VaultSheet
              platform={platform}
              vaults={vaults}
              onSwitch={(id) => {
                void api.switchVault(id)
                  .then(() => {
                    screen.value = "unlock";
                  })
                  .catch((err) => { errorMessage.value = describeError(err); });
                vaultSheetOpen.value = false;
              }}
              onLock={onLock}
              onNew={() => {
                void api.startNewVault()
                  .then(() => {
                    additionalVaultMode.value = true;
                    fingerprint.value = null;
                    screen.value = "setup";
                  })
                  .catch((err) => { errorMessage.value = describeError(err); });
              }}
            />
            <MobileAccountDetailSheet platform={platform} />
          </motion.div>
        ) : (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} class="relative z-10">
            <p class="p-6 text-(--color-ink-muted)">…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function transformVaults(
  rawVaults: Array<{ id: string; fingerprint: string }>,
  activeId?: string,
): VaultRow[] {
  return rawVaults.map((v) => ({
    id: v.id,
    name: t("vaults_label", v.id.slice(0, 8)),
    fingerprint: v.fingerprint,
    active: v.id === activeId,
  }));
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
    faviconFallbackEnabled.value = state.faviconFallbackEnabled;
    defaultProfile.value = state.defaultProfile;
    screen.value = "shell";
    view.value = "generator";
  } catch (err) {
    errorMessage.value = describeError(err) || "could not initialise";
    screen.value = "unlock";
  }
}
