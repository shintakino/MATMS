import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createAuth } from "@matms/auth";
import { provisionAccount } from "@matms/auth/provisioning";
import { createDb } from "@matms/db";
import { session, user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { eq } from "drizzle-orm";
import { sessionContext } from "./session-context";

test("HTTP renewals send cookies; server reads and expired policies cannot renew", async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("An isolated TEST_DATABASE_URL is required.");
  const db = createDb({ DATABASE_URL: url });
  const email = `session-${crypto.randomUUID()}@example.test`; const password = "fictional session fixture password";
  const account = await provisionAccount(db, { name: "Session fixture", email, password, role: "staff", actorId: null, mustChangePassword: false, correlationId: crypto.randomUUID() });
  const auth = createAuth({ BETTER_AUTH_URL: "http://localhost:3101", CORS_ORIGIN: "http://localhost:3101", BETTER_AUTH_SECRET: "a-long-session-fixture-secret-at-least-32", NODE_ENV: "test" }, db);
  const app = new Hono();
  app.get("/identity", async (context) => { const result = await sessionContext(context, { db, auth, idleMinutes: 30, maxHours: 12 }); return context.json({ authenticated: !!result.session }, result.session ? 200 : 401); });
  async function signIn() {
    const result = await auth.handler(new Request("http://localhost:3101/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3101" }, body: JSON.stringify({ email, password }) }));
    expect(result.status).toBe(200); return result.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  }
  try {
    let cookie = await signIn();
    await db.update(session).set({ expiresAt: new Date(Date.now() + 20 * 60_000) }).where(eq(session.userId, account.id));
    const server = await app.request("/identity", { headers: { cookie, "x-matms-server-render": "1" } });
    expect(server.status).toBe(200); expect(server.headers.getSetCookie()).toHaveLength(0);
    const browser = await app.request("/identity", { headers: { cookie } });
    expect(browser.status).toBe(200); expect(browser.headers.getSetCookie().some((value) => value.includes("session_token="))).toBe(true);
    await db.update(session).set({ updatedAt: new Date(Date.now() - 31 * 60_000) }).where(eq(session.userId, account.id));
    expect((await app.request("/identity", { headers: { cookie } })).status).toBe(401);
    expect(await db.select().from(session).where(eq(session.userId, account.id))).toHaveLength(0);
    cookie = await signIn(); await db.update(session).set({ createdAt: new Date(Date.now() - 13 * 3_600_000) }).where(eq(session.userId, account.id));
    expect((await app.request("/identity", { headers: { cookie } })).status).toBe(401);
  } finally {
    await db.delete(session).where(eq(session.userId, account.id)); await db.delete(userProfiles).where(eq(userProfiles.userId, account.id)); await db.delete(user).where(eq(user.id, account.id)); await db.$client.end();
  }
});
