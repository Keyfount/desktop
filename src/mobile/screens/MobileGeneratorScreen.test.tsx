import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileGeneratorScreen } from "./MobileGeneratorScreen.js";

describe("<MobileGeneratorScreen />", () => {
  it("renders the domain and identifier fields and a Copy button", () => {
    const root = document.createElement("div");
    render(<MobileGeneratorScreen />, root);
    expect(root.textContent).toMatch(/Site|Domain/);
    expect(root.textContent).toMatch(/Copier|Copy/);
  });
});
