import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { runWithAudit } from "./audit";
import { createDb } from "./index";
import { user } from "./schema/auth";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for the database integration test.");
}

if (!new URL(databaseUrl).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database ending in _test.");
}

const db = createDb({ DATABASE_URL: databaseUrl });
const fixtureUserId = crypto.randomUUID();

afterAll(async () => {
  await db.delete(user).where(eq(user.id, fixtureUserId));
});

describe("runWithAudit", () => {
  test("rolls back the accompanying write when audit persistence fails", async () => {
    await expect(
      runWithAudit(
        db,
        {
          action: "test.audit_failure",
          // The database NOT NULL constraint intentionally makes the audit insert fail.
          targetType: undefined as unknown as string,
          targetId: fixtureUserId,
          correlationId: crypto.randomUUID(),
        },
        async (tx) => {
          await tx.insert(user).values({
            id: fixtureUserId,
            name: "Audit transaction fixture",
            email: `audit-${fixtureUserId}@example.test`,
          });
        },
      ),
    ).rejects.toThrow();

    const persistedUsers = await db.select({ id: user.id }).from(user).where(eq(user.id, fixtureUserId));
    expect(persistedUsers).toHaveLength(0);
  });
});
