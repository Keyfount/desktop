import { useEffect, useRef, useState } from "preact/hooks";
import { motion } from "framer-motion";
import { t } from "../../i18n.js";
import { SOFT_SPRING } from "../../motion.js";
import { searchQuery } from "../state.js";

export interface MobileAccountRow {
  domain: string;
  username: string;
  lastUsedAt: number;
}

interface Props {
  accounts: MobileAccountRow[];
}

const PULL_OPEN_THRESHOLD = 60;

export function MobileAccountsScreen({ accounts }: Props) {
  const [pullOpen, setPullOpen] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (pullOpen) {
      const i = document.getElementById("mobile-search-input") as HTMLInputElement | null;
      i?.focus();
    }
  }, [pullOpen]);

  const filtered = accounts.filter((a) =>
    searchQuery.value === ""
      ? true
      : a.domain.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        a.username.toLowerCase().includes(searchQuery.value.toLowerCase()),
  );

  return (
    <section
      class="flex flex-col gap-2 pt-2 select-none"
      onTouchStart={(e) => { startY.current = e.touches[0]?.clientY ?? null; }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
        if (dy > PULL_OPEN_THRESHOLD && !pullOpen) setPullOpen(true);
      }}
      onTouchEnd={() => { startY.current = null; }}
    >
      <div class="pull-search-track" data-open={pullOpen}>
        <input
          id="mobile-search-input"
          type="search"
          inputMode="search"
          placeholder={t("mobile_accounts_search_placeholder")}
          value={searchQuery.value}
          onInput={(e) => { searchQuery.value = (e.target as HTMLInputElement).value; }}
          onBlur={() => { if (!searchQuery.value) setPullOpen(false); }}
          class="w-full mb-3 px-4 py-3 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) text-[15px] text-(--color-ink) outline-none"
        />
      </div>

      {!pullOpen ? (
        <p class="text-center text-[11px] text-(--color-ink-subtle) py-1">
          {t("mobile_accounts_search_hint")}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div class="flex flex-col items-center justify-center py-16 text-center gap-3">
          <p class="text-[15px] text-(--color-ink-muted)">{t("mobile_accounts_empty_title")}</p>
          <button
            type="button"
            class="rounded-full bg-(--color-ink) text-(--color-surface) px-5 py-2 text-[14px] font-medium"
          >
            {t("mobile_accounts_empty_cta")}
          </button>
        </div>
      ) : (
        <ul class="flex flex-col gap-1">
          {filtered.map((account) => (
            <motion.li
              key={account.domain}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SOFT_SPRING}
              class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-3 py-3 flex items-center gap-3"
            >
              <div class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center text-[14px] font-semibold text-(--color-ink-muted)">
                {account.domain[0]?.toUpperCase() ?? "?"}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-[14px] text-(--color-ink) truncate">{account.domain}</p>
                <p class="text-[11px] text-(--color-ink-muted) truncate">{account.username}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
