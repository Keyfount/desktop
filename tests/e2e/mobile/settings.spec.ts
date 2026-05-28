import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("mobile settings sub-pages", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("Generation: switching the default profile to memorable sticks", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Generation" }).click();

    await app.getByRole("button", { name: "Memorable" }).click();
    await expect(app.getByRole("button", { name: "Memorable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Security: the auto-lock timeout persists", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Security" }).click();

    const minutes = app.locator('input[type="number"]').first();
    await minutes.fill("5");
    await minutes.blur();
    await expect.poll(async () => (await mockSnapshot(app)).autoLockMinutes).toBe(5);
  });

  test("Accounts: enabling history reveals the Accounts tab", async ({ app }) => {
    // History off → no Accounts tab in the bottom nav.
    await expect(app.getByRole("button", { name: "Accounts" })).toHaveCount(0);

    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Accounts" }).click(); // settings menu row
    await app.getByRole("checkbox").first().check();

    await expect.poll(async () => (await mockSnapshot(app)).historyEnabled).toBe(true);
    // The bottom-nav Accounts tab now appears.
    await expect(app.getByRole("button", { name: "Accounts" }).first()).toBeVisible();
  });
});
