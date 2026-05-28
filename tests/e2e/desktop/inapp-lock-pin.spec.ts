import { test, expect } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("in-app lock after enabling a PIN", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("locking from the shell keeps the PIN tab on the unlock screen", async ({ app }) => {
    // Enable a PIN this session (the global hasPin signal starts false).
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Security" }).click();
    await app.getByRole("button", { name: "Set a PIN" }).click();
    await app.locator("input.input-mono").fill("24680");
    await app.getByRole("button", { name: "Save PIN" }).click();
    await expect(app.getByText("PIN is set on this vault")).toBeVisible();

    // Back to the shell and lock from the sidebar.
    await app.getByRole("button", { name: "Back" }).click();
    await app.getByRole("button", { name: "Back" }).click();
    await app.getByRole("button", { name: "Lock vault" }).click();

    // The unlock screen must be in PIN mode (the "Use master password" toggle
    // only appears when hasPin is true) even though the PIN was enabled after
    // bootstrap.
    await expect(app.getByRole("button", { name: "Use master password" })).toBeVisible({
      timeout: 15_000,
    });

    // And the PIN unlocks from this same flow.
    await app.locator('input[type="password"]').fill("24680");
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible({ timeout: 30_000 });
  });
});
