import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { IconCheck, IconRefresh, IconShield, IconUnlock } from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { errorMessage } from "../state.js";
import type { SyncSession } from "../sync/auth.js";
import {
  clearSession,
  connect,
  disconnect,
  loadStoredSession,
  pollApproval,
  pull,
  push,
} from "../sync/manager.js";
import { PageHeader } from "./PageHeader.js";

type Status = "loading" | "disconnected" | "connecting" | "pending" | "approved";

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
                  const next = await connect(args);
                  setSession(next);
                  setStatus(next.status === "approved" ? "approved" : "pending");
                } catch (err) {
                  errorMessage.value = err instanceof Error ? err.message : "connect failed";
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
                  if (next.status === "approved") setStatus("approved");
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
      return "Checking session…";
    case "disconnected":
      return "Not connected";
    case "connecting":
      return "Connecting…";
    case "pending":
      return "Waiting for admin approval";
    case "approved":
      return "Connected";
  }
}

function StatusPill({ status }: { status: "pending" | "approved" }) {
  if (status === "approved") {
    return (
      <span class="chip-success status-pill">
        <span class="status-dot" />
        Connected
      </span>
    );
  }
  return (
    <span class="chip-warning status-pill">
      <span class="status-dot" />
      Pending
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
  onSubmit: (args: {
    baseUrl: string;
    email: string;
    master: string;
    deviceLabel?: string;
  }) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [master, setMaster] = useState("");

  const canTest = url.trim().length > 0 && !busy;
  const canSubmit =
    url.trim().length > 0 && email.trim().length > 0 && master.length >= 12 && !busy;

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
              {reachable.ok ? t("sync_reachable") : (reachable.reason ?? t("sync_unreachable"))}
            </span>
          ) : null}
        </div>
      </div>

      <div class="card !p-5 flex flex-col gap-4">
        <Field
          label="Email"
          hint="Only an HMAC of this email leaves the device; the server never sees plaintext."
        >
          <input
            class="input"
            type="email"
            autocomplete="email"
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Field
          label="Master password"
          hint="Used once to derive your sync login key. Never sent to the server."
        >
          <input
            class="input"
            type="password"
            autocomplete="current-password"
            value={master}
            onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
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
            master,
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
            Connecting…
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
          <span class="text-sm font-medium text-(--color-ink)">Waiting for admin approval</span>
          {polling ? (
            <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
              <IconRefresh size={14} />
            </motion.span>
          ) : null}
        </div>
        <div class="text-xs text-(--color-ink-muted) leading-relaxed flex flex-col gap-1.5">
          <KeyValue k="Server" v={session.baseUrl} />
          <KeyValue k="Email" v={session.email} />
          <KeyValue k="User" v={`${session.userId.slice(0, 12)}…`} />
          <KeyValue k="Device" v={`${session.deviceId.slice(0, 12)}…`} />
        </div>
      </div>
      <div class="callout">
        Ask the server administrator to approve this device. The status will refresh automatically
        every few seconds.
      </div>
      <motion.button
        type="button"
        class="btn btn-danger btn-sm self-start"
        whileTap={TAP_SCALE}
        onClick={onAbort}
      >
        Cancel and disconnect
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
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const runPull = useCallback(async () => {
    if (master.length < 12) return;
    setBusy("pull");
    errorMessage.value = null;
    try {
      const stats = await pull(master);
      setLastSync(`Pulled ${stats.pulled} accounts`);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "pull failed";
    } finally {
      setBusy(null);
    }
  }, [master]);

  const runPush = useCallback(async () => {
    if (master.length < 12) return;
    setBusy("push");
    errorMessage.value = null;
    try {
      const stats = await push(master);
      setLastSync(`Pushed ${stats.pushed} accounts`);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : "push failed";
    } finally {
      setBusy(null);
    }
  }, [master]);

  return (
    <motion.div class="flex flex-col gap-5" variants={POP_IN} initial="initial" animate="animate">
      <div class="card !p-5 flex flex-col gap-3">
        <span class="mono-tag">Connected to</span>
        <span class="font-mono text-sm text-(--color-ink) break-all">{session.baseUrl}</span>
        <div class="text-xs text-(--color-ink-muted) leading-relaxed flex flex-col gap-1.5 pt-2 border-t border-(--color-line)/60">
          <KeyValue k="Email" v={session.email} />
          <KeyValue k="Device" v={`${session.deviceId.slice(0, 12)}…`} />
          <KeyValue k="Key fingerprint" v={session.ekFingerprint} />
        </div>
      </div>

      <div class="card !p-5 flex flex-col gap-3">
        <span class="field-label">Master password</span>
        <input
          class="input"
          type="password"
          autocomplete="current-password"
          value={master}
          placeholder="Re-enter to unlock the sync key"
          onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
        />
        <div class="flex gap-2">
          <motion.button
            type="button"
            class="btn flex-1"
            whileTap={TAP_SCALE}
            onClick={runPull}
            disabled={busy !== null || master.length < 12}
          >
            {busy === "pull" ? (
              <span class="flex items-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1 }}
                >
                  <IconRefresh size={14} />
                </motion.span>
                Pulling…
              </span>
            ) : (
              "Pull"
            )}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-ghost flex-1"
            whileTap={TAP_SCALE}
            onClick={runPush}
            disabled={busy !== null || master.length < 12}
          >
            {busy === "push" ? (
              <span class="flex items-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1 }}
                >
                  <IconRefresh size={14} />
                </motion.span>
                Pushing…
              </span>
            ) : (
              "Push"
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
