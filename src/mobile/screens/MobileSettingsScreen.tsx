import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { IconChevronLeft, IconChevronRight, IconLock } from "../../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { detectPlatform } from "../../platform.js";
import {
  allAccounts,
  defaultProfile,
  errorMessage,
  faviconFallbackEnabled,
  historyEnabled,
  view,
} from "../../state.js";
import { clearSession, disconnect, loadStoredSession } from "../../sync/manager.js";
import { syncServerStatus } from "../../sync/status.js";
import type { GetStateResponse, Profile } from "../../types.js";
import { ConfirmModal } from "../../components/ConfirmModal.js";
import { DangerZone } from "../../components/DangerZone.js";
import { PinManager } from "../../components/PinManager.js";
import { ProfileEditor } from "../../components/ProfileEditor.js";
import { SitesSection } from "../../components/SitesSection.js";
import { VaultExportImport } from "../../components/VaultExportImport.js";

type SubPage = "generation" | "security" | "accounts" | "sync" | "comfort" | "danger";

interface Props {
  onLock?: () => void;
}

const SECTION_CLASSES =
  "rounded-2xl bg-(--color-surface-elev) border border-(--color-line) overflow-hidden flex flex-col";
const ROW_CLASSES =
  "w-full flex items-center justify-between px-4 py-3.5 text-left bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink) border-b border-(--color-line) last:border-b-0";

export function MobileSettingsScreen({ onLock }: Props) {
  const [state, setState] = useState<GetStateResponse | null>(null);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [page, setPage] = useState<SubPage | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const next = await api.getState();
      setState(next);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    void refreshState();
    void api.autofillStatus().then((r) => setAutofillEnabled(r.enabled));
    void api
      .biometricAvailable()
      .then((r) => {
        setBiometricSupported(r.supported);
        setBiometricEnrolled(r.enrolled);
        setBiometricEnabled(r.vaultEnrolled);
      })
      .catch(() => {
        setBiometricSupported(false);
        setBiometricEnrolled(false);
        setBiometricEnabled(false);
      });
  }, [refreshState]);

  const setDefault = useCallback(async (next: Profile) => {
    await api.setDefaultProfile(next);
    defaultProfile.value = next;
    setState((s) => (s ? { ...s, defaultProfile: next } : s));
  }, []);

  const [historyConfirm, setHistoryConfirm] = useState<{
    accountCount: number;
    syncConnected: boolean;
  } | null>(null);

  const toggleHistory = useCallback(async (next: boolean) => {
    if (next) {
      await api.setHistoryEnabled(true);
      historyEnabled.value = true;
      setState((s) => (s ? { ...s, historyEnabled: true } : s));
      return;
    }
    let accountCount = 0;
    try {
      const r = await api.listAccounts();
      accountCount = r.entries.length;
    } catch {
      /* swallow */
    }
    let syncConnected = false;
    try {
      const s = await loadStoredSession();
      syncConnected = s !== null && s.status === "approved";
    } catch {
      /* swallow */
    }
    if (accountCount === 0 && !syncConnected) {
      await api.setHistoryEnabled(false);
      historyEnabled.value = false;
      setState((s) => (s ? { ...s, historyEnabled: false } : s));
      return;
    }
    setHistoryConfirm({ accountCount, syncConnected });
  }, []);

  const confirmDisableHistory = useCallback(async () => {
    if (historyConfirm === null) return;
    try {
      if (historyConfirm.syncConnected) {
        await disconnect();
      } else {
        await clearSession().catch(() => {});
      }
      const fresh = await api.listAccounts();
      for (const e of fresh.entries) {
        await api.deleteAccount(e.domain, e.username, { skipBus: true });
      }
      allAccounts.value = [];
      await api.setHistoryEnabled(false);
      historyEnabled.value = false;
      setState((s) => (s ? { ...s, historyEnabled: false } : s));
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_history_toggle_failed");
    } finally {
      setHistoryConfirm(null);
    }
  }, [historyConfirm]);

  if (state === null) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        class="flex flex-col gap-4 pt-2 pb-6"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} class="skeleton h-20 w-full rounded-2xl" />
        ))}
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="flex flex-col pt-2 pb-12 select-none"
    >
      <AnimatePresence mode="wait">
        {page === null ? (
          <MenuView key="menu" onSelect={setPage} onLock={onLock} />
        ) : (
          <SubPageView
            key={page}
            page={page}
            state={state}
            refreshState={refreshState}
            setState={setState}
            setDefault={setDefault}
            toggleHistory={toggleHistory}
            autofillEnabled={autofillEnabled}
            setAutofillEnabled={setAutofillEnabled}
            biometricEnabled={biometricEnabled}
            biometricSupported={biometricSupported}
            biometricEnrolled={biometricEnrolled}
            setBiometricEnabled={setBiometricEnabled}
            onBack={() => setPage(null)}
          />
        )}
      </AnimatePresence>

      {errorMessage.value !== null ? (
        <div class="text-xs text-(--color-danger) mt-4 px-2" role="alert">
          {errorMessage.value}
        </div>
      ) : null}

      {historyConfirm !== null ? (
        <ConfirmModal
          title={t("settings_history_disable_title")}
          body={historyDisableBody(historyConfirm)}
          confirmLabel={t("settings_history_disable_confirm")}
          onCancel={() => setHistoryConfirm(null)}
          onConfirm={() => void confirmDisableHistory()}
        />
      ) : null}
    </motion.section>
  );
}

