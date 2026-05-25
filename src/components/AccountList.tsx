import { motion } from "framer-motion";

import { IconKey, IconPlus } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { activeDomain, activeEmail, allAccounts, selectedAccount, screen } from "../state.js";
import type { AccountEntry } from "../types.js";

interface Props {
  onAddNew: () => void;
}

export function AccountList({ onAddNew }: Props) {
  return (
    <motion.div
      class="flex flex-col gap-2"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <motion.button type="button" class="account-row" whileTap={TAP_SCALE} onClick={onAddNew}>
        <span class="account-row__favicon">
          <IconPlus size={14} />
        </span>
        <div class="flex flex-col text-sm">
          <span class="text-(--color-ink)">Generate a new password</span>
          <span class="field-hint">Add a fresh site</span>
        </div>
      </motion.button>
      {allAccounts.value.map((entry) => (
        <AccountRow key={`${entry.domain}|${entry.username}`} entry={entry} />
      ))}
    </motion.div>
  );
}

function AccountRow({ entry }: { entry: AccountEntry }) {
  return (
    <motion.button
      type="button"
      class="account-row"
      whileTap={TAP_SCALE}
      onClick={() => {
        activeDomain.value = entry.domain;
        activeEmail.value = entry.username;
        selectedAccount.value = entry;
        screen.value = "account-detail";
      }}
    >
      <span class="account-row__favicon">
        <IconKey size={14} />
      </span>
      <div class="flex flex-col text-sm min-w-0">
        <span class="text-(--color-ink) truncate" title={entry.domain}>
          {entry.domain}
        </span>
        <span class="field-hint truncate" title={entry.username}>
          {entry.username}
        </span>
      </div>
    </motion.button>
  );
}
