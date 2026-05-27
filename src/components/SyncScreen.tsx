import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
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

type Step = "loading" | "url" | "auth" | "connecting" | "pending" | "approved" | "rejected";

interface Props {
  onBack?: (() => void) | undefined;
}

/**
 * Fire the post-connect routine the moment a session lands on
 * `approved`: push everything we had locally so the server gets
 * caught up, pull anything the server already had, kick a status
 * probe so the sidebar dot and the Accounts refresh button appear
 * right now instead of waiting for the next polling tick.
 */
function onSessionApproved(): void {
  void (async () => {
    await pushAllLocalAccountsAndPull();
    await pingNow();
  })();
}

export function SyncScreen({ onBack }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<SyncSession | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [reachable, setReachable] = useState<null | { ok: boolean; reason?: string }>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await loadStoredSession();
      if (!stored) {
        setStep("url");
        return;
      }
      setSession(stored);
      setBaseUrl(stored.baseUrl);
      setEmail(stored.email);
      setStep(stored.status === "approved" ? "approved" : "pending");
    })();
  }, []);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={t("sync_title")}
        subtitle={subtitleFor(step)}
        onBack={onBack}
        actions={step === "approved" || step === "pending" ? <StatusPill status={step} /> : null}
      />

      <div class="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div class="mx-auto w-full max-w-2xl flex flex-col gap-6">
          {step === "loading" ? <div class="skeleton h-16 rounded-2xl" /> : null}

          {step === "url" || step === "auth" || step === "connecting" ? (
            <StepBar step={step} />
          ) : null}

          {step === "url" ? (
            <UrlStep
              url={baseUrl}
              setUrl={setBaseUrl}
              reachable={reachable}
              onTest={async (val) => {
                setReachable(null);
                const r = await api.syncTestConnection(val);
                setReachable(
                  r.reason !== undefined
                    ? { ok: r.reachable, reason: r.reason }
                    : { ok: r.reachable },
                );
              }}
              onContinue={() => {
                errorMessage.value = null;
                setStep("auth");
              }}
            />
          ) : null}

          {step === "auth" ? (
            <AuthStep
              email={email}
              setEmail={setEmail}
              onBack={() => setStep("url")}
              onSubmit={async () => {
                setStep("connecting");
                errorMessage.value = null;
                try {
                  const { master } = await api.sessionMaster();
                  const next = await connect({
                    baseUrl: baseUrl.trim(),
                    email: email.trim(),
                    master,
                    deviceLabel: navigator.userAgent.includes("Mac") ? "Mac" : "Desktop",
                  });
                  setSession(next);
                  if (next.status === "approved") {
                    setStep("approved");
                    onSessionApproved();
                  } else {
                    setStep("pending");
                  }
                } catch (err) {
                  errorMessage.value = humanConnectError(err);
                  setStep("auth");
                }
              }}
            />
          ) : null}

          {step === "connecting" ? (
            <div class="card !p-6 flex items-center gap-3">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                class="grid place-items-center"
              >
                <IconRefresh size={14} />
              </motion.span>
              <span class="text-sm text-(--color-ink)">{t("sync_status_connecting")}</span>
            </div>
          ) : null}

          {step === "pending" && session !== null ? (
            <PendingPanel
              session={session}
              onPoll={async () => {
                const r = await pollApproval();
                if (r.status === "approved" && r.session !== null) {
                  setSession(r.session);
                  setStep("approved");
                  onSessionApproved();
                } else if (r.status === "rejected") {
                  setRejectionReason(r.reason ?? null);
                  setStep("rejected");
                } else if (r.status === "no_session") {
                  setSession(null);
                  setStep("url");
                }
              }}
              onAbort={async () => {
                await clearSession();
                setSession(null);
                setStep("url");
              }}
            />
          ) : null}

          {step === "approved" && session !== null ? (
            <ApprovedPanel
              session={session}
              onDisconnect={async () => {
                await disconnect();
                setSession(null);
                setStep("url");
              }}
            />
          ) : null}

          {step === "rejected" ? (
            <RejectedPanel
              reason={rejectionReason}
              onReset={async () => {
                await clearSession();
                setSession(null);
                setRejectionReason(null);
                setStep("url");
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

function subtitleFor(step: Step): string {
  switch (step) {
    case "loading":
      return t("sync_status_loading");
    case "url":
    case "auth":
      return t("sync_status_disconnected");
    case "connecting":
      return t("sync_status_connecting");
    case "pending":
      return t("sync_status_pending");
    case "approved":
      return t("sync_status_approved");
    case "rejected":
      return t("sync_rejected_title");
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

function StepBar({ step }: { step: Step }) {
  const idx = step === "url" ? 0 : step === "auth" ? 1 : 2;
  const labels = [t("sync_step_url"), t("sync_step_auth"), t("sync_step_done")];
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2 px-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            class={`h-1 flex-1 rounded-full transition-colors duration-200 ${
              i <= idx ? "bg-(--color-accent-500)" : "bg-(--color-line)"
            }`}
          />
        ))}
      </div>
      <div class="flex items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-[0.18em] font-mono">
        {labels.map((label, i) => (
          <span
            key={label}
            class={
              i === idx
                ? "text-(--color-ink) font-medium"
                : i < idx
                  ? "text-(--color-ink-muted)"
                  : "text-(--color-ink-subtle)"
            }
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function UrlStep({
  url,
  setUrl,
  reachable,
  onTest,
  onContinue,
}: {
  url: string;
  setUrl: (next: string) => void;
  reachable: null | { ok: boolean; reason?: string };
  onTest: (val: string) => Promise<void>;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const canTest = url.trim().length > 0 && !busy;

  const doTest = async () => {
    setBusy(true);
    try {
      await onTest(url.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      class="flex flex-col gap-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("sync_intro")}</p>

      <div class="card !p-5 flex flex-col gap-4">
        <Field label={t("sync_url_label")}>
          <input
            class="input input-mono"
            type="url"
            placeholder={t("sync_url_placeholder")}
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
        </Field>

        <div class="flex items-center gap-2 flex-wrap">
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm"
            whileTap={TAP_SCALE}
            onClick={() => void doTest()}
            disabled={!canTest}
          >
            <IconShield size={14} />
            {busy ? t("sync_url_test_busy") : t("sync_test")}
          </motion.button>
          {reachable ? (
            <span class={reachable.ok ? "chip-success status-pill" : "chip-danger status-pill"}>
              <span class="status-dot" />
              {reachable.ok ? t("sync_reachable") : humanReachReason(reachable.reason)}
            </span>
          ) : null}
        </div>
      </div>

      <motion.button
        type="button"
        class="btn"
        whileTap={TAP_SCALE}
        disabled={reachable?.ok !== true}
        onClick={onContinue}
      >
        {t("sync_url_test_cta")}
      </motion.button>
    </motion.div>
  );
}

function AuthStep({
  email,
  setEmail,
  onBack,
  onSubmit,
}: {
  email: string;
  setEmail: (next: string) => void;
  onBack: () => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <motion.div
      class="flex flex-col gap-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <div class="card !p-5 flex flex-col gap-4">
        <Field label={t("sync_email_label")}>
          <input
            class="input"
            type="email"
            autocomplete="email"
            placeholder={t("sync_email_placeholder")}
            value={email}
            autoFocus
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </Field>
      </div>

      <div class="flex gap-2">
        <motion.button
          type="button"
          class="btn btn-ghost flex-1"
          whileTap={TAP_SCALE}
          onClick={onBack}
        >
          {t("sync_back")}
        </motion.button>
        <motion.button
          type="button"
          class="btn flex-1"
          whileTap={TAP_SCALE}
          disabled={email.trim().length === 0}
          onClick={() => void onSubmit()}
        >
          <IconUnlock size={14} />
          {t("sync_connect")}
        </motion.button>
      </div>
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
  // Stable ref so the interval keeps calling the latest onPoll without
  // re-arming on every parent render.
  const pollRef = useRef(onPoll);
  pollRef.current = onPoll;

  useEffect(() => {
    const id = setInterval(() => {
      setPolling(true);
      void pollRef.current().finally(() => setPolling(false));
    }, 6000);
    return () => clearInterval(id);
  }, []);

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
        onClick={() => void onAbort()}
      >
        {t("sync_pending_cancel")}
      </motion.button>
    </motion.div>
  );
}

function RejectedPanel({
  reason,
  onReset,
}: {
  reason: string | null;
  onReset: () => Promise<void>;
}) {
  return (
    <motion.div class="flex flex-col gap-4" variants={POP_IN} initial="initial" animate="animate">
      <div class="card !p-5 flex flex-col gap-2 border border-red-500/30">
        <strong class="text-sm text-(--color-ink)">{t("sync_rejected_title")}</strong>
        <p class="text-xs text-(--color-ink-muted) leading-relaxed">
          {reason !== null ? t("sync_rejected_reason", reason) : t("sync_rejected_default")}
        </p>
      </div>
      <motion.button
        type="button"
        class="btn self-start"
        whileTap={TAP_SCALE}
        onClick={() => void onReset()}
      >
        {t("sync_back")}
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

      <div class="card !p-5 flex flex-col gap-3">
        <div class="flex gap-2">
          <motion.button
            type="button"
            class="btn flex-1"
            whileTap={TAP_SCALE}
            onClick={() => void runPull()}
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
            onClick={() => void runPush()}
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
        onClick={() => void onDisconnect()}
      >
        {t("sync_disconnect")}
      </motion.button>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label class="flex flex-col gap-2">
      <span class="field-label">{label}</span>
      {children}
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
