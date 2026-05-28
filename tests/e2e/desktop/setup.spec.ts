import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("first-run setup", () => {
  test("blocks a too-short master and a mismatched confirmation, then creates the vault", async ({
    app,
  }) => {
    await expect(app.getByText("Set up your master password")).toBeVisible();
    const pwInputs = app.locator('input[type="password"]');
    const submit = app.getByRole("button", { name: "Create vault" });

    // Too short → the native minLength=12 constraint blocks submission, so
    // we stay on setup and no vault is created.
    await pwInputs.nth(0).fill("short");
    await pwInputs.nth(1).fill("short");
    await submit.click();
    await expect(submit).toBeVisible();
    expect((await mockSnapshot(app)).activeId).toBeNull();

    // Long enough but mismatched confirmation → app-level validation error.
    await pwInputs.nth(0).fill(MASTER);
    await pwInputs.nth(1).fill(MASTER + "-typo");
    await submit.click();
    await expect(app.locator(".field-error")).toContainText("do not match");
    expect((await mockSnapshot(app)).activeId).toBeNull();

    // Matching → vault created, history opt-in step shown.
    await pwInputs.nth(1).fill(MASTER);
    await submit.click();
    await expect(app.getByText("Remember accounts?")).toBeVisible();

    const snap = await mockSnapshot(app);
    expect(snap.activeId).not.toBeNull();
    expect(snap.unlocked).toBe(true);
  });

  test("shows a live fingerprint preview once the master is long enough", async ({ app }) => {
    await expect(app.getByText("Set up your master password")).toBeVisible();
    const master = app.locator('input[type="password"]').first();

    await master.fill("tooshort");
    await expect(app.locator(".fingerprint")).toHaveCount(0);

    await master.fill(MASTER);
    await expect(app.locator(".fingerprint")).toBeVisible();
    const fp = (await app.locator(".fingerprint").innerText()).trim();
    expect(fp.length).toBeGreaterThan(0);
  });

  test("enabling history lands in the shell with Accounts available", async ({ app }) => {
    const pwInputs = app.locator('input[type="password"]');
    await pwInputs.nth(0).fill(MASTER);
    await pwInputs.nth(1).fill(MASTER);
    await app.getByRole("button", { name: "Create vault" }).click();

    await app.getByRole("button", { name: "Enable" }).click();

    // In the shell: the Lock button is sidebar-only, and enabling history
    // reveals the Accounts nav entry.
    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Accounts" })).toBeVisible();
  });

  test("skipping history lands in the shell with Accounts hidden", async ({ app }) => {
    const pwInputs = app.locator('input[type="password"]');
    await pwInputs.nth(0).fill(MASTER);
    await pwInputs.nth(1).fill(MASTER);
    await app.getByRole("button", { name: "Create vault" }).click();

    await app.getByRole("button", { name: "Skip" }).click();

    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Accounts" })).toHaveCount(0);
  });
});

test.describe("setup with an existing vault (go back)", () => {
  test.use({ seed: { scenario: "first-run", extraVaults: 1 } });

  test("offers cancel-to-existing, which routes to the unlock screen", async ({ app }) => {
    await expect(app.getByText("Set up your master password")).toBeVisible();
    const cancel = app.getByRole("button", { name: "Cancel — use an existing vault" });
    await expect(cancel).toBeVisible();

    await cancel.click();

    // Switched to the existing (locked) vault → unlock screen, setup gone.
    await expect(app.getByRole("button", { name: "Create vault" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
  });
});