function historyDisableBody(c: { accountCount: number; syncConnected: boolean }): string {
  if (c.accountCount > 0 && c.syncConnected) {
    return t("settings_history_disable_body_both", String(c.accountCount));
  }
  if (c.accountCount > 0) {
    return t("settings_history_disable_body_accounts", String(c.accountCount));
  }
  return t("settings_history_disable_body_sync");
}

// --- Menu ----------------------------------------------------------------

function MenuView({
  onSelect,
  onLock,
}: {
  onSelect: (p: SubPage) => void;
  onLock?: (() => void) | undefined;
}) {
  const rows: { id: SubPage; title: string; hint: string }[] = [
    {
      id: "generation",
      title: t("settings_group_generation"),
      hint: t("settings_group_generation_hint"),
    },
    {
      id: "security",
      title: t("settings_group_security"),
      hint: t("settings_group_security_hint"),
    },
    {
      id: "accounts",
      title: t("settings_group_accounts"),
      hint: t("settings_group_accounts_hint"),
    },
    { id: "sync", title: t("settings_group_sync"), hint: t("settings_group_sync_hint") },
    { id: "comfort", title: t("settings_group_comfort"), hint: t("settings_group_comfort_hint") },
    { id: "danger", title: t("settings_group_danger"), hint: t("settings_group_danger_hint") },
  ];

  return (
    <motion.div
      key="menu"
      class="flex flex-col"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={SOFT_SPRING}
    >
      <div class={`${SECTION_CLASSES} mt-2`}>
        {rows.map((r) => (
          <motion.button
            key={r.id}
            type="button"
            class={ROW_CLASSES}
            whileTap={TAP_SCALE}
            onClick={() => onSelect(r.id)}
          >
            <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
              <span class="font-medium">{r.title}</span>
              <span class="text-xs text-(--color-ink-subtle)">{r.hint}</span>
            </div>
            <IconChevronRight size={16} class="opacity-50" />
          </motion.button>
        ))}
      </div>

      {onLock ? (
        <div class={`${SECTION_CLASSES} mt-4`}>
          <motion.button
            type="button"
            data-action="lock"
            class={`${ROW_CLASSES} !text-red-500 font-medium`}
            whileTap={TAP_SCALE}
            onClick={onLock}
          >
            <div class="flex items-center gap-2">
              <IconLock size={16} />
              <span>{t("sidebar_lock")}</span>
            </div>
            <IconChevronRight size={16} class="opacity-50" />
          </motion.button>
        </div>
      ) : null}

      <div class={`${SECTION_CLASSES} mt-4`}>
        <div class={ROW_CLASSES}>
          <span>Keyfount</span>
          <span class="text-xs text-(--color-ink-subtle)">v0.1.0</span>
        </div>
      </div>
    </motion.div>
  );
}

// --- SubPage -------------------------------------------------------------

interface SubPageProps {
  page: SubPage;
  state: GetStateResponse;
  refreshState: () => Promise<void>;
  setState: (next: GetStateResponse | null) => void;
  setDefault: (next: Profile) => Promise<void>;
  toggleHistory: (next: boolean) => Promise<void>;
  autofillEnabled: boolean;
  setAutofillEnabled: (next: boolean) => void;
  biometricEnabled: boolean;
  biometricSupported: boolean;
  biometricEnrolled: boolean;
  setBiometricEnabled: (next: boolean) => void;
  onBack: () => void;
}

function SubPageView(props: SubPageProps) {
  return (
    <motion.div
      key={props.page}
      class="flex flex-col gap-4 pt-2"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={SOFT_SPRING}
    >
      <div class="flex items-center gap-2 px-2">
        <motion.button
          type="button"
          class="flex items-center gap-1 py-1.5 px-1 text-sm text-(--color-ink-muted) bg-transparent border-0 cursor-pointer"
          whileTap={TAP_SCALE}
          onClick={props.onBack}
          aria-label={t("common_back")}
        >
          <IconChevronLeft size={16} />
          {t("common_back")}
        </motion.button>
      </div>

      <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pb-1 font-mono">
        {pageTitle(props.page)}
      </h2>

      {props.page === "generation" ? <GenerationPage {...props} /> : null}
      {props.page === "security" ? <SecurityPage {...props} /> : null}
      {props.page === "accounts" ? <AccountsPage {...props} /> : null}
      {props.page === "sync" ? <SyncPage /> : null}
      {props.page === "comfort" ? <ComfortPage {...props} /> : null}
      {props.page === "danger" ? <DangerPage {...props} /> : null}
    </motion.div>
  );
}

