import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import {
  IconCheck,
  IconDownload,
  IconRefresh,
  IconShield,
  IconUnlock,
  IconUpload,
} from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { errorMessage } from "../state.js";
import type { SyncSession } from "../sync/auth.js";
import { pushAllLocalAccountsAndPull } from "../sync/auto.js";
import {
  clearSession,
  connect,
  disconnect,
  loadStoredSession,
  pollApproval,
  pull,
  push,
} from "../sync/manager.js";
import { pingNow } from "../sync/status.js";
import { PageHeader } from "./PageHeader.js";

type Status = "loading" | "disconnected" | "connecting" | "pending" | "approved";

/**
 * Fire the post-connect routine the moment a session lands on
 * `approved`: push everything we had locally so the server gets
 * caught up, pull anything the server already had, and kick a
 * status probe so the sidebar dot and the Accounts header refresh
 * button appear right now instead of waiting for the next polling
 * tick. Without this the user had to relaunch the app for the UI
 * to notice it was synced.
 */
function onSessionApproved(): void {
  void (async () => {
    await pushAllLocalAccountsAndPull();
    await pingNow();
  })();
}

export function SyncScreen() {
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<SyncSession | null>(null);
  const [reachable, setReachable] = useState<null | { ok: boolean; reason?: string }>(null);

  useEffect(() => {
    void (async () => {
      const stored = await loadStoredSession();
      if (!stored) {
        setStatus("disconnected");
        return;
      }
      setSession(stored);
      setStatus(stored.status === "approved" ? "approved" : "pending");
    })();
  }, []);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={t("sync_title")}
        subtitle={subtitleFor(status)}
        actions={
          status === "approved" || status === "pending" ? <StatusPill status={status} /> : null
        }
      />

      <div class="flex-1 overflow-y-auto px-8 py-8">
        <div class="mx-auto w-full max-w-2xl flex flex-col gap-6">
          {status === "loading" ? (
            <div class="skeleton h-16 rounded-2xl" />
          ) : status === "disconnected" || status === "connecting" ? (
            <ConnectForm
              busy={status === "connecting"}
              onTest={async (url) => {
                setReachable(null);
                const r = await api.syncTestConnection(url);
                setReachable({
                  ok: r.reachable,
                  ...(r.reason !== undefined ? { reason: r.reason } : {}),
                });
              }}
              reachable={reachable}
              onSubmit={async (args) => {
                setStatus("connecting");
                errorMessage.value = null;
                try {
                  const { master } = await api.sessionMaster();
                  const next = await connect({ ...args, master });
                  setSession(next);
                  if (next.status === "approved") {
                    setStatus("approved");
                    onSessionApproved();
                  } else {
                    setStatus("pending");
                  }
                } catch (err) {
                  errorMessage.value = humanConnectError(err);
                  setStatus("disconnected");
                }
              }}
            />
          ) : status === "pending" && session ? (
            <PendingPanel
              session={session}
              onPoll={async () => {
                const next = await pollApproval();
                if (next) {
                  setSession(next);
                  if (next.status === "approved") {
                    setStatus("approved");
                    onSessionApproved();
                  }
                }
              }}
              onAbort={async () => {
                await clearSession();
                setSession(null);
                setStatus("disconnected");
              }}
            />
          ) : status === "approved" && session ? (
            <ApprovedPanel
              session={session}
              onDisconnect={async () => {
                await disconnect();
                setSession(null);
                setStatus("disconnected");
              }}
            />
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

function subtitleFor(status: Status): string {
  switch (status) {
    case "loading":
      return t("sync_status_loading");
    case "disconnected":
      return t("sync_status_disconnected");
    case "connecting":
      return t("sync_status_connecting");
    case "pending":
      return t("sync_status_pending");
    case "approved":
      return t("sync_status_approved");
  }
}

function StatusPill({ status }: { status: "pending" | "approved" }) {
  if (status === "approved") {
    return (
      <span class="chip-success status-pill">
        <span class="status-dot" />
        {t("sync_chip_connected")}
      </span>
    );
  }
  return (
    <span class="chip-warning status-pill">
      <span class="status-dot" />
      {t("sync_chip_pending")}
    </span>
  );
}

function ConnectForm({
  busy,
  reachable,
  onTest,
  onSubmit,
}: {
  busy: boolean;
  reachable: null | { ok: boolean; reason?: string };
  onTest: (url: string) => Promise<void>;
  onSubmit: (args: { baseUrl: string; email: string; deviceLabel?: string }) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");

  const canTest = url.trim().length > 0 && !busy;
  const canSubmit = url.trim().length > 0 && email.trim().length > 0 && !busy;

  return (
    <motion.div
      class="flex flex-col gap-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("sync_intro")}</p>

      <div class="card !p-5 flex flex-col gap-4">
        <Field label={t("sync_server_url")}>
          <input
            class="input input-mono"
            type="url"
            placeholder="https://keyfount.example.com"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
        </Field>

        <div class="flex items-center gap-2">
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm"
            whileTap={TAP_SCALE}
            onClick={() => void onTest(url.trim())}
            disabled={!canTest}
          >
            <IconShield size={14} />
            {t("sync_test")}
          </motion.button>
          {reachable ? (
            <span class={reachable.ok ? "chip-success status-pill" : "chip-danger status-pill"}>
              <span class="status-dot" />
              {reachable.ok ? t("sync_reachable") : humanReachReason(reachable.reason)}
            </span>
          ) : null}
        </div>
      </div>

      <div class="card !p-5 flex flex-col gap-4">
        <div class="callout text-xs leading-relaxed">
          <strong>{t("sync_master_reused_title")}</strong>
          <p class="m-0 mt-1 text-(--color-ink-muted)">{t("sync_master_reused_body")}</p>
        </div>
        <Field label={t("sync_email_label")} hint={t("sync_email_hint")}>
          <input
            class="input"
            type="email"
            autocomplete="email"
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </Field>
      </div>

      <motion.button
        type="button"
        class="btn"
        whileTap={TAP_SCALE}
        disabled={!canSubmit}
        onClick={() =>
          void onSubmit({
            baseUrl: url.trim(),
            email: email.trim(),
            deviceLabel: navigator.userAgent.includes("Mac") ? "Mac" : "Desktop",
          })
        }
      >
        {busy ? (
          <span class="flex items-center gap-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            >
              <IconRefresh size={14} />
            </motion.span>
            {t("sync_status_connecting")}
          </span>
        ) : (
          <span class="flex items-center gap-2">
            <IconUnlock size={14} />
            {t("sync_connect")}
          </span>
        )}
      </motion.button>
    </motion.div>
  );
}

function PendingPanel({
  session,
  onPoll,
  onAbort,
}: {
  session: SyncSession;
  onPoll: () => Promise<void>;
  onAbort: () => Promise<void>;
}) {
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setPolling(true);
      void onPoll().finally(() => setPolling(false));
    }, 6000);
    return () => clearInterval(id);
  }, [onPoll]);

  return (
    <motion.div class="flex flex-col gap-5" variants={POP_IN} initial="initial" animate="animate">
      <div class="card !p-5 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium text-(--color-ink)">{t("sync_pending_title")}</span>
          {polling ? (
            <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
              <IconRefresh size={14} />
            </motion.span>
          ) : null}
        </div>
        <div class="text-xs text-(--color-ink-muted) leading-relaxed flex flex-col gap-1.5">
          <KeyValue k={t("sync_kv_server")} v={session.baseUrl} />
          <KeyValue k={t("sync_kv_email")} v={session.email} />
          <KeyValue k={t("sync_kv_user")} v={`${session.userId.slice(0, 12)}…`} />
          <KeyValue k={t("sync_kv_device")} v={`${session.deviceId.slice(0, 12)}…`} />
        </div>
      </div>
      <div class="callout">{t("sync_pending_body")}</div>
      <motion.button
        type="button"
        class="btn btn-danger btn-sm self-start"
        whileTap={TAP_SCALE}
        onClick={onAbort}
      >
        {t("sync_pending_cancel")}
      </motion.button>
    </motion.div>
  );
}

