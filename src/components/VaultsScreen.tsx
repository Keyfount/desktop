import { useCallback, useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconPlus } from "../icons.js";
import { TAP_SCALE } from "../motion.js";
import { errorMessage, fingerprint, screen } from "../state.js";
import type { ListVaultsResponse } from "../types.js";
import { ConfirmModal } from "./ConfirmModal.js";
import { PageHeader } from "./PageHeader.js";

interface Props {
  onBack?: (() => void) | undefined;
}

export function VaultsScreen({ onBack }: Props) {
  const [data, setData] = useState<ListVaultsResponse | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void api.listVaults().then(setData);
  }, []);

  const onSwitch = useCallback(async (id: string) => {
    try {
      await api.switchVault(id);
      screen.value = "unlock";
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_switch_failed");
    }
  }, []);

  const performDelete = useCallback(async (id: string) => {
    try {
      await api.deleteVault(id);
      const refreshed = await api.listVaults();
      setData(refreshed);
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_delete_failed");
    } finally {
      setConfirmingDeleteId(null);
    }
  }, []);

  const onNew = useCallback(async () => {
    await api.startNewVault();
    fingerprint.value = null;
    screen.value = "setup";
  }, []);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={t("vaults_title")}
        subtitle={data ? t("vaults_subtitle", String(data.vaults.length)) : ""}
        onBack={onBack}
        actions={
          <motion.button type="button" class="btn btn-sm" whileTap={TAP_SCALE} onClick={onNew}>
            <IconPlus size={14} />
            {t("vaults_new")}
          </motion.button>
        }
      />

      <div class="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div class="mx-auto w-full max-w-3xl flex flex-col gap-3">
          {data === null ? (
            [0, 1].map((i) => <div key={i} class="skeleton h-16 rounded-2xl" />)
          ) : data.vaults.length === 0 ? (
            <p class="text-(--color-ink-muted) text-sm">{t("vaults_empty")}</p>
          ) : (
            <ul class="flex flex-col gap-2">
              {data.vaults.map((v) => {
                const active = data.activeId === v.id;
                return (
                  <li key={v.id}>
                    <div
                      class={
                        "card !p-4 flex items-center gap-3 " +
                        (active ? "ring-1 ring-(--color-accent-500)/40" : "")
                      }
                    >
                      <span class="grid place-items-center w-10 h-10 rounded-2xl bg-(--color-surface-sunken) border border-(--color-line) font-mono text-xs text-(--color-ink-muted)">
                        {v.fingerprint.slice(0, 2)}
                      </span>
                      <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-sm text-(--color-ink) truncate font-medium">
                          {t("vaults_label", v.id.slice(0, 8))}
                        </span>
                        <span class="field-hint">
                          {t("vaults_created", new Date(v.createdAt).toLocaleDateString())}
                        </span>
                      </div>
                      {active ? (
                        <span class="chip-success status-pill">{t("common_active")}</span>
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
                        onClick={() => setConfirmingDeleteId(v.id)}
                        aria-label={t("vaults_delete_aria")}
                      >
                        {t("vaults_delete")}
                      </motion.button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {errorMessage.value !== null ? (
            <div class="field-error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}
        </div>
      </div>

      {confirmingDeleteId !== null ? (
        <ConfirmModal
          title={t("vaults_delete_confirm_title")}
          body={t("vaults_delete_confirm_body")}
          confirmLabel={t("vaults_delete")}
          onCancel={() => setConfirmingDeleteId(null)}
          onConfirm={() => void performDelete(confirmingDeleteId)}
        />
      ) : null}
    </div>
  );
}
