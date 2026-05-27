import { useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconDownload, IconUpload } from "../icons.js";
import { POP_IN, TAP_SCALE } from "../motion.js";

interface Props {
  /**
   * Called after a successful import so the parent can refresh the
   * accounts list and any per-site profile cache.
   */
  onImported?: () => void | Promise<void>;
}

/**
 * Export + import an encrypted vault envelope.
 *
 * Export builds a JSON envelope on the Rust side (passphrase-derived
 * AES-GCM) and we trigger a download via a Blob + anchor — works in
 * the Tauri webview without needing the dialog plugin.
 *
 * Import accepts a file via `<input type="file">`, reads it as text,
 * asks for the passphrase, and hands both to `api.importVault`.
 */
export function VaultExportImport({ onImported }: Props) {
  // Export side.
  const [exportPass, setExportPass] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Import side.
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPass, setImportPass] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDone, setImportDone] = useState<{ accounts: number; sites: number } | null>(null);

  const onExport = async (event: Event) => {
    event.preventDefault();
    setExportError(null);
    if (exportPass.length < 12) {
      setExportError(t("setup_min_length_error", "12"));
      return;
    }
    setExportBusy(true);
    try {
      const r = await api.exportVault(exportPass);
      const blob = new Blob([r.envelope], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = t("export_filename", date);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportPass("");
    } catch (err) {
      setExportError(describeError(err) || t("err_export_failed"));
    } finally {
      setExportBusy(false);
    }
  };

  const onImport = async (event: Event) => {
    event.preventDefault();
    setImportError(null);
    setImportDone(null);
    if (importFile === null) return;
    setImportBusy(true);
    try {
      const text = await importFile.text();
      const r = await api.importVault(text, importPass);
      setImportDone({ accounts: r.accountsImported, sites: r.sitesImported });
      setImportFile(null);
      setImportPass("");
      if (onImported) await onImported();
    } catch (err) {
      setImportError(describeError(err) || t("err_import_failed"));
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div class="flex flex-col gap-6">
      {/* --- Export ---------------------------------------------------- */}
      <form class="flex flex-col gap-3" onSubmit={onExport}>
        <p class="text-xs text-(--color-ink-muted) leading-relaxed">{t("export_section_hint")}</p>
        <label class="flex flex-col gap-2">
          <span class="field-label">{t("export_passphrase_label")}</span>
          <input
            class="input"
            type="password"
            minLength={12}
            value={exportPass}
            autocomplete="new-password"
            onInput={(e) => setExportPass((e.target as HTMLInputElement).value)}
          />
          <span class="field-hint">{t("export_passphrase_hint")}</span>
        </label>
        {exportError !== null ? (
          <div class="field-error" role="alert">
            {exportError}
          </div>
        ) : null}
        <motion.button
          type="submit"
          class="btn btn-sm self-start"
          whileTap={TAP_SCALE}
          disabled={exportBusy || exportPass.length < 12}
        >
          <IconDownload size={14} />
          {exportBusy ? t("export_busy") : t("export_button")}
        </motion.button>
      </form>

      <hr class="border-(--color-line)" />

      {/* --- Import ---------------------------------------------------- */}
      <form class="flex flex-col gap-3" onSubmit={onImport}>
        <p class="text-xs text-(--color-ink-muted) leading-relaxed">{t("import_section_hint")}</p>
        <label class="flex flex-col gap-2">
          <span class="field-label">{t("import_choose_file")}</span>
          <input
            class="input"
            type="file"
            accept=".keyfountvault,application/json"
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0] ?? null;
              setImportFile(file);
              setImportError(null);
              setImportDone(null);
            }}
          />
        </label>
        <label class="flex flex-col gap-2">
          <span class="field-label">{t("import_passphrase_label")}</span>
          <input
            class="input"
            type="password"
            value={importPass}
            autocomplete="off"
            onInput={(e) => setImportPass((e.target as HTMLInputElement).value)}
          />
        </label>
        {importError !== null ? (
          <div class="field-error" role="alert">
            {importError}
          </div>
        ) : null}
        <AnimatePresence>
          {importDone !== null ? (
            <motion.div
              key="ok"
              class="callout callout-success"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {t("import_done", String(importDone.accounts), String(importDone.sites))}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <motion.button
          type="submit"
          class="btn btn-sm self-start"
          whileTap={TAP_SCALE}
          disabled={importBusy || importFile === null || importPass.length === 0}
        >
          <IconUpload size={14} />
          {importBusy ? t("import_busy") : t("import_button")}
        </motion.button>
      </form>
    </div>
  );
}
