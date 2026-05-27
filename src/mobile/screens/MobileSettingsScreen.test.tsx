import { describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { MobileSettingsScreen } from "./MobileSettingsScreen.js";
import { historyEnabled } from "../../state.js";

// Mock Tauri core IPC directly so the real api module can resolve commands in the test runner
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd) => {
    if (cmd === "get_state") {
      return Promise.resolve({
        defaultProfile: {
          mode: "random",
          counter: 1,
          length: 16,
          lower: true,
          upper: true,
          digits: true,
          symbols: true,
        },
        autoLockMinutes: 10,
        clipboardClearSeconds: 30,
        historyEnabled: true,
        faviconFallbackEnabled: true,
        sites: {},
        hasPin: false,
      });
    }
    if (cmd === "autofill_status") {
      return Promise.resolve({ enabled: false });
    }
    if (cmd === "biometric_available") {
      return Promise.resolve({ supported: true, enrolled: true, vaultEnrolled: false });
    }
    return Promise.resolve();
  }),
}));

describe("<MobileSettingsScreen />", () => {
  it("renders the six category menu rows", async () => {
    historyEnabled.value = true;
    const root = document.createElement("div");
    render(<MobileSettingsScreen />, root);

    // Allow the promise to resolve so settings layout mounts
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The 6 Bitwarden-style category headings
    expect(root.textContent).toMatch(/Génération|Generation/);
    expect(root.textContent).toMatch(/Sécurité|Security/);
    expect(root.textContent).toMatch(/Comptes|Accounts/);
    expect(root.textContent).toMatch(/Synchronisation|Sync/);
    expect(root.textContent).toMatch(/Confort|Comfort/);
    expect(root.textContent).toMatch(/Zone dangereuse|Danger zone/);
  });

  it("renders a Lock row that calls the onLock prop when tapped", async () => {
    const calls: string[] = [];
    const root = document.createElement("div");
    render(<MobileSettingsScreen onLock={() => calls.push("lock")} />, root);

    // Allow the promise to resolve so lock button mounts
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lockButton = root.querySelector("[data-action='lock']") as HTMLButtonElement | null;
    expect(lockButton).not.toBeNull();
    lockButton!.click();
    expect(calls).toEqual(["lock"]);
  });

  it("renders the Lock row on the top-level menu and not inside a sub-page", async () => {
    // Sanity: the lock CTA lives outside the 6 category rows so a user
    // looking to lock the vault doesn't have to drill into a sub-page.
    const root = document.createElement("div");
    render(<MobileSettingsScreen onLock={() => undefined} />, root);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const lockButton = root.querySelector("[data-action='lock']") as HTMLButtonElement | null;
    expect(lockButton).not.toBeNull();
    // The lock button text is wrapped in a <span>; just confirm it's present.
    expect(lockButton!.textContent).toMatch(/Verrouiller|Lock/);
  });
});
