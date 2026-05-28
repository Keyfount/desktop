import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("vaults", () => {
  // Active vault + 2 others so switch / delete have real targets.
  test.use({ seed: { scenario: "unlocked", master: MASTER, extraVaults: 2 } });

  test("switching to another vault routes to the unlock screen", async ({ app }) => {
    await app.getByRole("button", { name: "Vaults" }).click();
    await expect(app.getByRole("heading", { name: "Vaults" })).toBeVisible();

    await app.getByRole("button", { name: "Switch", exact: true }).first().click();

    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(false);
  });

  test("starting a new vault then cancelling returns to an existing vault", async ({ app }) => {
    await app.getByRole("button", { name: "Vaults" }).click();
    await app.getByRole("button", { name: "New vault" }).click();

    // New vault → setup screen for a brand-new master.
    await expect(app.getByText("Set up your master password")).toBeVisible();
    expect((await mockSnapshot(app)).activeId).toBeNull();

    // Go back: cancel to an existing vault → unlock screen.
    await app.getByRole("button", { name: "Cancel — use an existing vault" }).click();
    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect((await mockSnapshot(app)).activeId).not.toBeNull();
  });

  test("deleting a non-active vault removes it from the list after confirmation", async ({
    app,
  }) => {
    await app.getByRole("button", { name: "Vaults" }).click();
    const rows = app.locator("ul > li");
    await expect(rows).toHaveCount(3);

    // Row delete buttons carry an aria-label distinct from the modal's
    // confirm button ("Delete").
    await app.getByRole("button", { name: "Delete this vault" }).first().click();
    const dialog = app.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(rows).toHaveCount(2);
    expect((await mockSnapshot(app)).vaultCount).toBe(2);
  });
});
