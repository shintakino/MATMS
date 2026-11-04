import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/browser", workers: 1, timeout: 300_000, expect: { timeout: 20_000 }, use: { baseURL: process.env.MATMS_BROWSER_URL ?? "http://localhost:3101", headless: true, actionTimeout: 20_000, navigationTimeout: 30_000, trace: "retain-on-failure" }, outputDir: "/tmp/matms-browser-results" });
