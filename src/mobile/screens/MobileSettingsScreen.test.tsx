import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileSettingsScreen } from "./MobileSettingsScreen.js";

describe("<MobileSettingsScreen />", () => {
  it("renders all five section headers", () => {
    const root = document.createElement("div");
    render(<MobileSettingsScreen />, root);
    expect(root.textContent).toMatch(/Sécurité|Security/);
    expect(root.textContent).toMatch(/Compte|Account/);
    expect(root.textContent).toMatch(/Synchronisation|Sync/);
    expect(root.textContent).toMatch(/Données|Data/);
    expect(root.textContent).toMatch(/À propos|About/);
  });

  it("renders a Lock row that calls the onLock prop when tapped", () => {
    const calls: string[] = [];
    const root = document.createElement("div");
    render(<MobileSettingsScreen onLock={() => calls.push("lock")} />, root);
    const lockButton = root.querySelector("[data-action='lock']") as HTMLButtonElement | null;
    expect(lockButton).not.toBeNull();
    lockButton!.click();
    expect(calls).toEqual(["lock"]);
  });
});
