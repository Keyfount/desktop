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

  test("an out-of-range auto-lock value is clamped to the maximum", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Security" }).click();

    const minutes = app.locator('input[type="number"]').first();
    await minutes.fill("999");
    await minutes.blur();
    await expect.poll(async () => (await mockSnapshot(app)).autoLockMinutes).toBe(240);
  });

  test("the clipboard auto-clear delay persists", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Security" }).click();

    // Two number inputs on the Security page: auto-lock, then clipboard.
    const clipboard = app.locator('input[type="number"]').nth(1);
    await clipboard.fill("12");
    await clipboard.blur();
    await expect.poll(async () => (await mockSnapshot(app)).clipboardClearSeconds).toBe(12);
  });

  test("toggling the favicon fallback flips its checkbox", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Comfort" }).click();

    // Comfort page: favicon toggle first, autofill second.
    const favicon = app.getByRole("checkbox").first();
    await expect(favicon).toBeChecked();
    await favicon.click();
    await expect(favicon).not.toBeChecked();
    await expect.poll(async () => (await mockSnapshot(app)).faviconFallbackEnabled).toBe(false);
  });
});

test.describe("settings — disabling history with saved accounts", () => {
  test.use({
    seed: {
      scenario: "unlocked",
      master: MASTER,
      historyEnabled: true,
      accounts: [{ domain: "example.com", username: "alice" }],
    },
  });

  test("requires confirmation, then wipes the saved accounts", async ({ app }) => {
    await app.getByRole("button", { name: "Settings" }).click();
    // Two "Accounts" controls exist while history is on (sidebar nav + the
    // settings menu row); the menu row is the last match.
    await app.getByRole("button", { name: "Accounts" }).last().click();

    await app.getByRole("checkbox").click(); // turn history off

    // A confirmation modal warns before wiping.
    const dialog = app.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Disable account history?");
    await dialog.getByRole("button", { name: "Disable" }).click();

    await expect.poll(async () => (await mockSnapshot(app)).historyEnabled).toBe(false);
    expect((await mockSnapshot(app)).accounts).toHaveLength(0);
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
