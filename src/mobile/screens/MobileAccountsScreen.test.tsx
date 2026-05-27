import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileAccountsScreen } from "./MobileAccountsScreen.js";
import { searchQuery } from "../state.js";
import { allAccounts } from "../../state.js";

describe("<MobileAccountsScreen />", () => {
  it("renders the empty state when no accounts exist", () => {
    allAccounts.value = [];
    const root = document.createElement("div");
    render(<MobileAccountsScreen />, root);
    expect(root.textContent).toMatch(/Aucun compte encore|No accounts yet/);
  });

  it("filters accounts when searchQuery is set", () => {
    allAccounts.value = [
      {
        domain: "github.com",
        username: "u",
        lastUsedAt: 0,
        createdAt: 0,
        profile: {
          mode: "random",
          counter: 1,
          length: 16,
          lower: true,
          upper: true,
          digits: true,
          symbols: true,
        },
      },
      {
        domain: "twitter.com",
        username: "v",
        lastUsedAt: 0,
        createdAt: 0,
        profile: {
          mode: "random",
          counter: 1,
          length: 16,
          lower: true,
          upper: true,
          digits: true,
          symbols: true,
        },
      },
    ];
    const root = document.createElement("div");
    searchQuery.value = "github";
    render(<MobileAccountsScreen />, root);
    expect(root.textContent).toContain("github.com");
    expect(root.textContent).not.toContain("twitter.com");
    searchQuery.value = "";
  });
});
