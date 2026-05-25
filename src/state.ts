import { signal, computed } from "@preact/signals";

import type { AccountEntry, Profile } from "./types.js";

export type Screen =
  | "loading"
  | "setup"
  | "unlock"
  | "main"
  | "account-detail"
  | "settings"
  | "sync"
  | "vaults"
  | "quick-search";

export const screen = signal<Screen>("loading");
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

export const defaultProfile = signal<Profile | null>(null);

export const canGenerate = computed(
  () => activeDomain.value !== null && activeEmail.value.trim().length > 0,
);
