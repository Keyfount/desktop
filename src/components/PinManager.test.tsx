import { describe, expect, it, vi } from "vitest";
import { render } from "preact";

import { PinManager } from "./PinManager.js";

const invoke = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

describe("<PinManager />", () => {
  it("renders the 'Set a PIN' CTA when no PIN is configured", () => {
    const root = document.createElement("div");
    render(<PinManager hasPin={false} onChange={() => {}} />, root);
    expect(root.textContent).toMatch(/Set a PIN|Définir un PIN/);
  });

  it("renders the 'Remove PIN' affordance when a PIN is configured", () => {
    const root = document.createElement("div");
    render(<PinManager hasPin={true} onChange={() => {}} />, root);
    expect(root.textContent).toMatch(/Remove PIN|Retirer le PIN/);
    expect(root.textContent).toMatch(/PIN is set|Un PIN est configuré/);
  });

  it("calls api.removePin when the user confirms removal", async () => {
    invoke.mockClear();
    const changes: number[] = [];
    const root = document.createElement("div");
    render(<PinManager hasPin={true} onChange={() => changes.push(1)} />, root);

    const remove = Array.from(root.querySelectorAll("button")).find((b) =>
      /Remove PIN|Retirer le PIN/.test(b.textContent ?? ""),
    );
    expect(remove).toBeDefined();
    remove!.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(invoke).toHaveBeenCalledWith("remove_pin", undefined);
    expect(changes).toEqual([1]);
  });
});
