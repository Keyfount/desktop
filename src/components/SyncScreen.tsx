import { useCallback, useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { IconChevronRight } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { errorMessage, screen } from "../state.js";
import type { SyncStatusResponse } from "../types.js";
import { Header } from "./Header.js";

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
    <motion.div
      class="flex flex-col gap-5 p-6 max-w-md mx-auto pt-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={t("sync_title")}
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

      <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("sync_intro")}</p>

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
          class="btn btn-ghost"
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

      {status?.connected ? (
        <div class="callout callout-info">Connected to {status.session?.baseUrl}</div>
      ) : null}

      {errorMessage.value !== null ? (
        <div class="field-error" role="alert">
          {errorMessage.value}
        </div>
      ) : null}
    </motion.div>
  );
}
