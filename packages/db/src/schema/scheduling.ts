import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { custodialLots } from "./custodial-inventory";

export const employmentCategory = pgEnum("employment_category", ["teacher", "personnel", "shs", "jhs"]);
export const bookingStatus = pgEnum("booking_status", ["pending", "approved", "rejected", "cancelled"]);
export const bookableKind = pgEnum("bookable_kind", ["equipment", "facility"]);

export const schedulingPolicy = pgTable("scheduling_policy", {
  id: integer("id").primaryKey().default(1),
  leaveEnabled: boolean("leave_enabled").notNull().default(false),
  publicLeave: boolean("public_leave").notNull().default(false),
  teacherLimit: integer("teacher_limit"),
  personnelLimit: integer("personnel_limit"),
  shsLimit: integer("shs_limit"),
  jhsLimit: integer("jhs_limit"),
  version: integer("version").notNull().default(0),
}, (t) => [check("scheduling_policy_singleton", sql`${t.id} = 1`), check("scheduling_policy_limits", sql`(${t.teacherLimit} IS NULL OR ${t.teacherLimit} >= 0) AND (${t.personnelLimit} IS NULL OR ${t.personnelLimit} >= 0) AND (${t.shsLimit} IS NULL OR ${t.shsLimit} >= 0) AND (${t.jhsLimit} IS NULL OR ${t.jhsLimit} >= 0)`)]);

export const employmentAssignments = pgTable("employment_assignments", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  category: employmentCategory("category").notNull(),
  active: boolean("active").notNull().default(true),
});

/** Directory beneficiaries are independent of authenticated filing accounts. */
export const schedulingPeople = pgTable("scheduling_people", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").$type<"teacher" | "shs" | "jhs" | "personnel">().notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "restrict" }),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(0),
}, (t) => [uniqueIndex("scheduling_person_code_unique").on(t.code), uniqueIndex("scheduling_person_account_unique").on(t.userId), check("scheduling_person_code", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`), check("scheduling_person_name", sql`length(trim(${t.name})) BETWEEN 1 AND 160`), check("scheduling_person_category", sql`${t.category} IN ('teacher', 'shs', 'jhs', 'personnel')`), check("scheduling_teacher_no_account", sql`${t.category} = 'personnel' OR ${t.userId} IS NULL`), check("scheduling_person_version", sql`${t.version} >= 0`)]);

export const schedulingInvitations = pgTable("scheduling_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull(),
  kind: text("kind").$type<"leave" | "resource">().notNull(),
  personId: uuid("person_id").references(() => schedulingPeople.id, { onDelete: "restrict" }),
  personVersion: integer("person_version"),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedOperationId: uuid("used_operation_id"),
  usedFingerprint: text("used_fingerprint"),
  receiptCode: uuid("receipt_code"),
  version: integer("version").notNull().default(0),
}, (t) => [uniqueIndex("scheduling_invitation_hash_unique").on(t.tokenHash), index("scheduling_invitation_created_idx").on(t.createdAt), check("scheduling_invitation_kind", sql`(${t.kind} = 'leave' AND ${t.personId} IS NOT NULL AND ${t.personVersion} IS NOT NULL) OR (${t.kind} = 'resource' AND ${t.personId} IS NULL AND ${t.personVersion} IS NULL)`), check("scheduling_invitation_expiry", sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '7 days'`), check("scheduling_invitation_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`), check("scheduling_invitation_receipt", sql`num_nonnulls(${t.usedAt}, ${t.usedOperationId}, ${t.usedFingerprint}, ${t.receiptCode}) IN (0, 4)`), check("scheduling_invitation_version", sql`${t.version} >= 0`)]);

/** Ephemeral abuse counters; keys contain hashes, never tokens or raw addresses. */
export const schedulingPublicLimits = pgTable("scheduling_public_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull(),
}, (t) => [index("scheduling_public_limit_window_idx").on(t.windowStart), check("scheduling_public_limit_positive", sql`${t.attempts} > 0`)]);

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
  requesterId: text("requester_id").references(() => user.id, { onDelete: "restrict" }),
  personId: uuid("person_id").notNull().references(() => schedulingPeople.id, { onDelete: "restrict" }),
  personName: text("person_name").notNull(),
  invitationId: uuid("invitation_id").references(() => schedulingInvitations.id, { onDelete: "restrict" }),
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
}, (t) => [uniqueIndex("leave_booking_invitation_unique").on(t.invitationId), check("leave_booking_origin", sql`num_nonnulls(${t.requesterId}, ${t.invitationId}) = 1`), check("leave_booking_beneficiary_name", sql`length(trim(${t.personName})) > 0`), uniqueIndex("leave_booking_operation_unique").on(t.operationId), index("leave_booking_dates_idx").on(t.startDate, t.endDate, t.status), check("leave_booking_dates", sql`${t.endDate} >= ${t.startDate} AND ${t.endDate} - ${t.startDate} < 366`), check("leave_booking_reason", sql`length(trim(${t.reason})) > 0`)]);

export const resourceBookings = pgTable("resource_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => bookableResources.id, { onDelete: "restrict" }),
  personId: uuid("person_id").references(() => schedulingPeople.id, { onDelete: "restrict" }),
  personName: text("person_name").notNull(),
  beneficiaryCategory: text("beneficiary_category").$type<"teacher" | "shs" | "jhs" | "personnel" | "student" | "other">().notNull(),
  invitationId: uuid("invitation_id").references(() => schedulingInvitations.id, { onDelete: "restrict" }),
  requesterId: text("requester_id").references(() => user.id, { onDelete: "restrict" }),
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
}, (t) => [uniqueIndex("resource_booking_invitation_unique").on(t.invitationId), check("resource_booking_origin", sql`num_nonnulls(${t.requesterId}, ${t.invitationId}) = 1`), check("resource_booking_beneficiary_name", sql`length(trim(${t.personName})) > 0`), check("resource_booking_beneficiary_category", sql`${t.beneficiaryCategory} IN ('teacher', 'shs', 'jhs', 'personnel', 'student', 'other')`), uniqueIndex("resource_booking_operation_unique").on(t.operationId), index("resource_booking_range_idx").on(t.resourceId, t.startDate, t.endDate, t.status), check("resource_booking_interval", sql`${t.endDate} >= ${t.startDate} AND ${t.endDate} - ${t.startDate} < 366`), check("resource_booking_purpose", sql`length(trim(${t.purpose})) > 0`)]);

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
