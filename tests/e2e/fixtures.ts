/**
 * Shared Playwright fixtures for the frontend e2e suite.
 *
 * The `app` fixture installs the Tauri IPC mock (via addInitScript, so it's
 * live before any app code runs), seeds it per-test, and navigates to the
 * SPA root. Override the seed with `test.use({ seed: { ... } })`.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { installMock, type Seed } from "./mock/ipc.js";

interface Fixtures {
  seed: Seed;
  app: Page;
}

export const test = base.extend<Fixtures>({
  seed: [{ scenario: "first-run" }, { option: true }],

  app: async ({ page, seed }, use) => {
    await page.addInitScript(installMock, seed);
    await page.goto("/");
    await use(page);
  },
});

/** Fire a backend → frontend Tauri event from inside a test. */
export async function emitEvent(page: Page, event: string, payload: unknown = null): Promise<void> {
  await page.evaluate(
    ([e, p]) =>
      (window as unknown as { __MOCK__: { emit: (e: string, p: unknown) => void } }).__MOCK__.emit(
        e as string,
        p,
      ),
    [event, payload] as const,
  );
}

/** Read the mock's internal snapshot for assertions. */
export async function mockSnapshot(page: Page): Promise<{
  activeId: string | null;
  unlocked: boolean;
  vaultCount: number;
  accounts: Array<{ domain: string; username: string; linkedDomains?: string[] }>;
  hasPin: boolean;
  autoLockMinutes: number | null;
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
  clipboardClearSeconds: number | null;
}> {
  return page.evaluate(() =>
    (window as unknown as { __MOCK__: { snapshot: () => any } }).__MOCK__.snapshot(),
  );
}

export { expect };
