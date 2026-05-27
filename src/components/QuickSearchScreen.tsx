import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";

import { api, describeError } from "../api.js";
import { t } from "../i18n.js";
import { IconCheck, IconCopy, IconSearch } from "../icons.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { allAccounts, errorMessage, screen } from "../state.js";
import type { AccountEntry } from "../types.js";
import { AccountAvatar } from "./AccountAvatar.js";

export function QuickSearchScreen() {
  const [query, setQuery] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.listAccounts().then((r) => (allAccounts.value = r.entries));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        screen.value = "shell";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return allAccounts.value.slice(0, 8);
    return allAccounts.value
      .filter((e) => e.domain.includes(q) || e.username.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, allAccounts.value]);

  const generate = useCallback(async (entry: AccountEntry) => {
    setBusy(true);
    try {
      const r = await api.generate(entry.domain, entry.username, entry.profile);
      setGenerated(r.password);
      await api.copyWithAutoClear(r.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      errorMessage.value = describeError(err) || t("err_generation_failed");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <motion.div
      class="flex flex-col items-center min-h-screen pt-20 px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={SOFT_SPRING}
    >
      <div class="w-full max-w-lg flex flex-col gap-3">
        <div class="flex items-center gap-2 px-4 py-3 rounded-2xl bg-(--color-surface-elev) border border-(--color-line)">
          <IconSearch size={16} />
          <input
            type="text"
            autoFocus
            class="flex-1 bg-transparent outline-none text-(--color-ink)"
            placeholder={t("common_quick_search")}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>

        {matches.length === 0 ? (
          <p class="text-(--color-ink-muted) text-sm text-center mt-4">{t("common_no_matches")}</p>
        ) : (
          <ul class="flex flex-col gap-1">
            {matches.map((entry) => (
              <li key={`${entry.domain}|${entry.username}`}>
                <motion.button
                  type="button"
                  class="account-row w-full"
                  whileTap={TAP_SCALE}
                  onClick={() => generate(entry)}
                  disabled={busy}
                >
                  <AccountAvatar domain={entry.domain} size={28} />
                  <div class="flex flex-col text-left min-w-0 flex-1">
                    <span class="text-sm text-(--color-ink) truncate">{entry.domain}</span>
                    <span class="field-hint truncate">{entry.username}</span>
                  </div>
                </motion.button>
              </li>
            ))}
          </ul>
        )}

        <AnimatePresence>
          {generated !== null ? (
            <motion.div
              key="output"
              class="flex items-center gap-2 px-4 py-3 rounded-2xl bg-(--color-surface-sunken) border border-(--color-line)"
              variants={POP_IN}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <code class="font-mono text-sm break-all flex-1 text-(--color-ink)">
                {"•".repeat(Math.min(generated.length, 24))}
              </code>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
