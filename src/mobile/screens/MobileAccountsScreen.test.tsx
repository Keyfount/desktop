import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileAccountsScreen } from "./MobileAccountsScreen.js";
import { searchQuery } from "../state.js";

describe("<MobileAccountsScreen />", () => {
  it("renders the empty state when no accounts exist", () => {
    const root = document.createElement("div");
    render(<MobileAccountsScreen accounts={[]} />, root);
    expect(root.textContent).toMatch(/Aucun compte encore|No accounts yet/);
  });

  it("filters accounts when searchQuery is set", () => {
    const root = document.createElement("div");
    searchQuery.value = "github";
    render(
      <MobileAccountsScreen
        accounts={[
          { domain: "github.com", username: "u", lastUsedAt: 0 },
          { domain: "twitter.com", username: "v", lastUsedAt: 0 },
        ]}
      />,
      root,
    );
    expect(root.textContent).toContain("github.com");
    expect(root.textContent).not.toContain("twitter.com");
    searchQuery.value = "";
  });
});
