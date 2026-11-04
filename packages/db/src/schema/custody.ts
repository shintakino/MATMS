import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { documents, folders } from "./archive";
import { user } from "./auth";

export const requestKind = pgEnum("request_kind", ["inspect", "borrow", "copy"]);
export const requestStatus = pgEnum("request_status", ["draft", "submitted", "approved", "rejected", "cancelled", "in_progress", "completed"]);
export const requestLineStatus = pgEnum("request_line_status", ["pending", "approved", "rejected", "cancelled", "fulfilled"]);
export const custodyOperationKind = pgEnum("custody_operation_kind", ["release", "return"]);
export const loanExceptionKind = pgEnum("loan_exception_kind", ["lost", "damaged"]);

export const documentRequests = pgTable("document_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  normalizedCode: text("normalized_code").notNull(),
  requesterName: text("requester_name").notNull(),
  office: text("office"),
  contact: text("contact"),
  purpose: text("purpose").notNull(),
  kind: requestKind("kind").notNull(),
  notes: text("notes"),
  status: requestStatus("status").default("draft").notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("document_requests_normalized_code_unique").on(table.normalizedCode),
  index("document_requests_status_created_idx").on(table.status, table.createdAt),
]);

export const requestItems = pgTable("request_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => documentRequests.id, { onDelete: "restrict" }),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "restrict" }),
  status: requestLineStatus("status").default("pending").notNull(),
  decidedBy: text("decided_by").references(() => user.id, { onDelete: "restrict" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  approvedByAdmin: boolean("approved_by_admin").default(false).notNull(),
  decisionReason: text("decision_reason"),
  fulfilledBy: text("fulfilled_by").references(() => user.id, { onDelete: "restrict" }),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("request_items_request_document_unique").on(table.requestId, table.documentId),
  index("request_items_document_status_idx").on(table.documentId, table.status),
]);

export const documentCheckouts = pgTable("document_checkouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestItemId: uuid("request_item_id").notNull().references(() => requestItems.id, { onDelete: "restrict" }),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "restrict" }),
  homeFolderId: uuid("home_folder_id").notNull().references(() => folders.id, { onDelete: "restrict" }),
  recipient: text("recipient").notNull(),
  acknowledged: boolean("acknowledged").notNull(),
  releasedBy: text("released_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  returnedBy: text("returned_by").references(() => user.id, { onDelete: "restrict" }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  returnCondition: text("return_condition"),
  returnedFolderId: uuid("returned_folder_id").references(() => folders.id, { onDelete: "restrict" }),
  exception: loanExceptionKind("exception"),
  exceptionNotes: text("exception_notes"),
  exceptionRecordedBy: text("exception_recorded_by").references(() => user.id, { onDelete: "restrict" }),
  exceptionRecordedAt: timestamp("exception_recorded_at", { withTimezone: true }),
  resolution: text("resolution"),
  resolutionNotes: text("resolution_notes"),
  resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "restrict" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("document_checkouts_one_unresolved_per_document").on(table.documentId).where(sql`${table.resolvedAt} IS NULL AND (${table.returnedAt} IS NULL OR ${table.exception} IS NOT NULL)`),
  uniqueIndex("document_checkouts_request_item_unique").on(table.requestItemId),
  check("document_checkouts_due_chronology", sql`${table.dueAt} >= ${table.releasedAt}`),
  check("document_checkouts_return_chronology", sql`${table.returnedAt} IS NULL OR ${table.returnedAt} >= ${table.releasedAt}`),
  check("document_checkouts_resolution_chronology", sql`${table.resolvedAt} IS NULL OR ${table.resolvedAt} >= ${table.releasedAt}`),
  check("document_checkouts_acknowledged", sql`${table.acknowledged} = true`),
  check("document_checkouts_return_details", sql`(${table.returnedAt} IS NULL AND ${table.returnedBy} IS NULL AND ${table.returnCondition} IS NULL AND ${table.returnedFolderId} IS NULL) OR (${table.returnedAt} IS NOT NULL AND ${table.returnedBy} IS NOT NULL AND ${table.returnCondition} IS NOT NULL AND ${table.returnedFolderId} IS NOT NULL)`),
  check("document_checkouts_resolution_details", sql`(${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL AND ${table.resolution} IS NULL AND ${table.resolutionNotes} IS NULL) OR (${table.resolvedAt} IS NOT NULL AND ${table.resolvedBy} IS NOT NULL AND ${table.resolution} IS NOT NULL AND ${table.resolutionNotes} IS NOT NULL AND ${table.exception} IS NOT NULL)`),
  index("document_checkouts_due_idx").on(table.dueAt),
]);

export const custodyOperationReplays = pgTable("custody_operation_replays", {
  operationId: uuid("operation_id").primaryKey(),
  kind: custodyOperationKind("kind").notNull(),
  actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  scopeFingerprint: text("scope_fingerprint").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
