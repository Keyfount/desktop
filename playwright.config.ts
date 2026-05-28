import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Keyfount desktop + mobile *frontend* e2e suite.
 *
 * These tests drive the real Preact UI in a browser against a stateful mock
 * of the Tauri IPC bridge (see tests/e2e/mock/ipc.ts) — the native Rust
 * runtime can't run cross-platform here, and its logic is covered by
 * `cargo test`. The Vite dev server (port 1420, the Tauri convention) serves
 * the same bundle `tauri dev` would.
 *
 * Two projects render the two shells the app ships:
 *   - `desktop` : default desktop UA → `isMobile()` false → desktop shell.
 *   - `mobile`  : Pixel (Android) emulation → `isMobile()` true → mobile shell.
 * `main.tsx` switches on `navigator.userAgent`, so device emulation alone
 * exercises the real production code path. We use an Android device (not an
 * iPhone) so the project runs on Chromium and needs no extra WebKit download.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:1420",
    locale: "en-US",
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  projects: [
    {
      name: "desktop",
      testDir: "./tests/e2e/desktop",
      use: { ...devices["Desktop Chrome"], locale: "en-US" },
    },
    {
      name: "mobile",
      testDir: "./tests/e2e/mobile",
      use: { ...devices["Pixel 7"], locale: "en-US" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
