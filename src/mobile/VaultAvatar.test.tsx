import { describe, expect, it } from "vitest";
import { render } from "preact";
import { VaultAvatar, firstEmoji } from "./VaultAvatar.js";

describe("firstEmoji", () => {
  it("returns the first space-separated chunk", () => {
    expect(firstEmoji("🐉 🐱 🦊")).toBe("🐉");
  });
  it("returns ? on empty input", () => {
    expect(firstEmoji("")).toBe("?");
  });
});

describe("<VaultAvatar />", () => {
  it("renders the first emoji of the fingerprint", () => {
    const root = document.createElement("div");
    render(<VaultAvatar fingerprint="🐉 🐱 🦊" />, root);
    expect(root.textContent).toContain("🐉");
  });
});
