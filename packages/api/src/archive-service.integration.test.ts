import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

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

import {
  createBox,
  createCategory,
  createDocument,
  createFolder,
  createLocation,
  getDocument,
  grantAccess,
  relocateBox,
  revokeAccess,
} from "./archive-service";

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
    const viewer = { id: viewerAccount.id, role: "viewer" as const };

    const category = await createCategory(db, admin, { code: `CAT-${suffix.slice(0, 8)}`, name: "Archive test category", correlationId: crypto.randomUUID() });
    fixture.categoryId = category.id;
    const location = await createLocation(db, admin, { code: `LOC-${suffix.slice(0, 8)}`, room: "Test room", shelf: "A", rack: "1", label: "Test room · A · 1", correlationId: crypto.randomUUID() });
    fixture.locationId = location.id;
    const destination = await createLocation(db, admin, { code: `DST-${suffix.slice(0, 8)}`, room: "Test room", shelf: "B", rack: "2", label: "Test room · B · 2", correlationId: crypto.randomUUID() });
    fixture.destinationId = destination.id;
    const box = await createBox(db, admin, { code: `BOX-${suffix.slice(0, 8)}`, categoryId: category.id, shelfLocationId: location.id, confidentiality: "restricted", correlationId: crypto.randomUUID() });
    fixture.boxId = box.id;
    const folder = await createFolder(db, admin, { boxId: box.id, code: `FOLDER-${suffix.slice(0, 8)}`, name: "Restricted folder", color: "red", confidentiality: "restricted", correlationId: crypto.randomUUID() });
    fixture.folderId = folder.id;
    const document = await createDocument(db, admin, { folderId: folder.id, code: `DOC-${suffix.slice(0, 8)}`, title: "Restricted document", confidentiality: "restricted", correlationId: crypto.randomUUID() });
    fixture.documentId = document.id;

    const boxGrant = await grantAccess(db, admin, { userId: staff.id, boxId: box.id, correlationId: crypto.randomUUID() });
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

    // Leave grants in place for the cleanup path to exercise restricted deletion ordering.
    expect(boxGrant.id).toBeTruthy();
    expect(folderGrant.id).toBeTruthy();
  });
});
