import { describe, expect, it } from "vitest";
import { render } from "preact";
import { VaultSheet } from "./VaultSheet.js";
import { vaultSheetOpen } from "./state.js";

describe("<VaultSheet />", () => {
  it("renders nothing when closed", () => {
    vaultSheetOpen.value = false;
    const root = document.createElement("div");
    render(<VaultSheet platform="ios" vaults={[]} onSwitch={() => {}} onLock={() => {}} onNew={() => {}} />, root);
    expect(root.textContent?.trim()).toBe("");
  });

  it("renders the vault list and the new/lock rows when open", () => {
    vaultSheetOpen.value = true;
    const root = document.createElement("div");
    render(
      <VaultSheet
        platform="ios"
        vaults={[{ id: "v1", name: "Personnel", fingerprint: "🐉 🐱", active: true }]}
        onSwitch={() => {}}
        onLock={() => {}}
        onNew={() => {}}
      />,
      root,
    );
    expect(root.textContent).toContain("Personnel");
    expect(root.textContent).toMatch(/Nouveau coffre|New vault/);
    expect(root.textContent).toMatch(/Verrouiller maintenant|Lock now/);
    vaultSheetOpen.value = false;
  });
});
