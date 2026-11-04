import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const email = process.env.MATMS_BROWSER_EMAIL;
const password = process.env.MATMS_BROWSER_PASSWORD;
test.skip(!email || !password, "Supply disposable browser-test credentials.");

test("stock, custody, reporting, label preview and accessible core screens", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (new URL(response.url()).pathname.startsWith("/rpc/") && response.status() >= 400) errors.push(`RPC ${response.status()}: ${new URL(response.url()).pathname}`); });
  await page.goto("/login?returnTo=%2Fboxes");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/boxes(?:\?|$)/);
  await page.goto("/documents");
  await page.getByRole("link", { name: "Fictional sample record", exact: true }).click();
  await page.getByLabel("Keywords", { exact: true }).fill("browser-verified");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.getByText("Details saved.", { exact: true })).toBeVisible();
  await page.goto("/inventory");
  const stock = page.getByRole("heading", { name: "Stock operation", exact: true }).locator("..");
  await stock.locator('[name="inventoryId"]').selectOption({ index: 1 });
  await expect(page.getByRole("cell", { name: "DEMO-LEAVE-V1", exact: true })).toBeVisible();
  if (!await page.getByRole("cell", { name: /^0 copies;/ }).count()) {
    await stock.locator('[name="action"]').selectOption("correct");
    await stock.locator('[name="quantity"]').fill("0");
    await stock.locator('[name="reason"]').fill("Reset fictional browser fixture");
    await stock.getByRole("button", { name: "Review stock operation" }).click();
    await page.getByRole("button", { name: "Confirm correction" }).click();
    await expect(page.getByRole("cell", { name: /^0 copies;/ })).toBeVisible();
  }
  await stock.locator('[name="action"]').selectOption("receive");
  await stock.locator('[name="quantity"]').fill("6");
  await stock.locator('[name="reason"]').fill("Browser opening count");
  await stock.getByRole("button", { name: "Review stock operation" }).click();
  await expect(page.getByRole("cell", { name: /^0 copies;/, includeHidden: true })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("cell", { name: /^0 copies;/ })).toBeVisible();
  await stock.getByRole("button", { name: "Review stock operation" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm operation", exact: true }).click();
  await expect(page.getByText("Stock operation confirmed.", { exact: true })).toBeVisible();
  await stock.locator('[name="action"]').selectOption("issue");
  await stock.locator('[name="quantity"]').fill("2");
  await stock.getByRole("button", { name: "Review stock operation" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm operation", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Low stock", exact: true })).toBeVisible();
  await stock.locator('[name="action"]').selectOption("correct");
  await stock.locator('[name="quantity"]').fill("7");
  await stock.getByRole("button", { name: "Review stock operation" }).click();
  await page.getByRole("button", { name: "Confirm correction" }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(page.getByRole("cell", { name: /^7 copies;/ })).toBeVisible();
  await page.goto("/requests");
  await page.getByLabel("Request code").fill(`BROWSER-${Date.now()}`);
  await page.getByLabel("Requester name").fill("Fictional requester");
  await page.getByLabel("Purpose", { exact: true }).fill("Browser workflow");
  await page.getByLabel("Request type").selectOption("borrow");
  await page.getByLabel("Find documents", { exact: true }).fill("DEMO-DOCUMENT-01");
  await page.getByRole("checkbox", { name: /DEMO-DOCUMENT-01/ }).check();
  await page.getByLabel("Find documents", { exact: true }).fill("no-such-document-browser-fixture");
  await expect(page.getByRole("region", { name: "Selected documents" })).toContainText("DEMO-DOCUMENT-01");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Submit request", exact: true }).click();
  await page.getByRole("button", { name: "Record decision" }).click();
  await page.getByLabel("Recipient", { exact: true }).fill("Fictional recipient");
  await page.getByLabel("Due (Manila time)").fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  await page.getByRole("checkbox", { name: "Recipient acknowledged" }).check();
  await page.getByRole("button", { name: "Release original" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Release recorded.", { exact: true })).toBeVisible();
  await page.goto("/loans");
  await page.getByRole("button", { name: "Record return", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record return", exact: true })).toHaveCount(0);
  await page.goto("/reports");
  await page.getByRole("combobox", { name: "Report", exact: true }).selectOption("ledger");
  await expect(page.getByRole("cell", { name: "DEMO-LEAVE-V1", exact: true }).first()).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export filtered CSV" }).click(); expect((await download).suggestedFilename()).toContain("matms-ledger");
  await page.goto("/admin/settings");
  const qrOrigin = page.getByLabel("Public website address (Canonical HTTPS origin)", { exact: true });
  if (!(await qrOrigin.inputValue()).startsWith("https://")) {
    await qrOrigin.fill("https://matms-browser.example.test");
    await page.getByLabel("Old-label redirect and reprint plan", { exact: true }).fill("Fictional browser-test QR origin; no operational labels. Test-only redirect/reprint rehearsal.");
    await page.getByRole("button", { name: "Review settings", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  }
  await page.goto("/labels");
  await page.getByRole("checkbox", { name: /DEMO-FORMS-01/ }).check();
  await expect(page.getByRole("region", { name: "Label preview" })).toBeVisible();
  await page.evaluate(() => { window.print = () => {}; });
  await page.getByRole("button", { name: "Print labels", exact: true }).click();
  await expect(page.getByText("Printed: on print", { exact: true })).toHaveCount(0);
  await page.emulateMedia({ media: "print" }); await expect(page.locator(".qr-label")).toBeVisible();
  await page.pdf({ path: "/tmp/matms-browser-labels.pdf", format: "A4", printBackground: true }); await page.emulateMedia({ media: "screen" });
  await page.goto("/scan"); await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status")).toContainText(/camera|Camera|HTTPS/);
  await page.getByLabel("Box code", { exact: true }).fill("DEMO-FORMS-01"); await page.getByRole("button", { name: "Find box" }).click();
  await expect(page).toHaveURL(/\/boxes\/[0-9a-f-]+$/);
  const boxPath = new URL(page.url()).pathname;
  await page.context().clearCookies(); await page.goto(boxPath); await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel("Email address").fill(email!); await page.getByLabel("Password", { exact: true }).fill(password!); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`${boxPath}$`));
  for (const route of ["/dashboard", "/boxes", "/documents", "/templates", "/inventory", "/requests", "/loans", "/reports", "/admin/archive", "/admin/settings", "/admin/users", "/admin/access", "/admin/audit"]) {
    await page.goto(route); await expect(page.locator("main").first()).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(); expect(scan.violations, `${route}: ${scan.violations.map((entry) => entry.id).join(", ")}`).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/dashboard"); await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY"); expect(errors).toEqual([]);
});

for (const role of ["staff", "viewer"] as const) {
  test(`${role} sees only its permitted browser controls`, async ({ page }) => {
    const account = role === "staff" ? process.env.MATMS_BROWSER_STAFF_EMAIL : process.env.MATMS_BROWSER_VIEWER_EMAIL;
    test.skip(!account, "Supply the optional role-fixture email.");
    await page.goto("/login"); await page.getByLabel("Email address").fill(account!); await page.getByLabel("Password", { exact: true }).fill(password!); await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0);
    await page.goto("/documents");
    await expect(page.getByRole("link", { name: "Fictional sample record", exact: true })).toBeVisible();
    if (role === "staff") await expect(page.getByRole("button", { name: "Create document", exact: true })).toBeVisible();
    else await expect(page.getByRole("button", { name: "Create document", exact: true })).toHaveCount(0);
    await page.goto("/admin/archive"); await expect(page).toHaveURL(/\/dashboard$/);
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(); expect(scan.violations).toEqual([]);
  });
}

test("printed label layouts isolate the label from navigation", async ({ page }) => {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email!); await page.getByLabel("Password", { exact: true }).fill(password!); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/labels"); await page.getByRole("checkbox", { name: /DEMO-FORMS-01/ }).check();
  await page.evaluate(() => { window.print = () => {}; }); await page.getByRole("button", { name: "Print labels", exact: true }).click();
  await page.emulateMedia({ media: "print" }); await expect(page.locator(".qr-label")).toBeVisible(); await expect(page.getByRole("heading", { name: "Box labels", exact: true })).toBeHidden();
  await page.screenshot({ path: "/tmp/matms-label-preview.png", fullPage: true }); await page.pdf({ path: "/tmp/matms-browser-labels.pdf", format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" }); await page.getByRole("combobox", { name: "Layout", exact: true }).selectOption("single");
  await expect(page.locator(".qr-print-sheet")).toHaveClass(/qr-single/); await page.emulateMedia({ media: "print" }); await page.pdf({ path: "/tmp/matms-browser-single-label.pdf", printBackground: true });
});

test("stock correction dialog supports keyboard cancellation and focus return", async ({ page }) => {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email!); await page.getByLabel("Password", { exact: true }).fill(password!); await page.getByRole("button", { name: "Sign in", exact: true }).press("Enter"); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/inventory"); const form = page.getByRole("heading", { name: "Stock operation", exact: true }).locator("..");
  await form.locator('[name="inventoryId"]').selectOption({ index: 1 }); await form.locator('[name="action"]').selectOption("correct"); await form.locator('[name="quantity"]').fill("9"); await form.locator('[name="reason"]').fill("Keyboard-only correction review");
  const review = form.getByRole("button", { name: "Review stock operation" }); await review.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog"); await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(dialog).toBeHidden(); await expect(review).toBeFocused();
});

test("archive intake, failed input retention, folder move and document refile", async ({ page }) => {
  const suffix = Date.now();
  const boxCode = `BROWSER-BOX-${suffix}`, folderCode = `BROWSER-FOLDER-${suffix}`, documentCode = `BROWSER-DOC-${suffix}`;
  await page.goto("/login"); await page.getByLabel("Email address").fill(email!); await page.getByLabel("Password", { exact: true }).fill(password!); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/boxes"); await page.getByLabel("Box code", { exact: true }).fill(boxCode);
  await page.getByLabel("Category", { exact: true }).selectOption({ label: "Administrative" }); await page.getByLabel("Shelf location", { exact: true }).selectOption({ label: "Demo room / A / 01" }); await page.getByRole("button", { name: "Create box", exact: true }).click();
  await expect(page.getByText("Box created.", { exact: true })).toBeVisible();
  const boxRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: boxCode, exact: true }) }); await expect(boxRow).toBeVisible();
  const boxPath = await boxRow.getByRole("link").getAttribute("href");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption(""); await expect(page).toHaveURL(/registerLifecycle=/); await page.reload(); await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("");
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "DEMO-FORMS-01", exact: true }) }).getByRole("link").click();
  const intake = page.getByRole("heading", { name: "Create folder", exact: true }).locator("..");
  await intake.getByLabel("Code", { exact: true }).fill(folderCode); await intake.getByLabel("Name", { exact: true }).fill(folderCode); await intake.getByRole("button", { name: "Create folder", exact: true }).click(); await expect(intake.getByRole("status")).toHaveText("Folder created.");
  await page.getByRole("link", { name: folderCode, exact: true }).click(); const folderPath = new URL(page.url()).pathname;
  const edit = page.getByRole("heading", { name: "Edit folder details", exact: true }).locator(".."); await edit.getByLabel("Urgency", { exact: true }).fill("Browser verified"); await edit.getByRole("button", { name: "Save details", exact: true }).click(); await expect(page.getByText("Details saved.", { exact: true })).toBeVisible();
  const move = page.getByRole("heading", { name: "Move folder", exact: true }).locator(".."); await move.getByRole("combobox", { name: "Destination", exact: true }).selectOption({ label: boxCode }); await move.getByLabel("Reason", { exact: true }).fill("Fictional folder relocation"); await move.getByRole("button", { name: "Record move", exact: true }).click(); await expect(page.getByRole("navigation", { name: "Home location" }).getByRole("link")).toHaveAttribute("href", boxPath!); await expect(page.getByText("Fictional folder relocation", { exact: true })).toBeVisible();
  await page.goto("/documents"); const documentForm = page.getByRole("heading", { name: "Create document record", exact: true }).locator("..");
  await documentForm.getByLabel("Search folder", { exact: true }).fill(folderCode); await documentForm.getByRole("combobox", { name: "Folder", exact: true }).selectOption({ index: 1 }); await documentForm.getByLabel("Document code", { exact: true }).fill("DEMO-DOCUMENT-01"); await documentForm.getByLabel("Title", { exact: true }).fill(documentCode);
  await documentForm.getByRole("button", { name: "Create document", exact: true }).click(); await expect(documentForm.getByRole("status")).not.toBeEmpty(); await expect(documentForm.getByLabel("Title", { exact: true })).toHaveValue(documentCode);
  const optional = documentForm.locator("details").filter({ has: page.getByText("Optional document details", { exact: true }) });
  await optional.locator(":scope > summary").click(); await documentForm.getByLabel("Keywords", { exact: true }).fill("Preserved optional metadata"); await optional.locator(":scope > summary").click();
  await documentForm.getByLabel("Document code", { exact: true }).fill(documentCode); await documentForm.getByRole("button", { name: "Create document", exact: true }).click(); await expect(documentForm.getByRole("status")).toHaveText("Document record created.");
  await documentForm.getByRole("link", { name: "Open created document", exact: true }).click(); const refile = page.getByRole("heading", { name: "Refile document", exact: true }).locator(".."); await refile.getByRole("combobox", { name: "Destination", exact: true }).selectOption({ label: "DEMO-FORMS-01 / DEMO-BLANK-FORMS — Fictional blank forms" }); await refile.getByLabel("Reason", { exact: true }).fill("Fictional document refile"); await refile.getByRole("button", { name: "Record move", exact: true }).click(); await expect(page.getByRole("navigation", { name: "Home location" }).getByRole("link", { name: "Fictional blank forms", exact: true })).toBeVisible(); await expect(page.getByText("Fictional document refile", { exact: true })).toBeVisible();
  await page.goto("/inventory"); const setup = page.getByRole("heading", { name: "Set up template stock", exact: true }).locator("..");
  await expect(setup.getByRole("combobox", { name: "Folder", exact: true }).locator("option").filter({ hasText: folderCode })).toHaveCount(0);
  await page.goto(folderPath); await expect(page.getByText("No permitted documents are present.", { exact: true })).toBeVisible();
});
