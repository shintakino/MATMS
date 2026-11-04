import { expect, test } from "@playwright/test";
import * as XLSX from "../../packages/api/node_modules/xlsx/xlsx.mjs";

const email = process.env.MATMS_BROWSER_EMAIL;
const password = process.env.MATMS_BROWSER_PASSWORD;
test.skip(!email || !password, "Supply disposable browser-test credentials.");

function fictionalStockCard() {
  const workbook = XLSX.utils.book_new();
  const rows: unknown[][] = Array.from({ length: 13 }, () => []);
  rows[3] = ["STOCK CARD"];
  rows[10] = ["Date", "Reference", "Receipt", "Issue", null, "Balance"];
  rows[12] = ["2026-01-01", "Fictional source", 10, null, "Test office", 10];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "SC");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("stage and review a fictional historical stock card", async ({ page, request }) => {
  page.setDefaultTimeout(90_000); page.setDefaultNavigationTimeout(90_000);
  const anonymous = await request.post("/api/custodial-imports", { headers: { origin: "http://127.0.0.1:3101", "content-type": "application/octet-stream", "x-file-name": "test.xlsx", "x-operation-id": crypto.randomUUID() }, data: fictionalStockCard() });
  expect(anonymous.status()).toBe(401);
  await page.goto("/login"); await page.getByLabel("Email address").fill(email!); await page.getByLabel("Password", { exact: true }).fill(password!); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  const crossOrigin = await page.request.post("/api/custodial-imports", { headers: { origin: "https://untrusted.example", "content-type": "application/octet-stream", "x-file-name": "test.xlsx", "x-operation-id": crypto.randomUUID() }, data: fictionalStockCard() });
  expect(crossOrigin.status()).toBe(403);
  const malformed = await page.request.post("/api/custodial-imports", { headers: { origin: "http://127.0.0.1:3101", "content-type": "application/octet-stream", "x-file-name": "test.xlsx", "x-operation-id": crypto.randomUUID() }, data: Buffer.from("not a workbook") });
  expect(malformed.status()).toBe(400);
  const oversized = await page.request.post("/api/custodial-imports", { headers: { origin: "http://127.0.0.1:3101", "content-type": "application/octet-stream", "x-file-name": "test.xlsx", "x-operation-id": crypto.randomUUID() }, data: Buffer.alloc(8 * 1024 * 1024 + 1) });
  expect(oversized.status()).toBe(413);
  await page.goto("/property-inventory");
  const code = `IMPORT-${crypto.randomUUID()}`;
  const create = page.locator("details").filter({ has: page.getByText("Create item", { exact: true }) }); await create.locator(":scope > summary").click();
  await create.getByLabel("Item / stock code").fill(code); await create.getByLabel("Article", { exact: true }).fill("Fictional import item"); await create.getByLabel("Description").fill("Import fixture"); await create.getByLabel("Unit of measure").fill("piece"); await create.getByRole("button", { name: "Create item", exact: true }).click();
  await expect(page.getByText("Item created. Open it to add a lot or office balance.")).toBeVisible();
  const search = page.locator("details").filter({ has: page.getByText("Search and filters", { exact: true }) }); await search.locator(":scope > summary").click(); await search.getByLabel("Search", { exact: true }).fill(code); await search.getByRole("button", { name: "Apply filters" }).click(); await page.getByRole("link", { name: "Fictional import item" }).click();
  const balance = page.locator("details").filter({ has: page.getByText("Create office balance", { exact: true }) }); await balance.locator(":scope > summary").click(); await balance.getByLabel("Fund cluster").fill("IMPORT"); await balance.getByLabel("Office / location").fill("Test office"); await balance.getByRole("button", { name: "Create zero balance" }).click(); await expect(page.getByText("Office balance created with zero stock.")).toBeVisible();
  await page.goto("/property-inventory/imports");
  await page.getByLabel("Workbook").setInputFiles({ name: "fictional-stock.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fictionalStockCard() });
  await page.getByRole("button", { name: "Stage for review" }).click(); await expect(page.getByText(/Workbook staged for review/)).toBeVisible();
  await page.getByRole("link", { name: "fictional-stock.xlsx", exact: true }).first().click();
  await expect(page.getByText(/1 source rows/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Import progress" })).toContainText("1 unresolved");
  await page.getByRole("button", { name: "Review commit" }).click();
  await expect(page.getByText("Resolve or exclude all 1 remaining source row(s) before reviewing the commit.")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByLabel("Item code or description").fill(code); await page.getByRole("button", { name: "Search", exact: true }).click();
  const row = page.locator("details").filter({ has: page.getByText(/SC row 13/) }); await row.locator(":scope > summary").first().click();
  await row.getByRole("combobox", { name: "Target balance" }).selectOption({ index: 1 });
  await row.getByLabel("Quantity", { exact: true }).fill("10"); await row.getByLabel("Transaction date").fill("2026-01-01"); await row.getByLabel("Reference", { exact: true }).fill("Fictional source"); await row.getByLabel("Reason", { exact: true }).fill("Verified opening"); await row.getByLabel("Verified balance after row").fill("10"); await row.getByLabel("Source verification").fill("Compared with fictional fixture"); await row.getByLabel("Resolution: STOCK_CARD_TRANSACTION_REQUIRES_REVIEW").fill("Reviewed against fixture");
  await row.getByRole("button", { name: "Save row resolution" }).click(); await expect(page.getByText("Source row resolution saved.")).toBeVisible();
  await page.getByRole("button", { name: "Review commit" }).click(); await expect(page.getByRole("alertdialog")).toContainText("historical ledger"); await page.getByRole("alertdialog").getByRole("button", { name: "Confirm commit" }).click(); await expect(page.getByText("Import committed. Review the recorded result below.")).toBeVisible();
  await expect(page.getByText(/stock_card · committed/i)).toBeVisible();
});
