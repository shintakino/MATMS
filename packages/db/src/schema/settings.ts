import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** One school; secrets and service credentials remain in deployment configuration. */
export const schoolSettings = pgTable("school_settings", {
  id: integer("id").primaryKey().default(1),
  schoolName: text("school_name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  canonicalOrigin: text("canonical_origin"),
  sessionIdleMinutes: integer("session_idle_minutes").notNull().default(30),
  sessionMaxHours: integer("session_max_hours").notNull().default(12),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("school_settings_singleton", sql`${table.id} = 1`), check("school_settings_session_policy", sql`${table.sessionIdleMinutes} BETWEEN 5 AND 120 AND ${table.sessionMaxHours} BETWEEN 1 AND 24 AND ${table.sessionIdleMinutes} <= ${table.sessionMaxHours} * 60`)]);
