import { useCallback, useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { TAP_SCALE } from "../motion.js";
import { errorMessage } from "../state.js";
import type { SyncStatusResponse } from "../types.js";
import { PageHeader } from "./PageHeader.js";

export function SyncScreen() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [url, setUrl] = useState("");
  const [reachable, setReachable] = useState<null | { ok: boolean; reason?: string | undefined }>(
    null,
  );

  useEffect(() => {
    void api.syncStatus().then(setStatus);
  }, []);

  const test = useCallback(async () => {
    if (url.trim().length === 0) return;
    setReachable(null);
    try {
      const r = await api.syncTestConnection(url.trim());
      setReachable({ ok: r.reachable, reason: r.reason });
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "test failed";
    }
  }, [url]);

  return (
    <div class="flex flex-col h-full">
      <PageHeader title={t("sync_title")} subtitle="Zero-knowledge sync" />
      <div class="flex-1 overflow-y-auto px-8 py-8">
        <div class="mx-auto w-full max-w-2xl flex flex-col gap-5">
          <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("sync_intro")}</p>

          <div class="card !p-5 flex flex-col gap-4">
            <label class="flex flex-col gap-2">
              <span class="field-label">{t("sync_server_url")}</span>
              <input
                class="input input-mono"
                type="url"
                placeholder="https://keyfount.example.com"
                value={url}
                onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
              />
            </label>

            <div class="flex gap-2">
              <motion.button
                type="button"
                class="btn btn-ghost btn-sm"
                whileTap={TAP_SCALE}
                onClick={test}
                disabled={url.trim().length === 0}
              >
                {t("sync_test")}
              </motion.button>
            </div>

            {reachable !== null ? (
              <div
                class={reachable.ok ? "callout callout-success" : "callout callout-danger"}
                role="status"
              >
                {reachable.ok ? t("sync_reachable") : t("sync_unreachable")}
                {reachable.reason ? <span class="block opacity-80">{reachable.reason}</span> : null}
              </div>
            ) : null}
          </div>

          {status?.connected ? (
            <div class="callout callout-info">Connected to {status.session?.baseUrl}</div>
          ) : null}

          {errorMessage.value !== null ? (
            <div class="field-error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
