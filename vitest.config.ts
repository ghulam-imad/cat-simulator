import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts, whose root is web/.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