function pageTitle(p: SubPage): string {
  switch (p) {
    case "generation":
      return t("settings_group_generation");
    case "security":
      return t("settings_group_security");
    case "accounts":
      return t("settings_group_accounts");
    case "sync":
      return t("settings_group_sync");
    case "comfort":
      return t("settings_group_comfort");
    case "danger":
      return t("settings_group_danger");
  }
}

function GenerationPage({ state, refreshState, setDefault }: SubPageProps) {
  return (
    <>
      <SectionLabel>{t("settings_default_profile")}</SectionLabel>
      <div class={SECTION_CLASSES}>
        <div class="p-4">
          <ProfileEditor profile={state.defaultProfile} onChange={setDefault} compact />
        </div>
      </div>

      <SectionLabel>{t("sites_section_title")}</SectionLabel>
      <div class={SECTION_CLASSES}>
        <div class="p-4">
          <SitesSection sites={state.sites} onChange={refreshState} />
        </div>
      </div>
    </>
  );
}

function SecurityPage({
  state,
  setState,
  refreshState,
  biometricEnabled,
  biometricSupported,
  biometricEnrolled,
  setBiometricEnabled,
}: SubPageProps) {
  return (
    <>
      <div class={SECTION_CLASSES}>
        <NumberRow
          label={t("settings_auto_lock")}
          unit="min"
          value={state.autoLockMinutes}
          min={0}
          max={240}
          onChange={async (n) => {
            await api.setAutoLockMinutes(n);
            setState({ ...state, autoLockMinutes: n });
          }}
        />
        <NumberRow
          label={t("settings_clipboard_clear")}
          unit="s"
          value={state.clipboardClearSeconds}
          min={0}
          max={600}
          onChange={async (n) => {
            await api.setClipboardClearSeconds(n);
            setState({ ...state, clipboardClearSeconds: n });
          }}
        />
        {biometricSupported ? (
          <BiometricRow
            checked={biometricEnabled}
            enrolled={biometricEnrolled}
            setEnabled={setBiometricEnabled}
          />
        ) : null}
      </div>

      <SectionLabel>{t("pin_section_title")}</SectionLabel>
      <div class={SECTION_CLASSES}>
        <div class="p-4">
          <p class="text-xs text-(--color-ink-muted) leading-relaxed mb-3">
            {t("pin_section_hint")}
          </p>
          <PinManager hasPin={state.hasPin} onChange={refreshState} />
        </div>
      </div>

      <div class={SECTION_CLASSES}>
        <button
          type="button"
          class={ROW_CLASSES}
          onClick={() => {
            view.value = "vaults";
          }}
        >
          <span class="font-medium">{t("settings_vaults_hint")}</span>
          <IconChevronRight size={16} class="opacity-50" />
        </button>
      </div>
    </>
  );
}

function AccountsPage({ state, toggleHistory }: SubPageProps) {
  return (
    <div class={SECTION_CLASSES}>
      <div class={ROW_CLASSES}>
        <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
          <span class="font-medium">{t("settings_history_label")}</span>
          <span class="text-xs text-(--color-ink-subtle)">{t("settings_history_hint")}</span>
        </div>
        <label class="switch shrink-0">
          <input
            type="checkbox"
            checked={state.historyEnabled}
            onChange={(e) => void toggleHistory((e.target as HTMLInputElement).checked)}
          />
          <span class="switch-track" />
          <span class="switch-thumb" />
        </label>
      </div>
    </div>
  );
}

