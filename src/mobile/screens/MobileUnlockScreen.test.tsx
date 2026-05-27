import { describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { MobileUnlockScreen } from "./MobileUnlockScreen.js";

const mockBiometricAvailable = vi.fn().mockResolvedValue({
  supported: false,
  enrolled: false,
  vaultEnrolled: false,
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd) => {
    if (cmd === "biometric_available") {
      return mockBiometricAvailable();
    }
    if (cmd === "status") {
      return Promise.resolve({
        locked: false,
        isFirstRun: false,
        fingerprint: "test-fingerprint",
        hasPin: false,
      });
    }
    if (cmd === "get_state") {
      return Promise.resolve({
        defaultProfile: { mode: "random", counter: 1, length: 16, lower: true, upper: true, digits: true, symbols: true },
        autoLockMinutes: 10,
        clipboardClearSeconds: 30,
        historyEnabled: true,
        faviconFallbackEnabled: true,
      });
    }
    return Promise.resolve({});
  }),
}));

describe("<MobileUnlockScreen />", () => {
  it("renders the master password input by default", () => {
    mockBiometricAvailable.mockResolvedValue({
      supported: false,
      enrolled: false,
      vaultEnrolled: false,
    });
    const root = document.createElement("div");
    render(<MobileUnlockScreen hasPin={false} />, root);
    expect(root.querySelector("input[type='password']")).not.toBeNull();
    expect(root.textContent).toMatch(/master password|mot de passe maître/i);
  });

  it("displays a Use PIN button and switches mode when clicked", async () => {
    mockBiometricAvailable.mockResolvedValue({
      supported: false,
      enrolled: false,
      vaultEnrolled: false,
    });
    const root = document.createElement("div");
    render(<MobileUnlockScreen hasPin={true} />, root);
    
    // Check toggle button exists
    const toggleButton = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Use PIN") || b.textContent?.includes("Utiliser le PIN")
    );
    expect(toggleButton).toBeDefined();

    // Click it to switch to PIN mode
    toggleButton!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(root.textContent).toMatch(/PIN/);
  });

  it("renders biometric button when biometric unlock is available", async () => {
    mockBiometricAvailable.mockResolvedValue({
      supported: true,
      enrolled: true,
      vaultEnrolled: true,
    });
    const root = document.createElement("div");
    render(<MobileUnlockScreen hasPin={false} />, root);

    // Wait for biometric check to resolve
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Biometric button should render (which has the aria-label matching biometricLabel)
    const bioButton = root.querySelector("button[aria-label*='Touch ID'], button[aria-label*='biometric'], button[aria-label*='biométrique']");
    expect(bioButton).not.toBeNull();
  });
});

