import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

const email = process.env.MATMS_BROWSER_EMAIL, password = process.env.MATMS_BROWSER_PASSWORD, staffEmail = process.env.MATMS_BROWSER_STAFF_EMAIL;
test.skip(!email || !password, "Supply disposable browser-test credentials.");
const date = (offset: number) => new Date(Date.parse(`${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
async function login(page: Page, destination = "/admin/scheduling") {
  await page.goto(`/login?returnTo=${encodeURIComponent(destination)}`); await signIn(page, email!, password!);
  await expect(page).toHaveURL(new RegExp(destination.replaceAll("/", "\\/") + "$"), { timeout: 90000 });
}
async function policy(page: Page) {
  await page.goto("/admin/scheduling");
  await page.getByLabel("SHS teachers away per day", { exact: true }).fill("10"); await page.getByLabel("JHS teachers away per day", { exact: true }).fill("10");
  await page.getByLabel("Personnel away per day", { exact: true }).fill("10"); await page.getByLabel("All teachers combined per day (optional ceiling)").fill("");
  await page.getByRole("checkbox", { name: /Open leave booking/ }).check(); await page.getByRole("checkbox", { name: /Publish approved leave names/ }).check();
  await page.getByRole("button", { name: "Save leave policy", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
}
async function addPerson(page: Page, name: string, category: "shs" | "jhs" | "personnel", accountName?: string) {
  await page.getByLabel("Directory code", { exact: true }).fill(`B-${crypto.randomUUID().slice(0, 8)}`);
  await page.getByLabel("Person name", { exact: true }).fill(name); await page.getByLabel("Person category", { exact: true }).selectOption(category);
  if (accountName) {
    await page.getByLabel("Find personnel login").fill(accountName);
    const option = page.getByLabel("Linked login account").locator("option").filter({ hasText: accountName }); await expect(option).toHaveCount(1);
    await page.getByLabel("Linked login account").selectOption((await option.getAttribute("value"))!);
  }
  await page.getByRole("button", { name: "Add directory person", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function choosePerson(page: Page, name: string, teacherLink = false) {
  await page.getByLabel(teacherLink ? "Find a teacher" : "Find a person", { exact: true }).fill(name);
  const selector = page.getByLabel(teacherLink ? "Choose teacher" : "Request for", { exact: true });
  const option = selector.locator("option").filter({ hasText: name }); await expect(option).toHaveCount(1);
  const id = (await option.getAttribute("value"))!; await selector.selectOption(id); return id;
}
async function decide(row: Locator, status: "Approve" | "Cancel request", note: string) {
  await row.getByLabel("Decision or cancellation note").fill(note); await row.getByRole("button", { name: status, exact: true }).click(); await row.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(row.getByText(status === "Approve" ? "approved" : "cancelled", { exact: true })).toBeVisible();
}
async function createLink(page: Page, kind: "leave" | "resource", teacher?: string) {
  await page.getByLabel("Request type", { exact: true }).selectOption(kind);
  if (teacher) await choosePerson(page, teacher, true);
  await page.getByRole("button", { name: "Create request link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Public link created." })).toBeVisible();
  const url = await page.getByLabel("Public request link", { exact: true }).inputValue();
  expect(new URL(url).pathname).toBe("/reservation"); expect(new URL(url).searchParams.has("token")).toBe(false); expect(new URL(url).hash).toMatch(/^#token=[A-Za-z0-9_-]{43}$/);
  return url;
}
async function accessible(page: Page) { expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map(item => item.id)).toEqual([]); }

test("Admin maintains non-login teachers and personnel can file delegated leave with reapproval", async ({ page, browser }) => {
  const suffix = crypto.randomUUID().slice(0, 8), teacher = `Fictional SHS ${suffix}`, junior = `Fictional JHS ${suffix}`, reason = `Private delegated leave ${suffix}`;
  await login(page); await policy(page); await addPerson(page, teacher, "shs"); await addPerson(page, junior, "jhs");
  const directoryRow = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: junior, exact: true }) });
  await expect(directoryRow).toContainText("No login account"); await directoryRow.getByRole("button", { name: `Edit ${junior}`, exact: true }).click();
  await page.getByLabel("Person name", { exact: true }).fill(`${junior} corrected`); await page.getByRole("button", { name: "Save directory person", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${junior} corrected`, exact: true })).toBeVisible();
  if (staffEmail) await addPerson(page, `Fictional personnel operator ${suffix}`, "personnel", "Fictional staff");
  await accessible(page);
  await page.goto(`/leave?start=${date(60)}&end=${date(61)}`); const personId = await choosePerson(page, teacher);
  await expect(page).toHaveURL(new RegExp(`person=${personId}`));
  await page.getByLabel("Leave reason (private)", { exact: true }).fill(reason); await page.getByRole("button", { name: "Submit request", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Request submitted." })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: reason }); await expect(row).toContainText(teacher); await expect(row).toContainText("Filed by"); await decide(row, "Approve", "Reviewed delegated leave");
  const anonymous = await browser.newContext(), publicPage = await anonymous.newPage();
  await publicPage.goto(`${new URL(page.url()).origin}/leave-calendar?month=${date(60).slice(0, 7)}`); await expect(publicPage.getByText(teacher, { exact: false }).first()).toBeVisible();
  await expect(publicPage.locator("body")).not.toContainText(reason); await accessible(publicPage);
  await row.getByRole("button", { name: "Edit request", exact: true }).click(); await row.getByLabel("Updated leave reason (private)").fill(`${reason} changed`);
  await row.getByLabel("New end date (inclusive)").fill(date(59)); await row.getByLabel("Reason for this change").fill("Correct teacher dates"); await row.getByRole("button", { name: "Review changes", exact: true }).click(); await row.getByRole("button", { name: "Confirm update", exact: true }).click();
  await expect(row.getByRole("alert")).toBeVisible(); await expect(row.getByLabel("Updated leave reason (private)")).toHaveValue(`${reason} changed`); await expect(row.getByText("approved", { exact: true })).toBeVisible();
  await row.getByLabel("New end date (inclusive)").fill(date(62)); await row.getByRole("button", { name: "Review changes", exact: true }).click(); await row.getByRole("button", { name: "Confirm update", exact: true }).click(); await expect(row.getByText("pending", { exact: true })).toBeVisible();
  await publicPage.reload(); await expect(publicPage.getByText("Personnel", { exact: true }).first()).toBeVisible(); await expect(publicPage.locator("body")).not.toContainText(teacher); await decide(row, "Approve", "Reapprove corrected dates");
  await publicPage.reload(); await expect(publicPage.getByText(teacher, { exact: false }).first()).toBeVisible();
  await decide(row, "Cancel request", "Finish browser fixture");
  if (staffEmail) {
    const personnel = await browser.newContext(), staffPage = await personnel.newPage();
    await staffPage.goto(`${new URL(page.url()).origin}/login?returnTo=/leave`); await signIn(staffPage, staffEmail, password!); await expect(staffPage).toHaveURL(/\/leave$/);
    await choosePerson(staffPage, teacher); await staffPage.getByLabel("Start date", { exact: true }).fill(date(65)); await staffPage.getByLabel("End date (inclusive)").fill(date(65)); await staffPage.getByLabel("Leave reason (private)", { exact: true }).fill(`Personnel filed ${suffix}`); await staffPage.getByRole("button", { name: "Submit request", exact: true }).click();
    const filed = staffPage.getByRole("listitem").filter({ hasText: `Personnel filed ${suffix}` }); await expect(filed.getByText("pending", { exact: true })).toBeVisible(); await expect(filed.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await decide(filed, "Cancel request", "Finish personnel fixture"); await personnel.close();
  }
  await anonymous.close();
});

test("teacher-specific public links show blocked dates, file without login, and support used/revoked states", async ({ page, browser }) => {
  const suffix = crypto.randomUUID().slice(0, 8), teacher = `Fictional public JHS ${suffix}`, reason = `Private teacher link ${suffix}`;
  await login(page); await policy(page); await addPerson(page, teacher, "jhs"); const url = await createLink(page, "leave", teacher);
  const anonymous = await browser.newContext(), visitor = await anonymous.newPage(); const requests: string[] = [];
  visitor.on("request", request => { if (new URL(request.url()).pathname.includes("/scheduling/invitation")) { expect(request.method()).toBe("POST"); requests.push(request.url()); } });
  await visitor.goto(url); await expect(visitor.getByRole("heading", { name: "Teacher leave request", exact: true })).toBeVisible(); await expect(visitor.getByRole("heading", { name: `Leave for ${teacher}`, exact: true })).toBeVisible(); await expect(visitor.getByLabel("Email address")).toHaveCount(0);
  await expect(visitor.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await visitor.getByLabel("Availability month").fill(date(90).slice(0, 7)); await expect(visitor.getByRole("button", { name: `Choose this date ${date(90)}`, exact: true })).toBeVisible();
  await visitor.getByLabel("Start date", { exact: true }).fill(date(90)); await visitor.getByLabel("End date (inclusive)").fill(date(91)); await visitor.getByLabel("Leave reason (private)", { exact: true }).fill(reason);
  await accessible(visitor); await visitor.getByRole("button", { name: "Submit request", exact: true }).click(); await expect(visitor.getByRole("heading", { name: "Request received", exact: true })).toBeVisible();
  await visitor.reload(); await expect(visitor.getByRole("heading", { name: "Request received", exact: true })).toBeVisible(); await expect(visitor.getByRole("button", { name: "Submit request", exact: true })).toHaveCount(0);
  expect(requests.length).toBeGreaterThan(0); expect(requests.every(value => !value.includes(new URL(url).hash.slice(7)))).toBe(true);
  await page.goto("/leave"); const row = page.getByRole("listitem").filter({ hasText: reason }); await expect(row).toContainText(teacher); await expect(row).toContainText("Submitted through a public link"); await decide(row, "Approve", "Confirmed teacher identity");
  await page.goto("/admin/scheduling"); const second = await createLink(page, "leave", teacher); await visitor.goto(second); await visitor.getByLabel("Availability month").fill(date(90).slice(0, 7));
  await expect(visitor.getByRole("button", { name: `Choose this date ${date(90)}`, exact: true })).toHaveCount(0); await expect(visitor.getByText("reserved", { exact: true }).first()).toBeVisible();
  await visitor.getByLabel("Start date", { exact: true }).fill(date(90)); await visitor.getByLabel("End date (inclusive)").fill(date(91)); await visitor.getByLabel("Leave reason (private)", { exact: true }).fill("Retained while dates unavailable");
  await expect(visitor.getByRole("alert").filter({ hasText: "Choose different dates" })).toBeVisible(); await expect(visitor.getByRole("button", { name: "Submit request", exact: true })).toBeDisabled();
  const readyLink = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: teacher, exact: true }) }).filter({ hasText: "Ready" });
  await readyLink.getByRole("button", { name: /Revoke link/ }).click(); await readyLink.getByRole("button", { name: "Confirm revoke", exact: true }).click(); await expect(readyLink).toHaveCount(0);
  await visitor.reload(); await expect(visitor.getByRole("alert").filter({ hasText: "Request link unavailable" })).toBeVisible(); await expect(visitor.getByRole("button", { name: "Submit request", exact: true })).toHaveCount(0); await accessible(visitor);
  await visitor.goto(`${new URL(page.url()).origin}/reservation`); await expect(visitor.getByRole("alert").filter({ hasText: "Request link unavailable" })).toBeVisible(); await accessible(visitor);
  await page.goto("/leave"); await decide(page.getByRole("listitem").filter({ hasText: reason }), "Cancel request", "Finish public teacher fixture"); await anonymous.close();
});