function SyncPage() {
  if (!historyEnabled.value) {
    return (
      <div class={SECTION_CLASSES}>
        <div class="p-4">
          <p class="text-sm text-(--color-ink-muted) leading-relaxed">
            {t("settings_history_off_sync_hint")}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div class={SECTION_CLASSES}>
      <button
        type="button"
        class={ROW_CLASSES}
        onClick={() => {
          view.value = "sync";
        }}
      >
        <div class="flex items-center gap-2">
          <span
            class={
              "inline-block h-2.5 w-2.5 rounded-full " +
              (syncServerStatus.value === "online"
                ? "bg-emerald-500"
                : syncServerStatus.value === "offline"
                  ? "bg-red-500"
                  : "bg-amber-400")
            }
          />
          <span class="font-medium">{t("settings_sync")}</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-(--color-ink-subtle)">
          <span>
            {syncServerStatus.value === "online"
              ? t("sync_status_dot_online")
              : syncServerStatus.value === "offline"
                ? t("sync_status_dot_offline")
                : syncServerStatus.value === "checking"
                  ? t("sync_status_dot_checking")
                  : ""}
          </span>
          <IconChevronRight size={16} class="opacity-50" />
        </div>
      </button>
    </div>
  );
}

function ComfortPage({ state, setState, autofillEnabled, setAutofillEnabled }: SubPageProps) {
  return (
    <div class={SECTION_CLASSES}>
      <div class={ROW_CLASSES}>
        <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
          <span class="font-medium">{t("settings_favicon_label")}</span>
          <span class="text-xs text-(--color-ink-subtle)">{t("settings_favicon_hint")}</span>
        </div>
        <label class="switch shrink-0">
          <input
            type="checkbox"
            checked={state.faviconFallbackEnabled}
            onChange={async (e) => {
              const active = (e.target as HTMLInputElement).checked;
              await api.setFaviconFallbackEnabled(active);
              faviconFallbackEnabled.value = active;
              setState({ ...state, faviconFallbackEnabled: active });
            }}
          />
          <span class="switch-track" />
          <span class="switch-thumb" />
        </label>
      </div>
      <div class={ROW_CLASSES}>
        <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
          <span class="font-medium">{t("settings_autofill_label")}</span>
          <span class="text-xs text-(--color-ink-subtle)">{t("settings_autofill_hint")}</span>
        </div>
        <label class="switch shrink-0">
          <input
            type="checkbox"
            checked={autofillEnabled}
            onChange={async (e) => {
              const active = (e.target as HTMLInputElement).checked;
              try {
                if (active) {
                  await api.enableAutofill();
                } else {
                  await api.disableAutofill();
                }
                setAutofillEnabled(active);
              } catch (err) {
                errorMessage.value = describeError(err) || t("err_autofill_toggle_failed");
              }
            }}
          />
          <span class="switch-track" />
          <span class="switch-thumb" />
        </label>
      </div>
    </div>
  );
}

function DangerPage({ refreshState }: SubPageProps) {
  return (
    <>
      <SectionLabel>{t("export_section_title")}</SectionLabel>
      <div class={SECTION_CLASSES}>
        <div class="p-4">
          <VaultExportImport onImported={refreshState} />
        </div>
      </div>

      <SectionLabel>{t("settings_danger")}</SectionLabel>
      <div class={`${SECTION_CLASSES} border-red-500/40`}>
        <div class="p-4">
          <DangerZone />
        </div>
      </div>
    </>
  );
}

// --- Helpers -------------------------------------------------------------

function SectionLabel({ children }: { children: ComponentChildren }) {
  return (
    <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) px-2 pt-3 pb-1 font-mono">
      {children}
    </h2>
  );
}

function NumberRow({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void | Promise<void>;
}) {
  return (
    <div class={ROW_CLASSES}>
      <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
        <span class="font-medium">{label}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onInput={async (e) => {
            const val = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(val)) {
              const bounded = Math.max(min, Math.min(max, Math.floor(val)));
              await onChange(bounded);
            }
          }}
          class="w-16 h-8 rounded-lg bg-(--color-surface-sunken) text-center text-[15px] font-semibold text-(--color-ink) border border-(--color-line) outline-none focus:border-(--color-accent-500) transition-colors"
        />
        <span class="text-xs text-(--color-ink-muted)">{unit}</span>
      </div>
    </div>
  );
}

function BiometricRow({
  checked,
  enrolled,
  setEnabled,
}: {
  checked: boolean;
  enrolled: boolean;
  setEnabled: (v: boolean) => void;
}) {
  const label = (() => {
    const p = detectPlatform();
    if (p === "macos" || p === "ios") return t("biometric_toggle_label_touchid");
    if (p === "windows") return t("biometric_toggle_label_windowshello");
    return t("biometric_toggle_label");
  })();
  return (
    <div class={ROW_CLASSES}>
      <div class="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
        <span class="font-medium">{label}</span>
        <span class="text-xs text-(--color-ink-subtle)">
          {enrolled ? t("biometric_toggle_hint") : t("biometric_toggle_not_enrolled_hint")}
        </span>
      </div>
      <label class="switch shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={!enrolled}
          onChange={async (e) => {
            const active = (e.target as HTMLInputElement).checked;
            try {
              if (active) {
                await api.enableBiometric();
              } else {
                await api.disableBiometric();
              }
              setEnabled(active);
              errorMessage.value = null;
            } catch (err) {
              const raw = describeError(err);
              errorMessage.value = raw.toLowerCase().includes("unsupported")
                ? t("biometric_unsupported")
                : t("biometric_toggle_failed", raw);
            }
          }}
        />
        <span class="switch-track" />
        <span class="switch-thumb" />
      </label>
    </div>
  );
}
