import { computed, signal } from "@preact/signals";

import type { AccountEntry, Profile } from "./types.js";

/**
 * High-level screen — the things rendered full-bleed without the app
 * shell (setup wizard, locked screen, the Spotlight-style overlay).
 * The unlocked surface is `"shell"`; the actual page inside the shell
 * is driven by `view`.
 */
export type Screen = "loading" | "setup" | "unlock" | "shell" | "quick-search";

/** Pages reachable from the sidebar inside the unlocked shell. */
export type ShellView = "generator" | "accounts" | "settings" | "sync" | "vaults";

export const screen = signal<Screen>("loading");
export const view = signal<ShellView>("generator");
/**
 * Lets Sync/Vaults reached from inside Settings expose a back arrow
 * that returns to Settings. Set when SettingsScreen navigates via
 * its LinkCards; cleared on sidebar navigation (the sidebar IS the
 * back path in that case).
 */
export const previousView = signal<ShellView | null>(null);
export const fingerprint = signal<string | null>(null);
export const hasPin = signal(false);
export const errorMessage = signal<string | null>(null);
export const busy = signal(false);

export const activeDomain = signal<string | null>(null);
export const activeEmail = signal<string>("");
export const generated = signal<string | null>(null);
export const livePreview = signal<string | null>(null);

export const allAccounts = signal<AccountEntry[]>([]);
export const selectedAccount = signal<AccountEntry | null>(null);
export const historyEnabled = signal(false);
export const faviconFallbackEnabled = signal(true);

export const defaultProfile = signal<Profile | null>(null);

export const canGenerate = computed(
  () => activeDomain.value !== null && activeEmail.value.trim().length > 0,
);
