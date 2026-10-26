import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@matms/db";
import * as schema from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  NODE_ENV: "development" | "production" | "test";
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: {
      enabled: true,
      // Accounts are provisioned transactionally by the MATMS identity service.
      disableSignUp: true,
    },
    // A session expires after 30 minutes without a refresh. Every active
    // procedure additionally enforces the 12-hour absolute lifetime.
    session: {
      expiresIn: 30 * 60,
      updateAge: 60,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (newSession) => {
            const [profile] = await database
              .select({ active: userProfiles.active })
              .from(userProfiles)
              .where(eq(userProfiles.userId, newSession.userId))
              .limit(1);

            // An account without an application profile is not a MATMS account.
            return profile?.active === true;
          },
        },
      },
    },
    plugins: [],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
