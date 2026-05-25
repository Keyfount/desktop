import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite config for Keyfount Desktop.
 *
 * The frontend is a Preact + Tailwind v4 app served by the Tauri runtime.
 * Tauri injects its IPC bridge under window.__TAURI__; the dev server is
 * what `tauri dev` proxies. Port 1420 is the convention used by all
 * Tauri 2 templates — keep it stable so plugins that hard-code it work.
 */
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env["TAURI_DEV_HOST"] ?? false,
    ...(process.env["TAURI_DEV_HOST"]
      ? {
          hmr: {
            protocol: "ws" as const,
            host: process.env["TAURI_DEV_HOST"],
            port: 1421,
          },
        }
      : {}),
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: process.env["TAURI_ENV_PLATFORM"] === "windows" ? "chrome105" : "safari14",
    minify: !process.env["TAURI_ENV_DEBUG"] ? "esbuild" : false,
    sourcemap: !!process.env["TAURI_ENV_DEBUG"],
  },
});
