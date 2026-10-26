import type { Context as ApiContext } from "@matms/api/context";
import { session as authSession } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { and, eq } from "drizzle-orm";
import type { Context as HonoContext } from "hono";

import { db } from "./services";
import { auth } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const authSessionResult = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  let session: ApiContext["session"] = null;
  if (authSessionResult) {
    const [profile] = await db
      .select({
        role: userProfiles.role,
        active: userProfiles.active,
        mustChangePassword: userProfiles.mustChangePassword,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, authSessionResult.user.id))
      .limit(1);
    const reachedMaximumLifetime = Date.now() - authSessionResult.session.createdAt.valueOf() >= 12 * 60 * 60 * 1000;

    if (profile?.active && !reachedMaximumLifetime) {
      session = { ...authSessionResult, profile };
    } else {
      await db
        .delete(authSession)
        .where(and(eq(authSession.token, authSessionResult.session.token), eq(authSession.userId, authSessionResult.user.id)));
    }
  }

  return {
    db,
    session,
    correlationId: context.get("correlationId") ?? crypto.randomUUID(),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
