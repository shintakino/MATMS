import { createAuth } from "@matms/auth";
import { createDb } from "@matms/db";
import { schoolSettings } from "@matms/db/schema/settings";
import { eq } from "drizzle-orm";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
let configuredIdle = 30;
let configuredAuth = auth;
export async function getAuth() {
  const [policy] = await db.select({ idle: schoolSettings.sessionIdleMinutes, maximum: schoolSettings.sessionMaxHours }).from(schoolSettings).where(eq(schoolSettings.id, 1)).limit(1);
  const idle = policy?.idle ?? 30;
  if (configuredIdle !== idle) { configuredIdle = idle; configuredAuth = createAuth({ BETTER_AUTH_URL: ENV.BETTER_AUTH_URL, BETTER_AUTH_SECRET: ENV.BETTER_AUTH_SECRET, CORS_ORIGIN: ENV.CORS_ORIGIN, NODE_ENV: ENV.NODE_ENV, SESSION_IDLE_SECONDS: idle * 60 }, db); }
  return { auth: configuredAuth, maxHours: policy?.maximum ?? 12, idleMinutes: idle };
}
