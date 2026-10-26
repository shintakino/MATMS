import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createDb } from "@matms/db";
import { auditLogs } from "@matms/db/schema/audit";
import { account, user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";

import {
  IdentityServiceError,
  bootstrapFirstAdmin,
  provisionAccount,
  setAccountActive,
} from "./provisioning";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for the identity integration test.");
}

if (!new URL(databaseUrl).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database ending in _test.");
}

const db = createDb({ DATABASE_URL: databaseUrl });
const fixtureSuffix = crypto.randomUUID();
const fixtureUserIds: string[] = [];

afterAll(async () => {
  for (const userId of fixtureUserIds) {
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
    await db.delete(auditLogs).where(eq(auditLogs.targetId, userId));
  }
});

describe("identity provisioning", () => {
  test("bootstraps once, records the audit event, and protects the final active Administrator", async () => {
    const password = "a long test-only password";
    const firstAdmin = await bootstrapFirstAdmin(db, {
      name: "First Test Administrator",
      email: `first-admin-${fixtureSuffix}@example.test`,
      password,
      correlationId: crypto.randomUUID(),
      mustChangePassword: false,
    });
    fixtureUserIds.push(firstAdmin.id);

    await expect(
      bootstrapFirstAdmin(db, {
        name: "Second Test Administrator",
        email: `second-admin-${fixtureSuffix}@example.test`,
        password,
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BOOTSTRAP_COMPLETE" satisfies IdentityServiceError["code"] });

    await expect(
      setAccountActive(db, {
        actorId: firstAdmin.id,
        userId: firstAdmin.id,
        active: false,
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" satisfies IdentityServiceError["code"] });

    const secondAdmin = await provisionAccount(db, {
      name: "Second Test Administrator",
      email: `second-admin-${fixtureSuffix}@example.test`,
      password,
      role: "admin",
      actorId: firstAdmin.id,
      correlationId: crypto.randomUUID(),
    });
    fixtureUserIds.push(secondAdmin.id);

    await setAccountActive(db, {
      actorId: secondAdmin.id,
      userId: firstAdmin.id,
      active: false,
      correlationId: crypto.randomUUID(),
    });

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, firstAdmin.id));
    expect(profile?.active).toBe(false);

    const audit = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, firstAdmin.id), eq(auditLogs.action, "identity.account_deactivated")));
    expect(audit).toHaveLength(1);

    const [credential] = await db
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, firstAdmin.id));
    expect(credential?.password).not.toBe(password);
  });
});
