import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("mobile first-run setup", () => {
  test("validates input then creates the vault and lands on the generator tab", async ({ app }) => {
    await expect(app.getByRole("heading", { name: "Set up your master password" })).toBeVisible();
    const pw = app.locator('input[type="password"]');
    const create = app.getByRole("button", { name: "Create vault" });

    // Too short → inline validation error (mobile has no native minLength).
    await pw.nth(0).fill("short");
    await pw.nth(1).fill("short");
    await create.click();
    await expect(app.getByText(/at least 12 characters/)).toBeVisible();
    expect((await mockSnapshot(app)).activeId).toBeNull();

    // Mismatch → mismatch error.
    await pw.nth(0).fill(MASTER);
    await pw.nth(1).fill(MASTER + "-typo");
    await create.click();
    await expect(app.getByText(/do not match/)).toBeVisible();

    // Matching → shell with the bottom-nav generator tab.
    await pw.nth(1).fill(MASTER);
    await create.click();
    await expect(app.getByRole("button", { name: "Generator" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(true);
  });
});

test.describe("mobile unlock", () => {
  test.use({ seed: { scenario: "locked", master: MASTER } });

  test("wrong master stays locked; correct master enters the shell", async ({ app }) => {
    await expect(app.getByRole("heading", { name: "Unlock" })).toBeVisible();
    const input = app.locator('input[type="password"]');

    await input.fill("nope-nope-nope-nope");
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Generator" })).toHaveCount(0);
    expect((await mockSnapshot(app)).unlocked).toBe(false);

    await input.fill(MASTER);
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Generator" })).toBeVisible();
    expect((await mockSnapshot(app)).unlocked).toBe(true);
  });
});

test.describe("mobile PIN unlock", () => {
  test.use({ seed: { scenario: "locked", master: MASTER, pin: "24680" } });

  test("defaults to the PIN tab and unlocks with the PIN", async ({ app }) => {
    await expect(app.getByRole("button", { name: "Use master password" })).toBeVisible();
    await app.locator('input[type="password"]').fill("24680");
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Generator" })).toBeVisible();
  });
});

test.describe("mobile shell navigation", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER, historyEnabled: true } });

  test("bottom-nav switches tabs and the generator produces a password", async ({ app }) => {
    // Bottom nav is present; moving to Settings marks that tab active.
    const settingsTab = app.getByRole("button", { name: "Settings" });
    await settingsTab.click();
    await expect(settingsTab).toHaveAttribute("aria-current", "page");

    // Back to the generator tab.
    const generatorTab = app.getByRole("button", { name: "Generator" });
    await generatorTab.click();
    await expect(generatorTab).toHaveAttribute("aria-current", "page");

    // Generate on the generator tab. ("example.com" is a substring of the
    // username placeholder, so match the domain field exactly.)
    await app.getByPlaceholder("example.com", { exact: true }).fill("example.com");
    await app.getByPlaceholder("alice@example.com").fill("alice@example.com");
    const generate = app.getByRole("button", { name: "Generate" });
    await expect(generate).toBeEnabled();
    await generate.click();

    const code = app.locator("code.font-mono");
    await expect(code).toBeVisible();
    await app.getByRole("button", { name: "Reveal" }).click();
    expect((await code.innerText()).trim().length).toBeGreaterThan(0);
  });
});

test.describe("mobile in-app lock after enabling a PIN", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("locking from settings keeps the PIN option on the unlock screen", async ({ app }) => {
    // Enable a PIN this session via Settings → Security.
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Security" }).click();
    await app.getByRole("button", { name: "Set a PIN" }).click();
    await app.locator('input[type="password"].input-mono').fill("24680");
    await app.getByRole("button", { name: "Save PIN" }).click();
    await expect(app.getByText("PIN is set on this vault")).toBeVisible({ timeout: 10_000 });

    // Back to the settings menu and lock.
    await app.getByRole("button", { name: "Back" }).click();
    await app.locator('[data-action="lock"]').click();

    // The unlock screen must be in PIN mode (the master toggle only appears
    // when hasPin is true), even though the PIN was enabled after bootstrap.
    await expect(app.getByRole("button", { name: "Use master password" })).toBeVisible({
      timeout: 15_000,
    });
    await app.locator('input[type="password"]').fill("24680");
    await app.getByRole("button", { name: "Unlock" }).click();
    await expect(app.getByRole("button", { name: "Generator" })).toBeVisible({ timeout: 30_000 });
  });
});
