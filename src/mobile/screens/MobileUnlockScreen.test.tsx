import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileUnlockScreen } from "./MobileUnlockScreen.js";

describe("<MobileUnlockScreen />", () => {
  it("renders the master password input by default", () => {
    const root = document.createElement("div");
    render(<MobileUnlockScreen hasPin={false} />, root);
    expect(root.querySelector("input[type='password']")).not.toBeNull();
  });
});
