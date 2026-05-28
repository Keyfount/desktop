import { test, expect, emitEvent } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("auto-lock event", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("a vault:locked event from the backend routes the shell to the unlock screen", async ({
    app,
  }) => {
    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();

    // Simulate the Rust auto-lock task firing (issue desktop#26).
    await emitEvent(app, "vault:locked");

    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Lock vault" })).toHaveCount(0);
  });
});
