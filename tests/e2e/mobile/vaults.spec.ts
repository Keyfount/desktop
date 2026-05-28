import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("mobile vault sheet (via the avatar)", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER, extraVaults: 2 } });

  test("the avatar opens the vault sheet with switch / new / lock actions", async ({ app }) => {
    await expect(app.getByRole("button", { name: "Generator" })).toBeVisible();
    await app.locator(".vault-avatar").click();

    // Sheet is open with its actions.
    await expect(app.getByRole("button", { name: "New vault" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Lock now" })).toBeVisible();
  });

  test("Lock now from the sheet locks and routes to unlock", async ({ app }) => {
    await app.locator(".vault-avatar").click();
    await app.getByRole("button", { name: "Lock now" }).click();

    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(false);
  });

  test("switching to another vault locks and routes to unlock", async ({ app }) => {
    // Wait for the shell so the vault list (loaded async on entry) is ready.
    await expect(app.getByRole("button", { name: "Generator" })).toBeVisible();
    await app.locator(".vault-avatar").click();

    // Vault rows are labelled "Vault <id>"; tap one that isn't the active one.
    const rows = app.getByRole("button", { name: /Vault / });
    await expect(rows.first()).toBeVisible();
    await rows.filter({ hasNotText: "Active" }).first().click();

    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(false);
  });

  test("New vault from the sheet opens setup, and cancel returns to the shell", async ({ app }) => {
    await app.locator(".vault-avatar").click();
    await app.getByRole("button", { name: "New vault" }).click();

    // Additional-vault setup screen with a cancel affordance.
    await expect(app.getByRole("heading", { name: /vault/i })).toBeVisible();
    const cancel = app.getByRole("button", { name: /cancel/i });
    await expect(cancel).toBeVisible();
    await cancel.click();

    // Back to the shell.
    await expect(app.getByRole("button", { name: "Generator" })).toBeVisible();
  });
});
