import { describe, expect, it } from "vitest";
import { t } from "./i18n.js";

const MOBILE_KEYS = [
  "mobile_vault_sheet_title",
  "mobile_vault_sheet_new",
  "mobile_vault_sheet_lock",
  "mobile_vault_sheet_active",
  "mobile_accounts_search_placeholder",
  "mobile_accounts_search_hint",
  "mobile_accounts_empty_title",
  "mobile_accounts_empty_cta",
  "mobile_accounts_row_actions_rename",
  "mobile_accounts_row_actions_edit_profile",
  "mobile_accounts_row_actions_delete",
  "mobile_settings_section_lock",
  "mobile_settings_section_account",
  "mobile_settings_section_sync",
  "mobile_settings_section_data",
  "mobile_settings_section_about",
  "mobile_setup_additional_vault_title",
  "mobile_setup_additional_vault_cancel",
] as const;

describe("mobile_* i18n keys", () => {
  it("every mobile_* key resolves to a non-empty string", () => {
    for (const key of MOBILE_KEYS) {
      const value = t(key as never);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
      expect(value).not.toBe(key);
    }
  });
});
