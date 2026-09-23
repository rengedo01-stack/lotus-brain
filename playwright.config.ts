import path from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.LOTUS_WEB_E2E_BASE_URL;
const artifactDirectory = process.env.LOTUS_WEB_E2E_ARTIFACT_DIR;
const stateDirectory = process.env.LOTUS_WEB_E2E_STATE_DIR;

if (baseURL === undefined || baseURL.length === 0) {
  throw new Error("LOTUS_WEB_E2E_BASE_URL is required for browser E2E tests.");
}

if (artifactDirectory === undefined || artifactDirectory.length === 0) {
  throw new Error("LOTUS_WEB_E2E_ARTIFACT_DIR is required for browser E2E tests.");
}

if (stateDirectory === undefined || stateDirectory.length === 0) {
  throw new Error("LOTUS_WEB_E2E_STATE_DIR is required for browser E2E tests.");
}

export default defineConfig({
  testDir: "./apps/web/e2e",
  globalSetup: "./apps/web/e2e/support/purchase-reversal-fixture.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: process.env.CI === "true",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(artifactDirectory, "playwright"),
  reporter: [["list"]],
  use: {
    baseURL,
    browserName: "chromium",
    storageState: `${stateDirectory}/admin.json`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
