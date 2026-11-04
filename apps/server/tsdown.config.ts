import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/custodial-import-worker.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/@matms\/.*/],
  },
});
