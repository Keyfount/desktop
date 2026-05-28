import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("generator", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER, historyEnabled: true } });

  test("generate is gated until both fields are filled, then reveals a deterministic password", async ({
    app,
  }) => {
    await expect(app.getByRole("button", { name: "Lock vault" })).toBeVisible();

    const domain = app.locator("input.input-mono");
    const generate = app.getByRole("button", { name: "Generate" });

    // Disabled until domain + username are present.
    await expect(generate).toBeDisabled();
    await domain.fill("example.com");
    await expect(generate).toBeDisabled();

    const username = app.getByPlaceholder("alice@example.com");
    await username.fill("alice@example.com");
    await expect(generate).toBeEnabled();

    await generate.click();
    const code = app.locator("code.font-mono");
    await expect(code).toBeVisible();

    // Reveal shows the real password; capture it.
    await app.getByRole("button", { name: "Reveal" }).click();
    const first = (await code.innerText()).trim();
    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toMatch(/^•+$/);

    // Regenerating the same inputs is deterministic. The reveal state
    // persists across a regenerate, so the code stays in plaintext.
    await app.getByRole("button", { name: "Generate" }).click();
    await expect(app.getByRole("button", { name: "Hide" })).toBeVisible();
    expect((await code.innerText()).trim()).toBe(first);
  });

  test("copy and save-to-history work and persist the account", async ({ app }) => {
    await app.locator("input.input-mono").fill("github.com");
    await app.getByPlaceholder("alice@example.com").fill("octocat");
    await app.getByRole("button", { name: "Generate" }).click();
    await expect(app.locator("code.font-mono")).toBeVisible();

    await app.getByRole("button", { name: "Copy" }).click();
    await expect(app.getByRole("button", { name: "Copied" })).toBeVisible();

    await app.getByRole("button", { name: "Save", exact: true }).click();
    await expect(app.getByRole("button", { name: "Saved" })).toBeVisible();

    const snap = await mockSnapshot(app);
    expect(snap.accounts.some((a) => a.domain === "github.com" && a.username === "octocat")).toBe(
      true,
    );
  });
});
