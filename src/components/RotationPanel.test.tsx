import { describe, expect, it, vi } from "vitest";
import { render } from "preact";

import { RotationPanel } from "./RotationPanel.js";
import type { AccountEntry } from "../types.js";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

const fixtureEntry = (): AccountEntry => ({
  domain: "example.com",
  username: "alice@example.com",
  profile: {
    mode: "random",
    length: 16,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    counter: 1,
  },
  createdAt: 0,
  lastUsedAt: 0,
});

describe("<RotationPanel />", () => {
  it("renders the Start rotation CTA initially", () => {
    invoke.mockReset();
    const root = document.createElement("div");
    render(<RotationPanel entry={fixtureEntry()} onUpdated={() => {}} />, root);
    expect(root.textContent).toMatch(/Start rotation|Démarrer la rotation/);
  });

  it("runs generate twice on Start (counter and counter+1)", async () => {
    invoke.mockReset();
    invoke
      .mockResolvedValueOnce({ password: "old-pass" })
      .mockResolvedValueOnce({ password: "new-pass" });

    const root = document.createElement("div");
    render(<RotationPanel entry={fixtureEntry()} onUpdated={() => {}} />, root);

    const start = Array.from(root.querySelectorAll("button")).find((b) =>
      /Start rotation|Démarrer la rotation/.test(b.textContent ?? ""),
    );
    expect(start).toBeDefined();
    start!.click();

    await new Promise((r) => setTimeout(r, 20));

    expect(invoke).toHaveBeenCalledTimes(2);
    const calls = invoke.mock.calls.map(([cmd, args]) => ({ cmd, args }));
    expect(calls[0]?.cmd).toBe("generate");
    expect(calls[1]?.cmd).toBe("generate");
    const counters = calls.map((c) => {
      const profile = (c.args as { profile?: { counter?: number } } | undefined)?.profile;
      return profile?.counter ?? null;
    });
    expect(counters).toContain(1);
    expect(counters).toContain(2);
  });
});
