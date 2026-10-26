import { defineRelationsPart } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const applicationRole = pgEnum("application_role", ["admin", "staff", "viewer"]);

/**
 * Application authorization data is deliberately separate from Better Auth's
 * credential tables. Deactivation preserves the account and historical actor
 * references while server checks refuse new work.
 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "restrict" }),
    role: applicationRole("role").notNull(),
    active: boolean("active").default(true).notNull(),
    mustChangePassword: boolean("must_change_password").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("user_profiles_active_role_idx").on(table.active, table.role)],
);

export const identityRelations = defineRelationsPart({ user, userProfiles }, (r) => ({
  userProfiles: {
    user: r.one.user({
      from: r.userProfiles.userId,
      to: r.user.id,
    }),
  },
  user: {
    profile: r.one.userProfiles({
      from: r.user.id,
      to: r.userProfiles.userId,
    }),
  },
}));

export type ApplicationRole = (typeof applicationRole.enumValues)[number];
