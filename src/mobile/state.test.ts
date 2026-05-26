import { describe, expect, it } from "vitest";
import { vaultSheetOpen, searchQuery, additionalVaultMode } from "./state.js";

describe("mobile state signals", () => {
  it("vaultSheetOpen defaults to false", () => {
    expect(vaultSheetOpen.value).toBe(false);
  });
  it("searchQuery defaults to empty string", () => {
    expect(searchQuery.value).toBe("");
  });
  it("additionalVaultMode defaults to false", () => {
    expect(additionalVaultMode.value).toBe(false);
  });
});
