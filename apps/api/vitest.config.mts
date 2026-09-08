import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tenancy tests write real rows in two organizations and assert on what
    // each can see. Running files in parallel would let one file's cleanup
    // interleave with another's assertions, so they are serialised.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Refuses to run if the connection under test can bypass RLS.
    setupFiles: ["./tests/setup.ts"],
  },
});
