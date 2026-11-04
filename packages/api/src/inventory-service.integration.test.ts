import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { provisionAccount } from "@matms/auth/provisioning";
import { createDb } from "@matms/db";
import { boxes, categories, folders, shelfLocations } from "@matms/db/schema/archive";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { stockOperations, stockTransactions, templateInventory, templates } from "@matms/db/schema/inventory";

import { createBox, createCategory, createFolder, createLocation, setBoxLifecycle } from "./archive-service";
import { InventoryServiceError, createInventoryLine, createTemplate, correctStock, issueStock, receiveStock, transferStock, updateTemplate, setTemplateStatus, listTemplates, updateThreshold } from "./inventory-service";
import { queryReport } from "./reporting-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for the inventory integration test.");
if (!new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a database ending in _test.");

const db = createDb({ DATABASE_URL: databaseUrl });
const suffix = crypto.randomUUID();
const ids = { category: "", locationA: "", locationB: "", boxA: "", boxB: "", folderA: "", folderB: "", template: "", nextTemplate: "", inventoryA: "", inventoryB: "" };
const users: string[] = [];

afterAll(async () => {
  await db.delete(stockTransactions).where(eq(stockTransactions.inventoryId, ids.inventoryA));
  await db.delete(stockTransactions).where(eq(stockTransactions.inventoryId, ids.inventoryB));
  for (const userId of users) await db.delete(stockOperations).where(eq(stockOperations.actorId, userId));
  if (ids.inventoryA) await db.delete(templateInventory).where(eq(templateInventory.id, ids.inventoryA));
  if (ids.inventoryB) await db.delete(templateInventory).where(eq(templateInventory.id, ids.inventoryB));
  if (ids.nextTemplate) await db.delete(templates).where(eq(templates.id, ids.nextTemplate));
  if (ids.template) await db.delete(templates).where(eq(templates.id, ids.template));
  if (ids.folderA) await db.delete(folders).where(eq(folders.id, ids.folderA));
  if (ids.folderB) await db.delete(folders).where(eq(folders.id, ids.folderB));
  if (ids.boxA) await db.delete(boxes).where(eq(boxes.id, ids.boxA));
  if (ids.boxB) await db.delete(boxes).where(eq(boxes.id, ids.boxB));
  if (ids.locationA) await db.delete(shelfLocations).where(eq(shelfLocations.id, ids.locationA));
  if (ids.locationB) await db.delete(shelfLocations).where(eq(shelfLocations.id, ids.locationB));
  if (ids.category) await db.delete(categories).where(eq(categories.id, ids.category));
  for (const userId of users) { await db.delete(userProfiles).where(eq(userProfiles.userId, userId)); await db.delete(user).where(eq(user.id, userId)); }
});

describe("template inventory", () => {
  test("keeps balances and an immutable ledger correct across retries, concurrent issue, transfer, and stale correction", async () => {
    const password = "inventory test password that is long";
    const adminAccount = await provisionAccount(db, { name: "Inventory Admin", email: `inventory-admin-${suffix}@example.test`, password, role: "admin", actorId: null, correlationId: crypto.randomUUID(), mustChangePassword: false });
    const staffAccount = await provisionAccount(db, { name: "Inventory Staff", email: `inventory-staff-${suffix}@example.test`, password, role: "staff", actorId: adminAccount.id, correlationId: crypto.randomUUID(), mustChangePassword: false });
    users.push(adminAccount.id, staffAccount.id);
    const admin = { id: adminAccount.id, role: "admin" as const };
    const staff = { id: staffAccount.id, role: "staff" as const };
    const short = suffix.slice(0, 8);
    const category = await createCategory(db, admin, { code: `INV-CAT-${short}`, name: "Inventory category", correlationId: crypto.randomUUID() }); ids.category = category.id;
    const locationA = await createLocation(db, admin, { code: `INV-A-${short}`, room: "Inventory", shelf: "A", rack: "1", label: "Inventory A", correlationId: crypto.randomUUID() }); ids.locationA = locationA.id;
    const locationB = await createLocation(db, admin, { code: `INV-B-${short}`, room: "Inventory", shelf: "B", rack: "2", label: "Inventory B", correlationId: crypto.randomUUID() }); ids.locationB = locationB.id;
    const boxA = await createBox(db, admin, { code: `INV-BOX-A-${short}`, categoryId: category.id, shelfLocationId: locationA.id, confidentiality: "internal", correlationId: crypto.randomUUID() }); ids.boxA = boxA.id;
    const boxB = await createBox(db, admin, { code: `INV-BOX-B-${short}`, categoryId: category.id, shelfLocationId: locationB.id, confidentiality: "internal", correlationId: crypto.randomUUID() }); ids.boxB = boxB.id;
    const folderA = await createFolder(db, admin, { boxId: boxA.id, code: `INV-FOLDER-A-${short}`, name: "Inventory A", color: "blue", confidentiality: "internal", isTemplateFolder: true, correlationId: crypto.randomUUID() }); ids.folderA = folderA.id;
    const folderB = await createFolder(db, admin, { boxId: boxB.id, code: `INV-FOLDER-B-${short}`, name: "Inventory B", color: "blue", confidentiality: "internal", isTemplateFolder: true, correlationId: crypto.randomUUID() }); ids.folderB = folderB.id;
    const template = await createTemplate(db, admin, { code: `FORM-${short}`, familyCode: `FORM-FAMILY-${short}`, name: "Test form", categoryId: category.id, revisionLabel: "v1", digitalUrl: "https://example.test/forms/v1", correlationId: crypto.randomUUID() }); ids.template = template.id;
    const lineA = await createInventoryLine(db, admin, { templateId: template.id, folderId: folderA.id, threshold: 5, correlationId: crypto.randomUUID() }); ids.inventoryA = lineA.id;
    const lineB = await createInventoryLine(db, admin, { templateId: template.id, folderId: folderB.id, threshold: 5, correlationId: crypto.randomUUID() }); ids.inventoryB = lineB.id;
    expect((await listTemplates(db, staff)).some((item) => item.id === template.id)).toBe(true);
    await db.update(boxes).set({ confidentiality: "restricted" }).where(eq(boxes.id, boxA.id));
    await db.update(boxes).set({ confidentiality: "restricted" }).where(eq(boxes.id, boxB.id));
    expect((await listTemplates(db, staff)).some((item) => item.id === template.id)).toBe(false);
    expect((await queryReport(db, staff, "search", { kind: "inventory", categoryId: category.id }, 1, 1)).rows).toHaveLength(0);
    expect((await listTemplates(db, admin)).some((item) => item.id === template.id)).toBe(true);
    await db.update(boxes).set({ confidentiality: "internal" }).where(eq(boxes.id, boxA.id));
    await db.update(boxes).set({ confidentiality: "internal" }).where(eq(boxes.id, boxB.id));
    const pageA = await queryReport(db, staff, "search", { kind: "inventory", categoryId: category.id }, 1, 1);
    const pageB = await queryReport(db, staff, "search", { kind: "inventory", categoryId: category.id }, 2, 1);
    expect(pageA.rows).toHaveLength(1); expect(pageB.rows).toHaveLength(1); expect(pageA.rows[0]?.id).not.toBe(pageB.rows[0]?.id);
    await expect(updateThreshold(db, staff, { inventoryId: lineA.id, threshold: 8, correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateThreshold(db, admin, { inventoryId: lineA.id, threshold: 8, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await updateThreshold(db, admin, { inventoryId: lineA.id, threshold: 8, correlationId: crypto.randomUUID() })).threshold).toBe(8);

    const edit = { id: template.id, name: "Updated form", digitalUrl: "https://example.test/forms/corrected", correlationId: crypto.randomUUID() };
    await expect(updateTemplate(db, staff, edit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateTemplate(db, admin, { ...edit, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await db.select().from(templates).where(eq(templates.id, template.id)))[0]?.name).toBe("Test form");
    expect((await updateTemplate(db, admin, edit)).name).toBe("Updated form");

    const receiveOperation = crypto.randomUUID();
    await receiveStock(db, staff, { inventoryId: lineA.id, quantity: 6, reason: "Opening count", operationId: receiveOperation, correlationId: crypto.randomUUID() });
    await expect(updateTemplate(db, admin, { ...edit, revisionLabel: "changed identity" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setTemplateStatus(db, admin, { id: template.id, status: "retired", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setTemplateStatus(db, staff, { id: template.id, status: "superseded", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const retry = await receiveStock(db, staff, { inventoryId: lineA.id, quantity: 6, reason: "Opening count", operationId: receiveOperation, correlationId: crypto.randomUUID() });
    expect(retry.balances[0]?.count).toBe(6);
    await expect(receiveStock(db, staff, { inventoryId: lineA.id, quantity: 5, reason: "Different payload", operationId: receiveOperation, correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" satisfies InventoryServiceError["code"] });

    const issued = await issueStock(db, staff, { inventoryId: lineA.id, quantity: 2, reason: "Office request", reference: "REQ-1", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() });
    expect(issued.balances[0]?.count).toBe(4);
    const ledgerAfterIssue = await db.select().from(stockTransactions).where(eq(stockTransactions.inventoryId, lineA.id));
    expect(ledgerAfterIssue).toHaveLength(2);
    expect(ledgerAfterIssue[1]?.balanceAfter).toBe(4);

    await receiveStock(db, staff, { inventoryId: lineA.id, quantity: 1, reason: "Top up", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() });
    const concurrent = await Promise.allSettled([issueStock(db, staff, { inventoryId: lineA.id, quantity: 4, reason: "Concurrent issue A", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() }), issueStock(db, staff, { inventoryId: lineA.id, quantity: 4, reason: "Concurrent issue B", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() })]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [afterConcurrent] = await db.select().from(templateInventory).where(eq(templateInventory.id, lineA.id));
    expect(afterConcurrent?.count).toBe(1);

    const transfer = await transferStock(db, staff, { sourceInventoryId: lineA.id, destinationInventoryId: lineB.id, quantity: 1, reason: "Move forms", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() });
    expect(transfer.balances.map((balance) => balance.count).sort()).toEqual([0, 1]);
    const staleVersion = transfer.balances.find((balance) => balance.inventoryId === lineB.id)!.version;
    await receiveStock(db, staff, { inventoryId: lineB.id, quantity: 1, reason: "More forms", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() });
    await expect(correctStock(db, admin, { inventoryId: lineB.id, count: 7, expectedVersion: staleVersion, reason: "Verified count", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" satisfies InventoryServiceError["code"] });

    const archiveRace = await Promise.allSettled([
      setBoxLifecycle(db, admin, { boxId: boxA.id, lifecycle: "archived", correlationId: crypto.randomUUID() }),
      receiveStock(db, staff, { inventoryId: lineA.id, quantity: 1, reason: "Concurrent receipt", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() }),
    ]);
    expect(archiveRace[0]?.status).toBe("fulfilled");
    const [raceBalance] = await db.select().from(templateInventory).where(eq(templateInventory.id, lineA.id));
    expect(raceBalance?.count).toBe(archiveRace[1]?.status === "fulfilled" ? 1 : 0);
    await expect(receiveStock(db, staff, { inventoryId: lineA.id, quantity: 1, reason: "After archival", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await setBoxLifecycle(db, admin, { boxId: boxA.id, lifecycle: "active", correlationId: crypto.randomUUID() });
    if (raceBalance?.count) await issueStock(db, staff, { inventoryId: lineA.id, quantity: 1, reason: "Resolve fixture", operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() });

    await db.update(folders).set({ lifecycle: "archived" }).where(eq(folders.id, folderA.id));
    expect((await setBoxLifecycle(db, admin, { boxId: boxA.id, lifecycle: "retired", correlationId: crypto.randomUUID() })).lifecycle).toBe("retired");
    await db.update(folders).set({ lifecycle: "archived" }).where(eq(folders.id, folderB.id));
    await expect(setBoxLifecycle(db, admin, { boxId: boxB.id, lifecycle: "retired", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    const replacement = { code: `FORM-V2-${short}`, familyCode: template.familyCode, name: "Replacement test form", categoryId: category.id, revisionLabel: "v2", digitalUrl: "https://example.test/forms/v2", supersedesId: template.id, correlationId: crypto.randomUUID() };
    await expect(createTemplate(db, admin, { ...replacement, familyCode: "UNRELATED" })).rejects.toMatchObject({ code: "CONFLICT" });
    ids.nextTemplate = (await createTemplate(db, admin, replacement)).id;
    expect((await db.select().from(templates).where(eq(templates.id, template.id)))[0]?.status).toBe("superseded");
  });
});
