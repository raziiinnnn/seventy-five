import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Engine tests run in Node (pure TS, no DOM, no IndexedDB)
    environment: "node",
    include: ["src/engine/**/__tests__/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
