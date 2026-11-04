import { expect, test } from "bun:test";

import { createDb } from "./index";
import { boxes, categories, documents, folders, shelfLocations } from "./schema/archive";
import { user } from "./schema/auth";
import { documentCheckouts, documentRequests, requestItems } from "./schema/custody";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to an isolated database ending in _test.");
}
const db = createDb({ DATABASE_URL: databaseUrl });

test("PostgreSQL permits at most one unresolved checkout for a document", async () => {
  const suffix = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const boxId = crypto.randomUUID();
  const folderId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const firstRequestId = crypto.randomUUID();
  const secondRequestId = crypto.randomUUID();
  const firstItemId = crypto.randomUUID();
  const secondItemId = crypto.randomUUID();

  await expect(db.transaction(async (tx) => {
    await tx.insert(user).values({ id: userId, name: "Custody fixture", email: `${suffix}@example.test` });
    await tx.insert(categories).values({ id: categoryId, code: suffix, normalizedCode: suffix, name: "Fixture" });
    await tx.insert(shelfLocations).values({ id: locationId, code: suffix, normalizedCode: suffix, room: "Fixture", shelf: "A", rack: "1", label: "Fixture" });
    await tx.insert(boxes).values({ id: boxId, code: suffix, normalizedCode: suffix, categoryId, shelfLocationId: locationId });
    await tx.insert(folders).values({ id: folderId, code: suffix, normalizedCode: suffix, name: "Fixture", boxId });
    await tx.insert(documents).values({ id: documentId, code: suffix, normalizedCode: suffix, title: "Fixture", folderId });
    await tx.insert(documentRequests).values([
      { id: firstRequestId, code: `A-${suffix}`, normalizedCode: `A-${suffix}`, requesterName: "Fixture", purpose: "Fixture", kind: "borrow", createdBy: userId },
      { id: secondRequestId, code: `B-${suffix}`, normalizedCode: `B-${suffix}`, requesterName: "Fixture", purpose: "Fixture", kind: "borrow", createdBy: userId },
    ]);
    await tx.insert(requestItems).values([
      { id: firstItemId, requestId: firstRequestId, documentId },
      { id: secondItemId, requestId: secondRequestId, documentId },
    ]);
    const releasedAt = new Date();
    const checkout = { documentId, homeFolderId: folderId, recipient: "Fixture", acknowledged: true, releasedBy: userId, releasedAt, dueAt: releasedAt };
    await tx.insert(documentCheckouts).values({ ...checkout, requestItemId: firstItemId });
    const duplicate = await tx.insert(documentCheckouts).values({ ...checkout, requestItemId: secondItemId }).onConflictDoNothing().returning({ id: documentCheckouts.id });
    expect(duplicate).toHaveLength(0);
    throw new Error("rollback fixture transaction");
  })).rejects.toThrow("rollback fixture transaction");
});
