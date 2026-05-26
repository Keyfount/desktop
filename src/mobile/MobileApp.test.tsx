import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileApp } from "./MobileApp.js";

describe("<MobileApp />", () => {
  it("mounts and shows either a loader, setup, unlock, or shell", () => {
    const root = document.createElement("div");
    render(<MobileApp />, root);
    expect(root.children.length).toBeGreaterThan(0);
  });
});
