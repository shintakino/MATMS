import { expect, test, type Page } from "@playwright/test";

export { expect, test };

/** Honor the real policy in CI; never change credentials or bypass auth. */
export async function signIn(page: Page, email: string, password: string, keyboard = false) {
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/sign-in/email" && response.request().method() === "POST");
    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    if (keyboard) await submit.press("Enter");
    else await submit.click();
    const response = await result;
    if (response.status() !== 429 || process.env.CI !== "true") return;
    if (attempt === 1) throw new Error("CI sign-in remained rate limited after its retry window.");
    const seconds = Number(response.headers()["x-retry-after"] ?? response.headers()["retry-after"]);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 60) throw new Error("Invalid sign-in retry window.");
    await expect(submit).toBeEnabled();
    console.info(`CI sign-in paused for the server's ${seconds}-second retry window.`);
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  throw new Error("CI sign-in remained rate limited after its retry window.");
}
