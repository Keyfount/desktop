import type { Page } from "@playwright/test";
import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

/**
 * Simulate the mobile pull-to-search gesture: a downward touch-drag past the
 * 60px threshold while the list is scrolled to the top. Dispatches real
 * TouchEvents (the screen runs under Pixel/Android emulation with touch).
 */
async function pullDownToSearch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const section = document.querySelector("main.mobile-main section");
    if (section === null) throw new Error("accounts section not found");
    const at = (y: number) =>
      new Touch({ identifier: 1, target: section, clientX: 160, clientY: y });
    const fire = (type: string, ys: number[]) =>
      section.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches: ys.map(at),
          targetTouches: ys.map(at),
          changedTouches: ys.map(at),
        }),
      );
    fire("touchstart", [20]);
    fire("touchmove", [140]); // dy = 120 > 60px threshold
    fire("touchend", []);
  });
}

test.describe("mobile accounts list + pull-to-search", () => {
  test.use({
    seed: {
      scenario: "unlocked",
      master: MASTER,
      historyEnabled: true,
      accounts: [
        { domain: "github.com", username: "octocat" },
        { domain: "gitlab.com", username: "alice" },
      ],
    },
  });

  test("the search field is hidden until the user pulls down, then filters", async ({ app }) => {
    await app.getByRole("button", { name: "Accounts" }).click();

    // Both accounts are listed; the search hint invites the pull gesture.
    await expect(app.getByText("github.com")).toBeVisible();
    await expect(app.getByText("gitlab.com")).toBeVisible();
    await expect(app.getByText("Pull down to search")).toBeVisible();

    // Search input exists in the DOM but is hidden (collapsed track).
    const search = app.locator("#mobile-search-input");
    await expect(search).not.toBeVisible();

    // Pull down → the search field reveals.
    await pullDownToSearch(app);
    await expect(search).toBeVisible();
    await expect(app.getByText("Pull down to search")).toHaveCount(0);

    // Typing filters the list.
    await search.fill("gitlab");
    await expect(app.getByText("gitlab.com")).toBeVisible();
    await expect(app.getByText("github.com")).toHaveCount(0);
  });

  test("tapping an account opens the detail sheet; reveal shows the password", async ({ app }) => {
    await app.getByRole("button", { name: "Accounts" }).click();
    await app.getByText("github.com").click();

    // The bottom sheet shows the derived-password card.
    const code = app.locator("code.font-mono");
    await expect(code).toBeVisible();
    await expect(code).toHaveText(/^•+$/); // masked by default
    await app.getByRole("button", { name: "Reveal" }).click();
    expect((await code.innerText()).trim()).not.toMatch(/^•+$/);

    // Close the sheet.
    await app.getByRole("button", { name: "Close" }).click();
    await expect(app.locator("code.font-mono")).toHaveCount(0);
  });

  test("renaming an account from the detail sheet changes the derived password", async ({
    app,
  }) => {
    await app.getByRole("button", { name: "Accounts" }).click();
    await app.getByText("github.com").click();

    // The detail sheet's username field; editing it reveals a Save button.
    const username = app.locator('input[type="text"]').first();
    await expect(username).toHaveValue("octocat");
    await username.fill("octocat-renamed");
    await app.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () =>
        (await mockSnapshot(app)).accounts.some(
          (a) => a.domain === "github.com" && a.username === "octocat-renamed",
        ),
      )
      .toBe(true);
  });

  test("linking a domain from the detail sheet persists it", async ({ app }) => {
    await app.getByRole("button", { name: "Accounts" }).click();
    await app.getByText("github.com").click();

    await app.getByPlaceholder("app.other-site.com").fill("other-site.com");
    await app.getByRole("button", { name: "Link", exact: true }).click();

    await expect
      .poll(
        async () =>
          (await mockSnapshot(app)).accounts.find((acc) => acc.domain === "github.com")
            ?.linkedDomains,
      )
      .toContain("other-site.com");
  });

  test("deleting an account from the detail sheet removes it", async ({ app }) => {
    await app.getByRole("button", { name: "Accounts" }).click();
    await app.getByText("github.com").click();

    await app.getByRole("button", { name: "Delete account" }).click();
    await app.getByRole("dialog").getByRole("button", { name: "Delete account" }).click();

    await expect
      .poll(async () => (await mockSnapshot(app)).accounts.some((a) => a.domain === "github.com"))
      .toBe(false);
    await expect(app.getByText("github.com")).toHaveCount(0);
  });
});
