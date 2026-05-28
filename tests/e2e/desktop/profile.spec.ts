import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

/** Generate for the current domain/email and return the revealed password. */
async function generateAndReveal(app: Page): Promise<string> {
  await app.getByRole("button", { name: "Generate" }).click();
  const code = app.locator("code.font-mono");
  await expect(code).toBeVisible();
  const reveal = app.getByRole("button", { name: "Reveal" });
  if (await reveal.isVisible()) await reveal.click();
  return (await code.innerText()).trim();
}

test.describe("generation profile", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("toggling a character class changes the per-site generated password", async ({ app }) => {
    await app.locator("input.input-mono").fill("example.com");
    await app.getByPlaceholder("alice@example.com").fill("alice@example.com");
    const first = await generateAndReveal(app);

    // Open the customise panel and drop symbols.
    await app.getByRole("button", { name: "Customise generation" }).click();
    const symbols = app.getByRole("button", { name: "@#" });
    await expect(symbols).toBeVisible();
    await expect(symbols).toHaveAttribute("aria-pressed", "true");
    await symbols.click();
    await expect(symbols).toHaveAttribute("aria-pressed", "false");

    const second = await generateAndReveal(app);
    expect(second).not.toBe(first);
  });

  test("switching to memorable mode changes the generated password", async ({ app }) => {
    await app.locator("input.input-mono").fill("news.example");
    await app.getByPlaceholder("alice@example.com").fill("reader");
    const random = await generateAndReveal(app);

    await app.getByRole("button", { name: "Customise generation" }).click();
    await app.getByRole("button", { name: "Memorable" }).click();
    await expect(app.getByRole("button", { name: "Memorable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const memorable = await generateAndReveal(app);
    expect(memorable).not.toBe(random);
  });

  test("the length slider drives the random password length", async ({ app }) => {
    await app.locator("input.input-mono").fill("len.example");
    await app.getByPlaceholder("alice@example.com").fill("user");
    await app.getByRole("button", { name: "Customise generation" }).click();

    const slider = app.locator('input[type="range"]');
    await slider.fill("28");

    await app.getByRole("button", { name: "Generate" }).click();
    const code = app.locator("code.font-mono");
    await expect(code).toBeVisible();
    await app.getByRole("button", { name: "Reveal" }).click();
    expect((await code.innerText()).trim().length).toBe(28);
  });
});

test.describe("default profile (settings)", () => {
  test.use({ seed: { scenario: "unlocked", master: MASTER } });

  test("changing the default profile counter is reflected on generation", async ({ app }) => {
    // Generate with the default profile first (no per-site override).
    await app.locator("input.input-mono").fill("default.example");
    await app.getByPlaceholder("alice@example.com").fill("user");
    const before = await generateAndReveal(app);

    // Bump the default-profile counter in Settings → Generation.
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("button", { name: "Generation" }).click();
    const counter = app.locator('input[type="number"]').first();
    await expect(counter).toHaveValue("1");
    await counter.fill("3");
    await counter.blur();

    // Back to the generator and regenerate the same inputs.
    await app.getByRole("button", { name: "Back" }).click();
    await app.getByRole("button", { name: "Back" }).click();
    await app.locator("input.input-mono").fill("default.example");
    await app.getByPlaceholder("alice@example.com").fill("user");
    const after = await generateAndReveal(app);

    expect(after).not.toBe(before);
  });
});
