import { useEffect, useRef, useState } from "preact/hooks";
import { motion } from "framer-motion";
import { t } from "../../i18n.js";
import { IconSearch, IconPlus } from "../../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { searchQuery } from "../state.js";
import { allAccounts, selectedAccount, activeDomain, activeEmail, view } from "../../state.js";
import { AccountAvatar } from "../../components/AccountAvatar.js";

const PULL_OPEN_THRESHOLD = 60;

export function MobileAccountsScreen() {
  const [pullOpen, setPullOpen] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (pullOpen) {
      const i = document.getElementById("mobile-search-input") as HTMLInputElement | null;
      i?.focus();
    }
  }, [pullOpen]);

  const filtered = allAccounts.value.filter((a) =>
    searchQuery.value === ""
      ? true
      : a.domain.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        a.username.toLowerCase().includes(searchQuery.value.toLowerCase()),
  );

  return (
    <section
      class="flex flex-col gap-2 pt-2 select-none pb-6"
      onTouchStart={(e) => { startY.current = e.touches[0]?.clientY ?? null; }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
        
        // Only trigger pull-to-search if the container is at the absolute top of its scroll range
        const mainEl = document.querySelector(".mobile-main");
        const scrollTop = mainEl ? mainEl.scrollTop : 0;
        
        if (scrollTop <= 2 && dy > PULL_OPEN_THRESHOLD && !pullOpen) {
          setPullOpen(true);
        }
      }}
      onTouchEnd={() => { startY.current = null; }}
    >
      <div class="flex items-center justify-between px-1 mb-2">
        <h2 class="text-[10px] uppercase tracking-[0.22em] text-(--color-ink-subtle) font-mono">
          {t("accounts_title")}
        </h2>
        <motion.button
          type="button"
          onClick={() => {
            activeDomain.value = null;
            activeEmail.value = "";
            view.value = "generator";
          }}
          whileTap={TAP_SCALE}
          class="min-h-11 rounded-full bg-(--color-ink) text-(--color-surface) px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 transition-all active:scale-[0.98] border-0 cursor-pointer"
        >
          <IconPlus size={14} />
          {t("common_new")}
        </motion.button>
      </div>

      <div class="pull-search-track" data-open={pullOpen}>
        <div class="relative w-full mb-3">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-(--color-ink-subtle)">
            <IconSearch size={16} />
          </span>
          <input
            id="mobile-search-input"
            type="search"
            inputMode="search"
            placeholder={t("mobile_accounts_search_placeholder")}
            value={searchQuery.value}
            onInput={(e) => { searchQuery.value = (e.target as HTMLInputElement).value; }}
            onBlur={() => { if (!searchQuery.value) setPullOpen(false); }}
            class="w-full pl-10 pr-4 py-3 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) text-[16px] text-(--color-ink) outline-none focus:border-(--color-accent-500) transition-colors"
          />
        </div>
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
            onClick={() => {
              activeDomain.value = null;
              activeEmail.value = "";
              view.value = "generator";
            }}
            class="rounded-full bg-(--color-ink) text-(--color-surface) px-5 py-2.5 text-[14px] font-medium transition-transform active:scale-[0.98]"
          >
            {t("mobile_accounts_empty_cta")}
          </button>
        </div>
      ) : (
        <ul class="flex flex-col gap-1.5">
          {filtered.map((account) => (
            <motion.li
              key={`${account.domain}|${account.username}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SOFT_SPRING}
              whileTap={TAP_SCALE}
              onClick={() => {
                selectedAccount.value = account;
              }}
              class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-3.5 py-3 flex items-center gap-3 cursor-pointer hover:border-(--color-line-strong) transition-all active:scale-[0.99] shadow-sm"
            >
              <AccountAvatar domain={account.domain} size={36} />
              <div class="flex-1 min-w-0">
                <p class="text-[14px] text-(--color-ink) font-medium truncate">{account.domain}</p>
                <p class="text-[11px] text-(--color-ink-muted) truncate">{account.username}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
