import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgres://eox:eox@localhost:5433/eox_test",
    },
  },
});
