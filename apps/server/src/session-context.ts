import type { Context as ApiContext } from "@matms/api/context";
import type { createAuth } from "@matms/auth";
import type { Database } from "@matms/db";
import { session as authSession } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { and, eq } from "drizzle-orm";
import type { Context as HonoContext } from "hono";

export async function sessionContext(context: HonoContext, { db, auth, maxHours, idleMinutes }: { db: Database; auth: ReturnType<typeof createAuth>; maxHours: number; idleMinutes: number }): Promise<ApiContext> {
  let response = await auth.api.getSession({ headers: context.req.raw.headers, query: { disableRefresh: true }, returnHeaders: true });
  const initial = response.response;
  let session: ApiContext["session"] = null;
  if (initial) {
    const [profile] = await db.select({ role: userProfiles.role, active: userProfiles.active, mustChangePassword: userProfiles.mustChangePassword }).from(userProfiles).where(eq(userProfiles.userId, initial.user.id)).limit(1);
    const now = Date.now();
    const expired = now - initial.session.createdAt.valueOf() >= maxHours * 3_600_000 || now - initial.session.updatedAt.valueOf() >= idleMinutes * 60_000;
    if (profile?.active && !expired) {
      if (context.req.header("x-matms-server-render") !== "1") response = await auth.api.getSession({ headers: context.req.raw.headers, returnHeaders: true });
      if (response.response) {
        session = { ...response.response, profile };
        for (const cookie of response.headers.getSetCookie()) context.header("set-cookie", cookie, { append: true });
      }
    } else {
      await db.delete(authSession).where(and(eq(authSession.token, initial.session.token), eq(authSession.userId, initial.user.id)));
    }
  }
  return { db, session, correlationId: context.get("correlationId") ?? crypto.randomUUID() };
}
