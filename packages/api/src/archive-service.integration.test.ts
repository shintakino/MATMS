import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { provisionAccount } from "@matms/auth/provisioning";
import { createDb } from "@matms/db";
import {
  accessGrants,
  boxes,
  categories,
  documents,
  folders,
  movementEvents,
  shelfLocations,
} from "@matms/db/schema/archive";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { schoolSettings } from "@matms/db/schema/settings";

import {
  createBox,
  createCategory,
  createDocument,
  createFolder,
  createLocation,
  getDocument,
  getBox,
  grantAccess,
  relocateBox,
  revokeAccess,
  updateBoxCode,
  updateBoxDetails,
  updateFolder,
  updateDocument,
  updateCategory,
  updateLocation,
  setBoxLifecycle,
  setFolderLifecycle,
  setDocumentLifecycle,
  setReferenceActive,
  listBoxes,
  listDocuments,
} from "./archive-service";
import { listLabelBoxes, lookupBoxCode } from "./qr-service";
import { getSchoolSettings, listAudit, listActiveGrants, updateSchoolSettings } from "./admin-service";
import { writeAuditEntry } from "@matms/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for the archive integration test.");
if (!new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a database ending in _test.");

const db = createDb({ DATABASE_URL: databaseUrl });
const suffix = crypto.randomUUID();
const userIds: string[] = [];
const fixture = { categoryId: "", locationId: "", destinationId: "", boxId: "", folderId: "", documentId: "" };

afterAll(async () => {
  if (fixture.boxId) await db.delete(movementEvents).where(eq(movementEvents.boxId, fixture.boxId));
  if (fixture.documentId) await db.delete(accessGrants).where(eq(accessGrants.documentId, fixture.documentId));
  if (fixture.folderId) await db.delete(accessGrants).where(eq(accessGrants.folderId, fixture.folderId));
  if (fixture.boxId) await db.delete(accessGrants).where(eq(accessGrants.boxId, fixture.boxId));
  if (fixture.documentId) await db.delete(documents).where(eq(documents.id, fixture.documentId));
  if (fixture.folderId) await db.delete(folders).where(eq(folders.id, fixture.folderId));
  if (fixture.boxId) await db.delete(boxes).where(eq(boxes.id, fixture.boxId));
  if (fixture.categoryId) await db.delete(categories).where(eq(categories.id, fixture.categoryId));
  if (fixture.locationId) await db.delete(shelfLocations).where(eq(shelfLocations.id, fixture.locationId));
  if (fixture.destinationId) await db.delete(shelfLocations).where(eq(shelfLocations.id, fixture.destinationId));
  for (const userId of userIds) {
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
  }
});

describe("archive hierarchy and grants", () => {
  test("requires each restricted ancestor grant and preserves a single box movement event", async () => {
    const password = "archive test password that is long";
    const adminAccount = await provisionAccount(db, { name: "Archive Admin", email: `archive-admin-${suffix}@example.test`, password, role: "admin", actorId: null, correlationId: crypto.randomUUID(), mustChangePassword: false });
    const staffAccount = await provisionAccount(db, { name: "Archive Staff", email: `archive-staff-${suffix}@example.test`, password, role: "staff", actorId: adminAccount.id, correlationId: crypto.randomUUID(), mustChangePassword: false });
    const viewerAccount = await provisionAccount(db, { name: "Archive Viewer", email: `archive-viewer-${suffix}@example.test`, password, role: "viewer", actorId: adminAccount.id, correlationId: crypto.randomUUID(), mustChangePassword: false });
    userIds.push(adminAccount.id, staffAccount.id, viewerAccount.id);
    const admin = { id: adminAccount.id, role: "admin" as const };
    const staff = { id: staffAccount.id, role: "staff" as const };
    const custodian = { id: staffAccount.id, role: "property_custodian" as const };
    const viewer = { id: viewerAccount.id, role: "viewer" as const };

    const category = await createCategory(db, admin, { code: `CAT-${suffix.slice(0, 8)}`, name: "Archive test category", correlationId: crypto.randomUUID() });
    fixture.categoryId = category.id;
    const location = await createLocation(db, admin, { code: `LOC-${suffix.slice(0, 8)}`, room: "Test room", shelf: "A", rack: "1", label: "Test room · A · 1", correlationId: crypto.randomUUID() });
    fixture.locationId = location.id;
    const destination = await createLocation(db, admin, { code: `DST-${suffix.slice(0, 8)}`, room: "Test room", shelf: "B", rack: "2", label: "Test room · B · 2", correlationId: crypto.randomUUID() });
    fixture.destinationId = destination.id;
    const box = await createBox(db, admin, { code: `BOX-${suffix.slice(0, 8)}`, categoryId: category.id, shelfLocationId: location.id, confidentiality: "restricted", correlationId: crypto.randomUUID() });
    fixture.boxId = box.id;
    await expect(getBox(db, custodian, box.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const editBox = { boxId: box.id, categoryId: category.id, confidentiality: "restricted" as const, notes: "Updated box", correlationId: crypto.randomUUID() };
    await expect(updateBoxDetails(db, staff, editBox)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateBoxDetails(db, custodian, editBox)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateBoxDetails(db, admin, { ...editBox, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await getBox(db, admin, box.id)).notes).toBeNull();
    expect((await updateBoxDetails(db, admin, editBox)).notes).toBe("Updated box");
    const folder = await createFolder(db, admin, { boxId: box.id, code: `FOLDER-${suffix.slice(0, 8)}`, name: "Restricted folder", color: "red", confidentiality: "restricted", correlationId: crypto.randomUUID() });
    fixture.folderId = folder.id;
    const document = await createDocument(db, admin, { folderId: folder.id, code: `DOC-${suffix.slice(0, 8)}`, title: "Restricted document", confidentiality: "restricted", correlationId: crypto.randomUUID() });
    fixture.documentId = document.id;
    const editFolder = { id: folder.id, name: "Corrected folder", color: "red" as const, confidentiality: "restricted" as const, correlationId: crypto.randomUUID() };
    await expect(updateFolder(db, staff, editFolder)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await updateFolder(db, admin, editFolder)).name).toBe("Corrected folder");
    const editDocument = { id: document.id, title: "Corrected document", confidentiality: "restricted" as const, correlationId: crypto.randomUUID() };
    await expect(updateDocument(db, staff, editDocument)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(updateDocument(db, admin, { ...editDocument, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await getDocument(db, admin, document.id)).title).toBe(document.title);
    expect((await updateDocument(db, admin, editDocument)).title).toBe("Corrected document");

    expect((await listLabelBoxes(db, staff)).some((item) => item.id === box.id)).toBe(false);
    await expect(listLabelBoxes(db, viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(lookupBoxCode(db, staff, box.code)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await listLabelBoxes(db, admin)).find((item) => item.id === box.id)).toEqual({ id: box.id, code: box.code, categoryName: category.name, locationLabel: location.label });

    const boxGrant = await grantAccess(db, admin, { userId: staff.id, boxId: box.id, correlationId: crypto.randomUUID() });
    await expect(listActiveGrants(db, staff, 1)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect((await listActiveGrants(db, admin, 1)).rows.some((item) => item.id === boxGrant.id)).toBe(true);
    expect(await lookupBoxCode(db, staff, box.code.toLowerCase())).toEqual({ id: box.id });
    expect((await listLabelBoxes(db, staff)).some((item) => item.id === box.id)).toBe(true);
    const renamed = await updateBoxCode(db, admin, { boxId: box.id, code: `NEW-${suffix.slice(0, 8)}`, correlationId: crypto.randomUUID() });
    expect(renamed.id).toBe(box.id);
    expect(await lookupBoxCode(db, staff, renamed.code)).toEqual({ id: box.id });
    await expect(lookupBoxCode(db, staff, box.code)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(getDocument(db, staff, document.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const folderGrant = await grantAccess(db, admin, { userId: staff.id, folderId: folder.id, correlationId: crypto.randomUUID() });
    await expect(getDocument(db, staff, document.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const documentGrant = await grantAccess(db, admin, { userId: staff.id, documentId: document.id, correlationId: crypto.randomUUID() });
    expect((await getDocument(db, staff, document.id)).id).toBe(document.id);
    await revokeAccess(db, admin, { grantId: documentGrant.id, correlationId: crypto.randomUUID() });
    await expect(getDocument(db, staff, document.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });

    const beforeCount = await db.select({ id: documents.id }).from(documents).where(eq(documents.folderId, folder.id));
    await expect(createDocument(db, viewer, { folderId: folder.id, code: `VIEW-${suffix.slice(0, 8)}`, title: "Forbidden", confidentiality: "internal", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const afterCount = await db.select({ id: documents.id }).from(documents).where(eq(documents.folderId, folder.id));
    expect(afterCount).toHaveLength(beforeCount.length);

    await relocateBox(db, admin, { boxId: box.id, shelfLocationId: destination.id, reason: "Shelf reorganization", correlationId: crypto.randomUUID() });
    const moves = await db.select().from(movementEvents).where(eq(movementEvents.boxId, box.id));
    expect(moves).toHaveLength(1);
    expect(moves[0]?.source).toMatchObject({ code: location.code });
    expect(moves[0]?.destination).toMatchObject({ code: destination.code });

    await setBoxLifecycle(db, admin, { boxId: box.id, lifecycle: "archived", correlationId: crypto.randomUUID() });
    await expect(createFolder(db, admin, { boxId: box.id, code: `BLOCK-F-${suffix.slice(0, 8)}`, name: "Blocked", color: "red", confidentiality: "internal", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createDocument(db, admin, { folderId: folder.id, code: `BLOCK-D-${suffix.slice(0, 8)}`, title: "Blocked", confidentiality: "internal", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await setBoxLifecycle(db, admin, { boxId: box.id, lifecycle: "active", correlationId: crypto.randomUUID() });
    await expect(setDocumentLifecycle(db, viewer, { documentId: document.id, lifecycle: "retired", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setFolderLifecycle(db, admin, { folderId: folder.id, lifecycle: "retired", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setDocumentLifecycle(db, admin, { documentId: document.id, lifecycle: "retired", correlationId: null as unknown as string })).rejects.toThrow();
    expect((await getDocument(db, admin, document.id)).lifecycle).toBe("active");
    await setDocumentLifecycle(db, admin, { documentId: document.id, lifecycle: "retired", correlationId: crypto.randomUUID() });
    expect((await listDocuments(db, admin)).some((item) => item.id === document.id)).toBe(false);
    await setFolderLifecycle(db, admin, { folderId: folder.id, lifecycle: "retired", correlationId: crypto.randomUUID() });
    await setBoxLifecycle(db, admin, { boxId: box.id, lifecycle: "retired", correlationId: crypto.randomUUID() });
    await expect(updateBoxCode(db, admin, { boxId: box.id, code: `RETIRED-${suffix.slice(0, 8)}`, correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await listBoxes(db, admin)).some((item) => item.id === box.id)).toBe(false);
    await setBoxLifecycle(db, admin, { boxId: box.id, lifecycle: "active", correlationId: crypto.randomUUID() });
    await setFolderLifecycle(db, admin, { folderId: folder.id, lifecycle: "active", correlationId: crypto.randomUUID() });
    await setDocumentLifecycle(db, admin, { documentId: document.id, lifecycle: "active", correlationId: crypto.randomUUID() });

    const action = `test.audit.${suffix}`;
    await db.transaction((tx) => writeAuditEntry(tx, { actorId: admin.id, action, targetType: "test", targetId: suffix, correlationId: crypto.randomUUID(), after: { safe: "visible", password: "private", nested: { token: "private" } } }));
    await expect(listAudit(db, staff, { filters: {}, page: 1, pageSize: 25 })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(listAudit(db, viewer, { filters: {}, page: 1, pageSize: 25 })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const events = await listAudit(db, admin, { filters: { action }, page: 1, pageSize: 25 });
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.actorId).toBe(admin.id);
    expect(events.rows[0]?.after).toEqual({ safe: "visible", nested: {} });
    await expect(setReferenceActive(db, staff, { kind: "category", id: category.id, active: false, correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setReferenceActive(db, admin, { kind: "category", id: category.id, active: false, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await db.select().from(categories).where(eq(categories.id, category.id)))[0]?.active).toBe(true);
    await setReferenceActive(db, admin, { kind: "category", id: category.id, active: false, correlationId: crypto.randomUUID() });
    await expect(createBox(db, admin, { code: `BLOCK-B-${suffix.slice(0, 8)}`, categoryId: category.id, shelfLocationId: location.id, confidentiality: "internal", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await setReferenceActive(db, admin, { kind: "category", id: category.id, active: true, correlationId: crypto.randomUUID() });

    const categoryEdit = { id: category.id, code: `EDIT-CAT-${suffix.slice(0, 8)}`, name: "Edited category", correlationId: crypto.randomUUID() };
    await expect(updateCategory(db, staff, categoryEdit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateCategory(db, admin, { ...categoryEdit, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await db.select().from(categories).where(eq(categories.id, category.id)))[0]?.name).toBe(category.name);
    await updateCategory(db, admin, categoryEdit);
    const locationEdit = { id: destination.id, code: destination.code, room: "Updated room", shelf: "B", rack: "2", position: "Top", label: "Updated shelf", correlationId: crypto.randomUUID() };
    await expect(updateLocation(db, viewer, locationEdit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateLocation(db, admin, { ...locationEdit, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await db.select().from(shelfLocations).where(eq(shelfLocations.id, destination.id)))[0]?.label).toBe(destination.label);
    await updateLocation(db, admin, locationEdit);
    const updatedBox = await getBox(db, admin, box.id);
    expect(updatedBox.categoryName).toBe(categoryEdit.name);
    expect(updatedBox.location.label).toBe(locationEdit.label);
    const history = await db.select().from(movementEvents).where(eq(movementEvents.boxId, box.id));
    expect(history[0]?.destination).toMatchObject({ label: destination.label });
    const categoryAudit = await listAudit(db, admin, { filters: { action: "archive.category_updated" }, page: 1, pageSize: 100 });
    expect(categoryAudit.rows.some((entry) => entry.targetId === category.id && JSON.stringify(entry.after).includes(categoryEdit.name))).toBe(true);
    await Promise.all([
      relocateBox(db, admin, { boxId: box.id, shelfLocationId: location.id, reason: "Concurrent move A", correlationId: crypto.randomUUID() }),
      relocateBox(db, admin, { boxId: box.id, shelfLocationId: destination.id, reason: "Concurrent move B", correlationId: crypto.randomUUID() }),
    ]);
    const concurrentMoves = await db.select().from(movementEvents).where(eq(movementEvents.boxId, box.id));
    const finalBox = await getBox(db, admin, box.id);
    const finalReason = finalBox.shelfLocationId === destination.id ? "Concurrent move B" : "Concurrent move A";
    const finalMovement = concurrentMoves.find((entry) => entry.reason === finalReason);
    expect(finalMovement?.source).toMatchObject({ code: finalBox.shelfLocationId === destination.id ? location.code : destination.code });

    await revokeAccess(db, admin, { grantId: boxGrant.id, correlationId: crypto.randomUUID() });
    expect((await listLabelBoxes(db, staff)).some((item) => item.id === box.id)).toBe(false);
    await expect(lookupBoxCode(db, staff, renamed.code)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    // Leave the folder grant in place for the restricted cleanup path.
    expect(folderGrant.id).toBeTruthy();
  });
});

test("settings require an administrator, a valid origin, a redirect plan, and an audit commit", async () => {
  const admin = { id: `settings-test-${suffix}`, role: "admin" as const };
  const viewer = { id: `settings-viewer-${suffix}`, role: "viewer" as const };
  const existing = await db.select().from(schoolSettings).where(eq(schoolSettings.id, 1)).limit(1);
  const before = await getSchoolSettings(db);
  const name = `Settings test ${suffix}`;
  const input = { schoolName: name, timezone: "Asia/Manila" as const, canonicalOrigin: "https://school.example.test", correlationId: crypto.randomUUID() };
  await expect(updateSchoolSettings(db, viewer, input)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  await expect(updateSchoolSettings(db, admin, { ...input, canonicalOrigin: "http://school.example.test" })).rejects.toMatchObject({ data: { code: "VALIDATION_ERROR" } });
  await expect(updateSchoolSettings(db, admin, { ...input, sessionIdleMinutes: 120, sessionMaxHours: 1, redirectPlan: "Test plan" })).rejects.toMatchObject({ data: { code: "VALIDATION_ERROR" } });
  if (before.canonicalOrigin !== input.canonicalOrigin) await expect(updateSchoolSettings(db, admin, input)).rejects.toMatchObject({ data: { code: "VALIDATION_ERROR" } });
  await expect(updateSchoolSettings(db, admin, { ...input, redirectPlan: "Redirect and verify old labels", correlationId: null as unknown as string })).rejects.toThrow();
  expect(await getSchoolSettings(db)).toEqual(before);
  if (existing.length === 0) {
    try {
      const result = await updateSchoolSettings(db, admin, { ...input, sessionIdleMinutes: 45, sessionMaxHours: 10, redirectPlan: "Redirect and verify old labels" });
      expect(result.canonicalOrigin).toBe(input.canonicalOrigin);
      expect(result.sessionIdleMinutes).toBe(45);
      expect(result.sessionMaxHours).toBe(10);
      expect((await getSchoolSettings(db)).schoolName).toBe(name);
    } finally {
      await db.delete(schoolSettings).where(and(eq(schoolSettings.id, 1), eq(schoolSettings.schoolName, name)));
    }
  }
}, 30000);
