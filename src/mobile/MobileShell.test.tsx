import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileShell } from "./MobileShell.js";

describe("<MobileShell />", () => {
  it("renders the top bar, the children, and the bottom nav", () => {
    const root = document.createElement("div");
    render(
      <MobileShell active="generator" platform="ios" fingerprint="🐉 🐱" onChange={() => {}}>
        <p>screen content</p>
      </MobileShell>,
      root,
    );
    expect(root.textContent).toContain("Keyfount");
    expect(root.textContent).toContain("screen content");
    expect(root.textContent).toMatch(/Générateur|Generator/);
  });
});
