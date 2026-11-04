import { expect, signIn, test } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

const email = process.env.MATMS_BROWSER_EMAIL;
const password = process.env.MATMS_BROWSER_PASSWORD;
test.skip(!email || !password, "Supply disposable browser-test credentials.");

test("account reset uses masked validation and the confirmed password works", async ({ page, browser }) => {
  await page.goto("/login"); await signIn(page, email!, password!); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/admin/users");
  const suffix = crypto.randomUUID();
  const accountEmail = `usability-${suffix}@example.test`;
  const name = `Usability fixture ${suffix.slice(0, 8)}`;
  const form = page.getByRole("heading", { name: "Provision account", exact: true }).locator("..");
  await form.getByLabel("Name", { exact: true }).fill(name); await form.getByLabel("Email", { exact: true }).fill(accountEmail); await form.getByLabel("Temporary password", { exact: true }).fill(password!); await form.getByRole("button", { name: "Provision account", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: accountEmail }); await expect(row).toBeVisible();
  const reset = row.getByRole("button", { name: "Reset password", exact: true }); await reset.click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toContainText(accountEmail);
  await expect(dialog.getByLabel("New temporary password", { exact: true })).toHaveAttribute("type", "password");
  await dialog.getByLabel("New temporary password", { exact: true }).fill(password!); await dialog.getByLabel("Confirm temporary password", { exact: true }).fill(`${password!}different`); await dialog.getByRole("button", { name: "Confirm password reset" }).click(); await expect(dialog.getByRole("alert")).toContainText("do not match");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(reset).toBeFocused();
  await reset.click(); await expect(dialog.getByLabel("New temporary password", { exact: true })).toBeEmpty();
  const newPassword = `${password!}new`;
  await dialog.getByLabel("New temporary password", { exact: true }).fill(newPassword); await dialog.getByLabel("Confirm temporary password", { exact: true }).fill(newPassword);
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(); expect(scan.violations.map((item) => item.id)).toEqual([]);
  await dialog.getByRole("button", { name: "Confirm password reset" }).click(); await expect(dialog).toBeHidden(); await expect(page.getByRole("status").filter({ hasText: "Password reset." })).toBeVisible();
  const context = await browser.newContext(); const other = await context.newPage(); await other.goto(`${new URL(page.url()).origin}/login`); await signIn(other, accountEmail, newPassword); await expect(other).toHaveURL(/\/change-password/); await context.close();
});

test("access previews and report filters explain the selected scope", async ({ page }) => {
  await page.goto("/login"); await signIn(page, email!, password!); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/admin/access"); await page.getByRole("combobox", { name: "Account", exact: true }).selectOption({ index: 1 }); await page.getByRole("combobox", { name: "Record", exact: true }).selectOption({ index: 1 }); await expect(page.getByRole("region", { name: "Access preview" })).toContainText("Internal");
  await page.goto("/reports?report=ledger&stockStatus=low"); const advanced = page.locator("details").filter({ has: page.getByText("Advanced filters", { exact: true }) }); await expect(advanced).toHaveAttribute("open", ""); await expect(page.getByRole("region", { name: "Active filters" })).toContainText("Stock: low"); await expect(advanced).toContainText("stock-transaction recording date"); await page.reload(); await expect(page.getByRole("combobox", { name: "Stock status", exact: true })).toHaveValue("low");
  await page.goto("/admin/audit"); await expect(page.getByRole("combobox", { name: "Action", exact: true }).locator("option")).not.toHaveCount(1); await expect(page.getByRole("combobox", { name: "Actor", exact: true })).toBeVisible();
  await page.goto("/admin/settings"); await expect(page.getByRole("group", { name: "School identity" })).toBeVisible(); await expect(page.getByRole("group", { name: "Sign-in and session policy" })).toBeVisible(); await expect(page.getByRole("group", { name: "QR label website address" })).toBeVisible();
});
