import { signal } from "@preact/signals";

/** Bottom sheet over the mobile shell that lists the vaults. */
export const vaultSheetOpen = signal(false);

/** Text typed in the pull-to-search bar on MobileAccountsScreen. */
export const searchQuery = signal("");

/**
 * Setup screen is reused for two flows: first-run (no vault yet) and
 * "create an additional vault from VaultSheet". This flag picks the
 * cancel-back affordance in the latter case.
 */
export const additionalVaultMode = signal(false);
