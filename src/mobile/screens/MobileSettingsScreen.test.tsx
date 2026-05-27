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
  it("renders all five section headers", async () => {
    historyEnabled.value = true;
    const root = document.createElement("div");
    render(<MobileSettingsScreen />, root);

    // Allow the promise to resolve so settings layout mounts
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(root.textContent).toMatch(/Sécurité|Security/);
    expect(root.textContent).toMatch(/Synchronisation|Sync/);
    expect(root.textContent).toMatch(/Données|Data/);
    expect(root.textContent).toMatch(/À propos|About/);
    expect(root.textContent).toMatch(/Profil par défaut|Default profile/);
    // Chantier 2 additions
    expect(root.textContent).toMatch(/PIN rapide|Quick PIN/);
    expect(root.textContent).toMatch(/Exporter ce coffre|Export this vault/);
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
});
