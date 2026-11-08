import { defineConfig } from "vitest/config";
import path from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    // "server-only" throws outside a Next server build, so stub it for unit tests.
    alias: { "server-only": path.resolve(root, "lib/test/server-only-stub.ts") },
  },
});
