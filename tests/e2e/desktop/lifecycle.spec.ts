import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";
const PIN = "24680";

/**
 * One long session that stitches together the moves a real user makes:
 * set up, generate + save, browse accounts, enable a PIN, lock, unlock with
 * the PIN, generate + save again, change the default profile, and finally
 * lock and unlock with the master. Exercises the cross-screen state flow
 * end to end rather than one feature at a time.
 */
test("full session: setup → generate/save → PIN → lock/unlock → settings → master unlock", async ({
  app,
}) => {
  // 1. First-run setup, opt into history.
  const pw = app.locator('input[type="password"]');
  await pw.nth(0).fill(MASTER);
  await pw.nth(1).fill(MASTER);
  await app.getByRole("button", { name: "Create vault" }).click();
  await app.getByRole("button", { name: "Enable" }).click();
  await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();

  // 2. Generate + save an account for github.com.
  await app.locator("input.input-mono").fill("github.com");
  await app.getByPlaceholder("alice@example.com").fill("alice");
  await app.getByRole("button", { name: "Generate" }).click();
  await expect(app.locator("code.font-mono")).toBeVisible();
  await app.getByRole("button", { name: "Save", exact: true }).click();
  await expect(app.getByRole("button", { name: "Saved" })).toBeVisible();

  // 3. It shows up under Accounts.
  await app.getByRole("button", { name: "Accounts" }).click();
  await expect(app.getByRole("button", { name: /github\.com/ })).toBeVisible();
  await app.getByRole("button", { name: "Generator" }).click();

  // 4. Enable a PIN in Settings → Security.
  await app.getByRole("button", { name: "Settings" }).click();
  await app.getByRole("button", { name: "Security" }).click();
  await app.getByRole("button", { name: "Set a PIN" }).click();
  await app.locator("input.input-mono").fill(PIN);
  await app.getByRole("button", { name: "Save PIN" }).click();
  await expect(app.getByText("PIN is set on this vault")).toBeVisible();
  await app.getByRole("button", { name: "Back" }).click();
  await app.getByRole("button", { name: "Back" }).click();

  // 5. Lock, then 6. unlock with the PIN.
  await app.getByRole("button", { name: "Lock vault" }).click();
  await expect(app.getByRole("button", { name: "Use master password" })).toBeVisible();
  await app.locator('input[type="password"]').fill(PIN);
  await app.getByRole("button", { name: "Unlock" }).click();
  await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible({ timeout: 30_000 });

  // 7. Generate + save a second account.
  await app.locator("input.input-mono").fill("gitlab.com");
  await app.getByPlaceholder("alice@example.com").fill("bob");
  await app.getByRole("button", { name: "Generate" }).click();
  await expect(app.locator("code.font-mono")).toBeVisible();
  await app.getByRole("button", { name: "Save", exact: true }).click();
  await expect(app.getByRole("button", { name: "Saved" })).toBeVisible();

  // 8. Both accounts are now saved.
  await expect.poll(async () => (await mockSnapshot(app)).accounts.length).toBe(2);

  // 9. Switch the default profile to Memorable.
  await app.getByRole("button", { name: "Settings" }).click();
  await app.getByRole("button", { name: "Generation" }).click();
  await app.getByRole("button", { name: "Memorable" }).click();
  await expect(app.getByRole("button", { name: "Memorable" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await app.getByRole("button", { name: "Back" }).click();
  await app.getByRole("button", { name: "Back" }).click();

  // 10. Lock and unlock with the master (flip off the PIN tab).
  await app.getByRole("button", { name: "Lock vault" }).click();
  await app.getByRole("button", { name: "Use master password" }).click();
  await app.locator('input[type="password"]').fill(MASTER);
  await app.getByRole("button", { name: "Unlock" }).click();
  await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible({ timeout: 30_000 });

  const snap = await mockSnapshot(app);
  expect(snap.unlocked).toBe(true);
  expect(snap.hasPin).toBe(true);
  expect(snap.accounts.length).toBe(2);
});
