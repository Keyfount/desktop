import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileSetupScreen } from "./MobileSetupScreen.js";

describe("<MobileSetupScreen />", () => {
  it("renders the master + confirm fields and a Create button", () => {
    const root = document.createElement("div");
    render(<MobileSetupScreen mode="first-run" onCancel={() => {}} />, root);
    expect(root.textContent).toMatch(/Master|Mot de passe maître/);
    expect(root.textContent).toMatch(/Create vault|Créer le coffre/);
  });

  it("shows a Cancel affordance in additional-vault mode", () => {
    const root = document.createElement("div");
    render(<MobileSetupScreen mode="additional" onCancel={() => {}} />, root);
    expect(root.textContent).toMatch(/Annuler|Cancel/);
  });
});
