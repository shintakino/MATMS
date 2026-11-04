import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createDb } from "@matms/db";
import { auditLogs } from "@matms/db/schema/audit";
import { account, session, user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { createAuth } from "./index";

import {
  IdentityServiceError,
  bootstrapFirstAdmin,
  provisionAccount,
  setAccountActive,
  resetAccountPassword,
  changeOwnPassword,
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

    const auth = createAuth({ BETTER_AUTH_URL: "http://localhost:3001", BETTER_AUTH_SECRET: "session-test-secret-with-at-least-32-characters", CORS_ORIGIN: "http://localhost:3001", NODE_ENV: "test" }, db);
    const signIn = await auth.handler(new Request("http://localhost:3001/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3001" }, body: JSON.stringify({ email: firstAdmin.email, password }) }));
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
    expect(cookie).toContain("session_token=");
    const oldExpiry = new Date(Date.now() + 20 * 60 * 1000);
    await db.update(session).set({ expiresAt: oldExpiry }).where(eq(session.userId, firstAdmin.id));
    const requestHeaders = new Headers({ cookie });
    const serverRead = await auth.api.getSession({ headers: requestHeaders, query: { disableRefresh: true }, returnHeaders: true });
    expect(serverRead.response?.user.id).toBe(firstAdmin.id);
    expect(serverRead.headers.getSetCookie()).toHaveLength(0);
    expect((await db.select().from(session).where(eq(session.userId, firstAdmin.id)))[0]?.expiresAt.valueOf()).toBe(oldExpiry.valueOf());
    const browserRead = await auth.api.getSession({ headers: requestHeaders, returnHeaders: true });
    expect(browserRead.response?.user.id).toBe(firstAdmin.id);
    expect(browserRead.headers.getSetCookie().some((entry) => entry.includes("session_token="))).toBe(true);
    expect((await db.select().from(session).where(eq(session.userId, firstAdmin.id)))[0]!.expiresAt.valueOf()).toBeGreaterThan(oldExpiry.valueOf());

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

    await db.insert(session).values({ id: crypto.randomUUID(), userId: firstAdmin.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date() });

    await setAccountActive(db, {
      actorId: secondAdmin.id,
      userId: firstAdmin.id,
      active: false,
      correlationId: crypto.randomUUID(),
    });

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, firstAdmin.id));
    expect(profile?.active).toBe(false);
    expect(await db.select().from(session).where(eq(session.userId, firstAdmin.id))).toHaveLength(0);
    expect((await db.select().from(user).where(eq(user.id, firstAdmin.id)))[0]?.name).toBe("First Test Administrator");

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
    const temporaryPassword = "a temporary fixture password";
    const [beforeReset] = await db.select().from(account).where(eq(account.userId, secondAdmin.id));
    await db.insert(session).values({ id: crypto.randomUUID(), userId: secondAdmin.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date() });
    await expect(resetAccountPassword(db, { actorId: secondAdmin.id, userId: secondAdmin.id, password: temporaryPassword, correlationId: null as unknown as string })).rejects.toThrow();
    expect((await db.select().from(account).where(eq(account.userId, secondAdmin.id)))[0]?.password).toBe(beforeReset?.password);
    expect(await db.select().from(session).where(eq(session.userId, secondAdmin.id))).toHaveLength(1);
    await resetAccountPassword(db, { actorId: secondAdmin.id, userId: secondAdmin.id, password: temporaryPassword, correlationId: crypto.randomUUID() });
    expect(await db.select().from(session).where(eq(session.userId, secondAdmin.id))).toHaveLength(0);
    expect((await db.select().from(userProfiles).where(eq(userProfiles.userId, secondAdmin.id)))[0]?.mustChangePassword).toBe(true);
    await expect(changeOwnPassword(db, { userId: secondAdmin.id, currentPassword: password, newPassword: "a new fixture password", correlationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await changeOwnPassword(db, { userId: secondAdmin.id, currentPassword: temporaryPassword, newPassword: "a new fixture password", correlationId: crypto.randomUUID() });
    expect((await db.select().from(userProfiles).where(eq(userProfiles.userId, secondAdmin.id)))[0]?.mustChangePassword).toBe(false);
  });
});
