import { useCallback, useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { IconChevronRight } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { errorMessage, fingerprint, screen } from "../state.js";
import type { ListVaultsResponse } from "../types.js";
import { Header } from "./Header.js";

export function VaultsScreen() {
  const [data, setData] = useState<ListVaultsResponse | null>(null);

  useEffect(() => {
    void api.listVaults().then(setData);
  }, []);

  const onSwitch = useCallback(async (id: string) => {
    try {
      await api.switchVault(id);
      screen.value = "unlock";
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "switch failed";
    }
  }, []);

  const onDelete = useCallback(async (id: string) => {
    try {
      await api.deleteVault(id);
      const refreshed = await api.listVaults();
      setData(refreshed);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "delete failed";
    }
  }, []);

  const onNew = useCallback(async () => {
    await api.startNewVault();
    fingerprint.value = null;
    screen.value = "setup";
  }, []);

  return (
    <motion.div
      class="flex flex-col gap-4 p-6 max-w-md mx-auto pt-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={t("vaults_title")}
        actions={
          <motion.button
            type="button"
            class="btn btn-quiet btn-icon"
            whileTap={TAP_SCALE}
            onClick={() => {
              screen.value = "settings";
            }}
            aria-label={t("common_back")}
          >
            <IconChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
          </motion.button>
        }
      />

      {data === null ? null : data.vaults.length === 0 ? (
        <p class="text-(--color-ink-muted) text-sm">No vault yet.</p>
      ) : (
        <ul class="flex flex-col gap-2">
          {data.vaults.map((v) => {
            const active = data.activeId === v.id;
            return (
              <li key={v.id}>
                <div class={`account-row ${active ? "account-row--active" : ""}`}>
                  <span class="account-row__favicon font-mono text-xs">
                    {v.fingerprint.slice(0, 2)}
                  </span>
                  <div class="flex flex-col min-w-0 flex-1">
                    <span class="text-sm text-(--color-ink) truncate">{v.id.slice(0, 8)}</span>
                    <span class="field-hint">
                      Created {new Date(v.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {active ? (
                    <span class="chip-success status-pill">Active</span>
                  ) : (
                    <motion.button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      whileTap={TAP_SCALE}
                      onClick={() => onSwitch(v.id)}
                    >
                      {t("vaults_switch")}
                    </motion.button>
                  )}
                  <motion.button
                    type="button"
                    class="btn btn-danger btn-sm"
                    whileTap={TAP_SCALE}
                    onClick={() => onDelete(v.id)}
                  >
                    {t("vaults_delete")}
                  </motion.button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <motion.button type="button" class="btn" whileTap={TAP_SCALE} onClick={onNew}>
        {t("vaults_new")}
      </motion.button>

      {errorMessage.value !== null ? (
        <div class="field-error" role="alert">
          {errorMessage.value}
        </div>
      ) : null}
    </motion.div>
  );
}
