import type { UserConfig } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
}) satisfies UserConfig as UserConfig;
