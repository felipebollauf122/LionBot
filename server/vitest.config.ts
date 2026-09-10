import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // NOTE: must NOT have a leading "./" — with it, Vitest 2.1.9 on this
    // Windows setup silently fails to resolve/execute the setup file (no
    // error, it's just skipped), which meant this file's env vars and its
    // src/db mock were never actually running. Verified with process.exit(1)
    // and fs writes in the setup file: they had zero effect with "./tests/…"
    // and took effect immediately once the leading "./" was removed.
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@eaglebot/types": path.resolve(__dirname, "../lib/types/database"),
    },
  },
});
