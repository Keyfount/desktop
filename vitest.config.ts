import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // framer-motion's ESM bundle imports 'react' internally; alias it to
  // preact/compat so vitest can resolve it under the Preact runtime.
  resolve: {
    alias: {
      react: resolve("node_modules/preact/compat"),
      "react-dom/test-utils": resolve("node_modules/preact/test-utils"),
      "react-dom": resolve("node_modules/preact/compat"),
      "react/jsx-runtime": resolve("node_modules/preact/jsx-runtime"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: false,
    server: {
      deps: {
        inline: ["framer-motion"],
      },
    },
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/crypto/wordlist.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  },
});
