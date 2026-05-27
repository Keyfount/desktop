import { useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api } from "../api.js";
import { t } from "../i18n.js";
import { IconDownload, IconTrash, IconUpload } from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import type { Profile } from "../types.js";
import { AccountAvatar } from "./AccountAvatar.js";
import { ProfileEditor } from "./ProfileEditor.js";

interface Props {
  sites: Record<string, Profile>;
  onChange: () => void | Promise<void>;
}

/**
 * Manage per-site profile overrides. Each entry maps a domain to a
 * Profile that wins over the default whenever the user generates a
 * password for that site. Ported from the extension's SitesSection
 * — same shape (cards with an expand affordance) so the cross-
 * platform navigation feels identical.
 */
export function SitesSection({ sites, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const domains = Object.keys(sites).sort();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(sites, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = t("sites_export_filename", date);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, Profile>;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not_object");
      }
      for (const [domain, profile] of Object.entries(parsed)) {
        await api.setProfile(domain, profile);
      }
      await onChange();
    } catch {
      setImportError(t("err_sites_import_failed"));
    }
  };

  const remove = async (domain: string) => {
    await api.deleteProfile(domain);
    if (expanded === domain) setExpanded(null);
    await onChange();
  };

  const updateProfile = async (domain: string, profile: Profile) => {
    await api.setProfile(domain, profile);
    await onChange();
  };

  return (
    <motion.section
      class="flex flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
      initial="initial"
      animate="animate"
    >
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <p class="text-xs text-(--color-ink-muted) leading-relaxed flex-1 min-w-[12rem]">
          {t("sites_section_hint")}
        </p>
        <div class="flex gap-2">
          <label class="btn btn-ghost btn-sm cursor-pointer relative overflow-hidden">
            <IconUpload size={14} />
            {t("sites_import_cta")}
            <input
              type="file"
              accept="application/json,.json"
              class="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void importJson(file);
              }}
            />
          </label>
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm"
            whileTap={TAP_SCALE}
            disabled={domains.length === 0}
            onClick={exportJson}
          >
            <IconDownload size={14} />
            {t("sites_export_cta")}
          </motion.button>
        </div>
      </div>

      {importError !== null ? (
        <div class="field-error" role="alert">
          {importError}
        </div>
      ) : null}

      {domains.length === 0 ? (
        <p class="text-sm text-(--color-ink-muted) leading-relaxed">{t("sites_empty")}</p>
      ) : (
        <ul class="flex flex-col gap-2 list-none p-0 m-0">
          {domains.map((domain) => {
            const profile = sites[domain];
            if (!profile) return null;
            const isOpen = expanded === domain;
            return (
              <li key={domain}>
                <div class="card !p-3 flex flex-col gap-3">
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full text-left cursor-pointer bg-transparent border-0 p-0"
                    onClick={() => setExpanded(isOpen ? null : domain)}
                    aria-expanded={isOpen}
                    aria-label={t("sites_card_label", domain)}
                  >
                    <AccountAvatar domain={domain} size={32} />
                    <div class="flex flex-col flex-1 min-w-0">
                      <span class="text-sm text-(--color-ink) truncate font-medium">
                        {domain.replace(/^www\./, "")}
                      </span>
                      <span class="field-hint">
                        {profile.mode === "random" ? t("profile_random") : t("profile_memorable")}
                      </span>
                    </div>
                    <motion.button
                      type="button"
                      class="btn btn-ghost btn-icon btn-sm"
                      whileTap={TAP_SCALE}
                      onClick={(event: Event) => {
                        event.stopPropagation();
                        void remove(domain);
                      }}
                      aria-label={t("sites_delete_aria")}
                    >
                      <IconTrash size={14} />
                    </motion.button>
                  </button>
                  <AnimatePresence>
                    {isOpen ? (
                      <motion.div
                        key="editor"
                        class="overflow-hidden"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1, transition: SOFT_SPRING }}
                        exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
                        variants={POP_IN}
                      >
                        <div class="pt-2 border-t border-(--color-line)/60">
                          <ProfileEditor
                            profile={profile}
                            onChange={(next) => void updateProfile(domain, next)}
                          />
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}
