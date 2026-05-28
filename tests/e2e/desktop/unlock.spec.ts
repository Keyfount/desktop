import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("unlock from a locked vault", () => {
  test.use({ seed: { scenario: "locked", master: MASTER } });

  test("rejects the wrong master and accepts the right one", async ({ app }) => {
    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
    const input = app.locator('input[type="password"]');

    await input.fill("wrong-master-passphrase");
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.locator(".field-error")).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(false);

    await input.fill(MASTER);
    await app.getByRole("button", { name: "Unlock" }).click();

    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(true);
  });

  test("lock from the shell returns to the unlock screen, then re-unlock works", async ({
    app,
  }) => {
    await app.locator('input[type="password"]').fill(MASTER);
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();

    await app.getByRole("button", { name: "Lock vault" }).click();
    await expect(app.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(false);

    await app.locator('input[type="password"]').fill(MASTER);
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();
  });
});

test.describe("PIN unlock", () => {
  test.use({ seed: { scenario: "locked", master: MASTER, pin: "13579" } });

  test("defaults to the PIN tab and unlocks with the correct PIN", async ({ app }) => {
    // hasPin → the screen opens on the PIN tab, offering the master toggle.
    await expect(app.getByRole("button", { name: "Use master password" })).toBeVisible();

    await app.locator('input[type="password"]').fill("13579");
    await app.getByRole("button", { name: "Unlock" }).click();

    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(true);
  });

  test("rejects the wrong PIN, and the master tab still works", async ({ app }) => {
    await app.locator('input[type="password"]').fill("00000");
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.locator(".field-error")).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(false);

    // Flip to the master tab and unlock with the master instead.
    await app.getByRole("button", { name: "Use master password" }).click();
    await app.locator('input[type="password"]').fill(MASTER);
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();
  });
});
