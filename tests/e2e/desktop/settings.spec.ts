import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("settings", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("changing the auto-lock timeout persists, and Back returns to the menu", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Security" }).click();

    const minutes = app.locator('input[type="number"]').first();
    await expect(minutes).toHaveValue("15");
    await minutes.fill("1");
    await minutes.blur();

    await expect.poll(async () => (await mockSnapshot(app)).autoLockMinutes).toBe(1);

    // Back goes to the settings menu (not out of settings).
    await app.getByRole("button", { name: "Back" }).click();
    await expect(app.getByRole("button", { name: "Security" })).toBeVisible();
  });

  test("setting then removing a PIN round-trips", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Security" }).click();

    await app.getByRole("button", { name: "Set a PIN" }).click();
    await app.locator("input.input-mono").fill("13579");
    await app.getByRole("button", { name: "Save PIN" }).click();

    await expect(app.getByText("PIN is set on this vault")).toBeVisible();
    expect((await mockSnapshot(app)).hasPin).toBe(true);

    await app.getByRole("button", { name: "Remove PIN" }).click();
    await expect(app.getByRole("button", { name: "Set a PIN" })).toBeVisible();
    expect((await mockSnapshot(app)).hasPin).toBe(false);
  });
});

test.describe("settings — enabling history", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER, historyEnabled: false } });

  test("turning on account history reveals the Accounts sidebar entry", async ({ app }) => {
    // History off → no Accounts entry in the sidebar.
    await expect(app.getByRole("button", { name: "Accounts" })).toHaveCount(0);

    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Accounts" }).click(); // settings menu row

    await app.getByRole("checkbox").check();

    // The sidebar now exposes Accounts (history-gated nav).
    await expect(app.getByRole("button", { name: "Accounts" }).first()).toBeVisible();
  });
});
