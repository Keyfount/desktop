import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileGeneratorScreen } from "./MobileGeneratorScreen.js";
import { generated } from "../../state.js";

describe("<MobileGeneratorScreen />", () => {
  it("renders the domain and identifier fields and a Copy button", () => {
    generated.value = "test-password";
    const root = document.createElement("div");
    render(<MobileGeneratorScreen />, root);
    expect(root.textContent).toMatch(/Site|Domain/);
    expect(root.textContent).toMatch(/Copier|Copy/);
    generated.value = null;
  });
});
