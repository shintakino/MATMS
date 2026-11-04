import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { custodialLots } from "./custodial-inventory";

export const employmentCategory = pgEnum("employment_category", ["teacher", "personnel"]);
export const bookingStatus = pgEnum("booking_status", ["pending", "approved", "rejected", "cancelled"]);
export const bookableKind = pgEnum("bookable_kind", ["equipment", "facility"]);

export const schedulingPolicy = pgTable("scheduling_policy", {
  id: integer("id").primaryKey().default(1),
  leaveEnabled: boolean("leave_enabled").notNull().default(false),
  publicLeave: boolean("public_leave").notNull().default(false),
  teacherLimit: integer("teacher_limit"),
  personnelLimit: integer("personnel_limit"),
  version: integer("version").notNull().default(0),
}, (t) => [check("scheduling_policy_singleton", sql`${t.id} = 1`), check("scheduling_policy_limits", sql`(${t.teacherLimit} IS NULL OR ${t.teacherLimit} >= 0) AND (${t.personnelLimit} IS NULL OR ${t.personnelLimit} >= 0)`)]);

export const employmentAssignments = pgTable("employment_assignments", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  category: employmentCategory("category").notNull(),
  active: boolean("active").notNull().default(true),
});

export const bookableResources = pgTable("bookable_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  kind: bookableKind("kind").notNull(),
  lotId: uuid("lot_id").references(() => custodialLots.id, { onDelete: "restrict" }),
  publicDescription: text("public_description").notNull().default(""),
  published: boolean("published").notNull().default(false),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(0),
}, (t) => [uniqueIndex("bookable_resource_name_unique").on(t.normalizedName), check("bookable_resource_link", sql`(${t.kind} = 'equipment' AND ${t.lotId} IS NOT NULL) OR (${t.kind} = 'facility' AND ${t.lotId} IS NULL)`), check("bookable_resource_name_nonempty", sql`length(trim(${t.name})) > 0`)]);

export const leaveClosures = pgTable("leave_closures", {
  day: date("day").primaryKey(),
  label: text("label").notNull(),
});

export const leaveBookings = pgTable("leave_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterId: text("requester_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  category: employmentCategory("category").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason").notNull(),
  status: bookingStatus("status").notNull().default("pending"),
  decisionNote: text("decision_note"),
  decidedBy: text("decided_by").references(() => user.id, { onDelete: "restrict" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  version: integer("version").notNull().default(0),
  operationId: uuid("operation_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("leave_booking_operation_unique").on(t.operationId), index("leave_booking_dates_idx").on(t.startDate, t.endDate, t.status), check("leave_booking_dates", sql`${t.endDate} >= ${t.startDate} AND ${t.endDate} - ${t.startDate} < 366`), check("leave_booking_reason", sql`length(trim(${t.reason})) > 0`)]);

export const resourceBookings = pgTable("resource_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => bookableResources.id, { onDelete: "restrict" }),
  requesterId: text("requester_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  purpose: text("purpose").notNull(),
  status: bookingStatus("status").notNull().default("pending"),
  decisionNote: text("decision_note"),
  decidedBy: text("decided_by").references(() => user.id, { onDelete: "restrict" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  version: integer("version").notNull().default(0),
  operationId: uuid("operation_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("resource_booking_operation_unique").on(t.operationId), index("resource_booking_range_idx").on(t.resourceId, t.startDate, t.endDate, t.status), check("resource_booking_interval", sql`${t.endDate} >= ${t.startDate} AND ${t.endDate} - ${t.startDate} < 366`), check("resource_booking_purpose", sql`length(trim(${t.purpose})) > 0`)]);

/** Creation fingerprints stay fixed; every edit has its own durable receipt. */
export const schedulingEditReplays = pgTable("scheduling_edit_replays", {
  operationId: uuid("operation_id").primaryKey(),
  actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  leaveId: uuid("leave_id").references(() => leaveBookings.id, { onDelete: "restrict" }),
  reservationId: uuid("reservation_id").references(() => resourceBookings.id, { onDelete: "restrict" }),
  fingerprint: text("fingerprint").notNull(),
  resultingVersion: integer("resulting_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("scheduling_edit_one_target", sql`num_nonnulls(${t.leaveId}, ${t.reservationId}) = 1`), check("scheduling_edit_version", sql`${t.resultingVersion} > 0`), check("scheduling_edit_hash", sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`)]);
