import { describe, expect, it } from "vitest";
import { render } from "preact";
import { TopBar } from "./TopBar.js";

describe("<TopBar />", () => {
  it("renders the brand name and fingerprint chip", () => {
    const root = document.createElement("div");
    render(<TopBar fingerprint="🐉 🐱 🦊" />, root);
    expect(root.textContent).toContain("Keyfount");
    expect(root.textContent).toContain("🐉");
  });

  it("hides the avatar when fingerprint is null", () => {
    const root = document.createElement("div");
    render(<TopBar fingerprint={null} />, root);
    expect(root.querySelector("button[aria-label]")).toBeNull();
  });
});
