import { test, expect, mockSnapshot } from "../fixtures.js";

const MASTER = "correct-horse-battery-staple";

test.describe("account history lifecycle", () => {
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

  test("lists, searches and selects a saved account", async ({ app }) => {
    await app.getByRole("button", { name: "Accounts" }).click();
    await expect(app.getByRole("heading", { name: "Accounts" })).toBeVisible();

    // Both seeded accounts are listed.
    await expect(app.getByRole("button", { name: /github\.com/ })).toBeVisible();
    await expect(app.getByRole("button", { name: /gitlab\.com/ })).toBeVisible();

    // Search filters the list down to the match.
    const search = app.getByPlaceholder("Search accounts…");
    await search.fill("github");
    await expect(app.getByRole("button", { name: /gitlab\.com/ })).toHaveCount(0);
    await expect(app.getByRole("button", { name: /github\.com/ })).toBeVisible();
    await search.fill("");

    // Select github → its detail pane opens.
    await app.getByRole("button", { name: /github\.com/ }).click();
    await expect(app.getByRole("heading", { name: "github.com" })).toBeVisible();
  });

  test("renames a saved account (changing the derived password)", async ({ app }) => {
    await app.getByRole("button", { name: "Accounts" }).click();
    await app.getByRole("button", { name: /github\.com/ }).click();
    await expect(app.getByRole("heading", { name: "github.com" })).toBeVisible();

    // Rename octocat → octocat-2. The Save button only appears once dirty.
    await app.getByRole("textbox", { name: "Username or email" }).fill("octocat-2");
    await app.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(async () =>
        (await mockSnapshot(app)).accounts.some(
          (a) => a.domain === "github.com" && a.username === "octocat-2",
        ),
      )
      .toBe(true);
  });

  test("deletes a saved account via the confirmation modal", async ({ app }) => {
    await app.getByRole("button", { name: "Accounts" }).click();
    await app.getByRole("button", { name: /github\.com/ }).click();
    await expect(app.getByRole("heading", { name: "github.com" })).toBeVisible();

    await app.getByRole("button", { name: "Delete account" }).click();
    const dialog = app.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete account" }).click();

    await expect
      .poll(async () => (await mockSnapshot(app)).accounts.some((a) => a.domain === "github.com"))
      .toBe(false);
    await expect(app.getByRole("button", { name: /github\.com/ })).toHaveCount(0);
  });
});