test("students use published-resource links and only Admin manages reservations", async ({ page, browser }) => {
  const suffix = crypto.randomUUID().slice(0, 8), name = `Fictional student hall ${suffix}`, student = `Fictional student ${suffix}`, purpose = `Private student purpose ${suffix}`;
  await login(page, "/bookings/resources"); await page.getByLabel("Resource name (one distinct unit or facility)").fill(name); await page.getByLabel("Public description (optional)").fill("Public fictional hall description"); await page.getByRole("checkbox", { name: "Publish on resource calendar" }).check(); await page.getByRole("button", { name: "Add resource", exact: true }).click(); await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.goto("/admin/scheduling"); const url = await createLink(page, "resource");
  const anonymous = await browser.newContext(), visitor = await anonymous.newPage(); await visitor.goto(url); await expect(visitor.getByRole("heading", { name: "Equipment & facility request", exact: true })).toBeVisible();
  await visitor.getByLabel("Search resources", { exact: true }).fill(name); const option = visitor.getByLabel("Choose resource", { exact: true }).locator("option").filter({ hasText: name }); await expect(option).toHaveCount(1); const resourceId = (await option.getAttribute("value"))!;
  await visitor.getByLabel("Choose resource", { exact: true }).selectOption(resourceId); await expect(visitor).toHaveURL(/#token=/);
  await visitor.getByLabel("Availability month").fill(date(120).slice(0, 7)); await visitor.getByLabel("Your name / beneficiary name").fill(student); await visitor.getByLabel("Requester category").selectOption("student"); await visitor.getByLabel("Start date", { exact: true }).fill(date(120)); await visitor.getByLabel("End date (inclusive)").fill(date(121)); await visitor.getByLabel("Purpose (private)", { exact: true }).fill(purpose);
  await visitor.setViewportSize({ width: 390, height: 844 }); expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await accessible(visitor);
  await visitor.getByRole("button", { name: "Submit request", exact: true }).click(); await expect(visitor.getByRole("heading", { name: "Request received", exact: true })).toBeVisible();
  await page.goto("/bookings"); const row = page.getByRole("listitem").filter({ hasText: purpose }); await expect(row).toContainText(student); await expect(row).toContainText("Student"); await decide(row, "Approve", "Confirmed student and event details");
  await visitor.goto(`${new URL(page.url()).origin}/availability?resource=${resourceId}&month=${date(120).slice(0, 7)}`); await expect(visitor.getByText(`Showing: ${name}`)).toBeVisible(); await expect(visitor.getByText("reserved", { exact: true }).first()).toBeVisible(); await expect(visitor.locator("body")).not.toContainText(student); await expect(visitor.locator("body")).not.toContainText(purpose); await accessible(visitor);
  await row.getByRole("button", { name: "Edit request", exact: true }).click(); await row.getByLabel("New end date (inclusive)").fill(date(122)); await row.getByLabel("Updated purpose (private)").fill(`${purpose} revised`); await row.getByLabel("Reason for this change").fill("Correct event length"); await row.getByRole("button", { name: "Review changes", exact: true }).click(); await accessible(page); await row.getByRole("button", { name: "Confirm update", exact: true }).click(); await expect(row.getByText("pending", { exact: true })).toBeVisible(); await decide(row, "Cancel request", "Finish student fixture");
  if (staffEmail) {
    await page.getByRole("button", { name: "Open user menu" }).click(); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/login\?returnTo=/);
    await signIn(page, staffEmail, password!); await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByText("Only an Administrator can create and manage internal reservations.", { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Submit request", exact: true })).toHaveCount(0); await expect(page.getByRole("link", { name: "Manage resources", exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(student); await expect(page.locator("body")).not.toContainText(purpose);
    await page.goto("/bookings/resources"); await expect(page).toHaveURL(/\/dashboard$/);
  }
  await anonymous.close();
});