function ApprovedPanel({
  session,
  onDisconnect,
}: {
  session: SyncSession;
  onDisconnect: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const runPull = useCallback(async () => {
    setBusy("pull");
    errorMessage.value = null;
    try {
      const { master } = await api.sessionMaster();
      const stats = await pull(master);
      setLastSync(t("sync_last_pulled", String(stats.pulled)));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      errorMessage.value = humanConnectError(err);
    } finally {
      setBusy(null);
    }
  }, []);

  const runPush = useCallback(async () => {
    setBusy("push");
    errorMessage.value = null;
    try {
      const { master } = await api.sessionMaster();
      const stats = await push(master);
      setLastSync(t("sync_last_pushed", String(stats.pushed)));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      errorMessage.value = humanConnectError(err);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <motion.div class="flex flex-col gap-5" variants={POP_IN} initial="initial" animate="animate">
      <div class="card !p-5 flex flex-col gap-3">
        <span class="mono-tag">{t("sync_connected_to")}</span>
        <span class="font-mono text-sm text-(--color-ink) break-all">{session.baseUrl}</span>
        <div class="text-xs text-(--color-ink-muted) leading-relaxed flex flex-col gap-1.5 pt-2 border-t border-(--color-line)/60">
          <KeyValue k={t("sync_kv_email")} v={session.email} />
          <KeyValue k={t("sync_kv_device")} v={`${session.deviceId.slice(0, 12)}…`} />
          <KeyValue k={t("sync_kv_fingerprint")} v={session.ekFingerprint} />
        </div>
      </div>

      <div class="callout callout-success flex items-center gap-2">
        <IconCheck size={14} />
        <span class="text-xs leading-relaxed">{t("sync_auto_active")}</span>
      </div>

      <div class="card !p-5 flex flex-col gap-3">
        <span class="field-label">{t("sync_force_label")}</span>
        <div class="flex gap-2">
          <motion.button
            type="button"
            class="btn flex-1"
            whileTap={TAP_SCALE}
            onClick={runPull}
            disabled={busy !== null}
          >
            {busy === "pull" ? (
              <span class="flex items-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1 }}
                >
                  <IconRefresh size={14} />
                </motion.span>
                {t("sync_pulling")}
              </span>
            ) : (
              <span class="flex items-center gap-2">
                <IconDownload size={14} />
                {t("sync_pull")}
              </span>
            )}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-ghost flex-1"
            whileTap={TAP_SCALE}
            onClick={runPush}
            disabled={busy !== null}
          >
            {busy === "push" ? (
              <span class="flex items-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1 }}
                >
                  <IconRefresh size={14} />
                </motion.span>
                {t("sync_pushing")}
              </span>
            ) : (
              <span class="flex items-center gap-2">
                <IconUpload size={14} />
                {t("sync_push")}
              </span>
            )}
          </motion.button>
        </div>
        <AnimatePresence>
          {success && lastSync ? (
            <motion.div
              class="callout callout-success flex items-center gap-2"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <IconCheck size={14} />
              {lastSync}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <motion.button
        type="button"
        class="btn btn-danger btn-sm self-start"
        whileTap={TAP_SCALE}
        onClick={onDisconnect}
      >
        {t("sync_disconnect")}
      </motion.button>
    </motion.div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ComponentChildren;
}) {
  return (
    <label class="flex flex-col gap-2">
      <span class="field-label">{label}</span>
      {children}
      {hint ? <span class="field-hint">{hint}</span> : null}
    </label>
  );
}

function KeyValue({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span class="mono-tag">{k}</span> <span class="font-mono">{v}</span>
    </div>
  );
}

function humanReachReason(reason: string | undefined): string {
  switch (reason) {
    case "invalid_url":
      return t("sync_reach_invalid_url");
    case "timeout":
      return t("sync_reach_timeout");
    case "network_error":
      return t("sync_reach_network");
    case "unexpected_payload":
      return t("sync_reach_unexpected");
    default:
      if (reason !== undefined && reason.startsWith("http_")) {
        return t("sync_reach_http", reason.slice(5));
      }
      return t("sync_unreachable");
  }
}

function humanConnectError(err: unknown): string {
  const message = describeError(err);
  if (message === "vault is locked") {
    return t("sync_err_locked");
  }
  if (message === "master mismatch" || message === "wrong master password") {
    return t("sync_err_master_mismatch");
  }
  if (message.includes("too_many_attempts")) {
    return t("sync_err_too_many");
  }
  return t("sync_err_generic", message);
}
