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

  test("deleting the active vault reassigns the active one and shrinks the list", async ({
    app,
  }) => {
    await app.getByRole("button", { name: "Vaults" }).click();
    const rows = app.locator("ul > li");
    await expect(rows).toHaveCount(3);
    const activeBefore = (await mockSnapshot(app)).activeId;

    // The active row is the one showing the "Active" chip; its delete
    // button is the same "Delete this vault" aria-label.
    const activeRow = rows.filter({ hasText: "Active" });
    await activeRow.getByRole("button", { name: "Delete this vault" }).click();
    await app.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();

    await expect(rows).toHaveCount(2);
    const snap = await mockSnapshot(app);
    expect(snap.vaultCount).toBe(2);
    expect(snap.activeId).not.toBe(activeBefore);
  });
});

test.describe("wipe vault", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("wiping the only vault routes to first-run setup", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Danger zone" }).click();

    await app.getByRole("button", { name: "Wipe vault" }).click();
    const dialog = app.getByRole("dialog");
    await expect(dialog).toContainText("Wipe this vault for good?");
    await dialog.getByRole("button", { name: "Wipe vault" }).click();

    await expect(app.getByText("Set up your master password")).toBeVisible();
    const snap = await mockSnapshot(app);
    expect(snap.vaultCount).toBe(0);
    expect(snap.activeId).toBeNull();
  });
});
