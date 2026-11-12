// Initial custodial storage. Domain services and authorization are still pending.
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const custodialClass = pgEnum("custodial_class", ["stock_card", "semi_expendable", "ppe"]);
export const custodialOperationType = pgEnum("custodial_operation_type", ["opening", "receipt", "issue", "return", "transfer", "adjustment"]);
export const custodialFormFamily = pgEnum("custodial_form_family", ["stock_card", "rpcsp", "rpcppe"]);
export const custodialCountStatus = pgEnum("custodial_count_status", ["draft", "finalized"]);
export const custodialCountLineStatus = pgEnum("custodial_count_line_status", ["uncounted", "counted", "excluded", "unavailable"]);

export const custodialFormProfiles = pgTable("custodial_form_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  family: custodialFormFamily("family").notNull(),
  version: integer("version").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  sourceHash: text("source_hash").notNull(),
  versionNote: text("version_note").notNull(),
  visualApproval: text("visual_approval").notNull(),
  definition: jsonb("definition").notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("custodial_form_profile_family_version_unique").on(t.family, t.version),
  uniqueIndex("custodial_form_profile_id_family_unique").on(t.id, t.family),
  check("custodial_form_profile_version_positive", sql`${t.version} > 0`),
  check("custodial_form_profile_source_hash", sql`${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
  check("custodial_form_profile_notes_nonblank", sql`length(trim(${t.versionNote})) > 0 AND length(trim(${t.visualApproval})) > 0`),
]);

export const custodialSections = pgTable("custodial_sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  formFamily: text("form_family").notNull(),
  name: text("name").notNull(),
  sheetName: text("sheet_name"),
  displayOrder: integer("display_order").notNull(),
  active: boolean("active").default(true).notNull(),
  effectiveFrom: date("effective_from"),
  effectiveUntil: date("effective_until"),
  version: integer("version").default(0).notNull(),
}, (t) => [uniqueIndex("custodial_sections_code_unique").on(t.code), check("custodial_sections_dates", sql`${t.effectiveUntil} IS NULL OR ${t.effectiveFrom} IS NULL OR ${t.effectiveUntil} >= ${t.effectiveFrom}`), check("custodial_sections_version", sql`${t.version} >= 0`)]);

export const custodialClassificationPolicies = pgTable("custodial_classification_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  version: integer("version").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  threshold: numeric("threshold", { precision: 15, scale: 2 }).notNull(),
  note: text("note").notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("custodial_classification_policy_version_unique").on(t.version), check("custodial_classification_policy_version_positive", sql`${t.version} > 0`), check("custodial_classification_policy_threshold_nonnegative", sql`${t.threshold} >= 0`), check("custodial_classification_policy_note_nonblank", sql`length(trim(${t.note})) > 0`)]);

export const custodialItems = pgTable("custodial_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  normalizedCode: text("normalized_code").notNull(),
  article: text("article").notNull(),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  reorderPoint: integer("reorder_point"),
  defaultSectionId: uuid("default_section_id").references(() => custodialSections.id, { onDelete: "restrict" }),
  active: boolean("active").default(true).notNull(),
  notes: text("notes"),
  version: integer("version").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("custodial_items_normalized_code_unique").on(t.normalizedCode), check("custodial_items_reorder_nonnegative", sql`${t.reorderPoint} IS NULL OR ${t.reorderPoint} >= 0`), check("custodial_items_version_nonnegative", sql`${t.version} >= 0`)]);

/** Reserved for the life of the register, including codes replaced by edits. */
export const custodialItemCodes = pgTable("custodial_item_codes", {
  normalizedCode: text("normalized_code").primaryKey(),
  itemId: uuid("item_id").notNull().references(() => custodialItems.id, { onDelete: "restrict" }),
  code: text("code").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
});

export const custodialPropertyExceptions = pgTable("custodial_property_exceptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  fundCluster: text("fund_cluster").notNull(),
  normalizedPropertyNumber: text("normalized_property_number").notNull(),
  reason: text("reason").notNull(),
  approvedBy: text("approved_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("custodial_exception_scope_unique").on(t.id, t.fundCluster, t.normalizedPropertyNumber),
  check("custodial_exception_reason_nonblank", sql`length(trim(${t.reason})) > 0`),
  check("custodial_exception_number_nonblank", sql`length(trim(${t.normalizedPropertyNumber})) > 0`),
]);

export const custodialLots = pgTable("custodial_lots", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull().references(() => custodialItems.id, { onDelete: "restrict" }),
  reportingClass: custodialClass("reporting_class").notNull(),
  propertyNumber: text("property_number"),
  normalizedPropertyNumber: text("normalized_property_number"),
  propertyExceptionId: uuid("property_exception_id"),
  unitValue: numeric("unit_value", { precision: 18, scale: 2 }),
  supplier: text("supplier"),
  acquiredOn: date("acquired_on"),
  yearLabel: text("year_label"),
  fundCluster: text("fund_cluster").notNull(),
  accountableOfficer: text("accountable_officer"),
  office: text("office").notNull(),
  condition: text("condition"),
  remarks: text("remarks"),
  active: boolean("active").default(true).notNull(),
  version: integer("version").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("custodial_lots_item_idx").on(t.itemId),
  uniqueIndex("custodial_lots_identity_scope_unique").on(t.id, t.itemId, t.fundCluster),
  uniqueIndex("custodial_lots_property_unique").on(t.fundCluster, t.normalizedPropertyNumber).where(sql`${t.normalizedPropertyNumber} IS NOT NULL AND ${t.propertyExceptionId} IS NULL`),
  uniqueIndex("custodial_lots_property_exception_unique").on(t.propertyExceptionId).where(sql`${t.propertyExceptionId} IS NOT NULL`),
  foreignKey({ name: "custodial_lots_exception_scope_fk", columns: [t.propertyExceptionId, t.fundCluster, t.normalizedPropertyNumber], foreignColumns: [custodialPropertyExceptions.id, custodialPropertyExceptions.fundCluster, custodialPropertyExceptions.normalizedPropertyNumber] }).onDelete("restrict"),
  check("custodial_lots_property_fields", sql`(${t.propertyNumber} IS NULL AND ${t.normalizedPropertyNumber} IS NULL AND ${t.propertyExceptionId} IS NULL) OR (${t.propertyNumber} IS NOT NULL AND ${t.normalizedPropertyNumber} IS NOT NULL AND length(trim(${t.propertyNumber})) > 0 AND length(trim(${t.normalizedPropertyNumber})) > 0)`),
  check("custodial_lots_value_nonnegative", sql`${t.unitValue} IS NULL OR ${t.unitValue} >= 0`),
  check("custodial_lots_version_nonnegative", sql`${t.version} >= 0`),
]);

export const custodialImportBatches = pgTable("custodial_import_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceHash: text("source_hash").notNull(),
  filename: text("filename").notNull(),
  family: custodialFormFamily("family").notNull(),
  rawBase64: text("raw_base64"),
  classificationThreshold: text("classification_threshold"),
  classificationPolicyId: uuid("classification_policy_id").references(() => custodialClassificationPolicies.id, { onDelete: "restrict" }),
  metadataEvidence: jsonb("metadata_evidence").notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  warnings: jsonb("warnings").notNull(),
  commitDetails: jsonb("commit_details"),
  status: text("status").default("staged").notNull(),
  version: integer("version").default(0).notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("custodial_import_batches_hash_idx").on(t.sourceHash),
  check("custodial_import_source_hash", sql`${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
  check("custodial_import_raw_limit", sql`${t.rawBase64} IS NULL OR length(${t.rawBase64}) <= 11184812`),
  check("custodial_import_status", sql`${t.status} IN ('staged', 'committed', 'expired')`),
  check("custodial_import_commit_details", sql`(${t.status} = 'committed' AND ${t.commitDetails} IS NOT NULL) OR (${t.status} <> 'committed' AND ${t.commitDetails} IS NULL)`),
  check("custodial_import_version", sql`${t.version} >= 0`),
]);


export const custodialCounts = pgTable("custodial_counts", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  normalizedCode: text("normalized_code").notNull(),
  family: custodialFormFamily("family").notNull(),
  profileId: uuid("profile_id").notNull().references(() => custodialFormProfiles.id, { onDelete: "restrict" }),
  asOfDate: date("as_of_date").notNull(),
  fundCluster: text("fund_cluster").notNull(),
  office: text("office"),
  sectionIds: jsonb("section_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").notNull(),
  status: custodialCountStatus("status").default("draft").notNull(),
  version: integer("version").default(0).notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finalizedBy: text("finalized_by").references(() => user.id, { onDelete: "restrict" }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  finalPayload: jsonb("final_payload"),
  supersedesId: uuid("supersedes_id"),
  amendmentReason: text("amendment_reason"),
}, (t) => [
  uniqueIndex("custodial_counts_code_unique").on(t.normalizedCode),
  uniqueIndex("custodial_counts_supersedes_unique").on(t.supersedesId).where(sql`${t.supersedesId} IS NOT NULL`),
  foreignKey({ name: "custodial_counts_supersedes_fk", columns: [t.supersedesId], foreignColumns: [t.id] }).onDelete("restrict"),
  foreignKey({ name: "custodial_counts_profile_family_fk", columns: [t.profileId, t.family], foreignColumns: [custodialFormProfiles.id, custodialFormProfiles.family] }).onDelete("restrict"),
  check("custodial_counts_family", sql`${t.family} IN ('rpcsp', 'rpcppe')`),
  check("custodial_counts_version", sql`${t.version} >= 0`),
  check("custodial_counts_finalization", sql`(${t.status} = 'draft' AND ${t.finalizedBy} IS NULL AND ${t.finalizedAt} IS NULL AND ${t.finalPayload} IS NULL) OR (${t.status} = 'finalized' AND ${t.finalizedBy} IS NOT NULL AND ${t.finalizedAt} IS NOT NULL AND ${t.finalPayload} IS NOT NULL)`),
  check("custodial_counts_amendment", sql`(${t.supersedesId} IS NULL AND ${t.amendmentReason} IS NULL) OR (${t.supersedesId} IS NOT NULL AND ${t.amendmentReason} IS NOT NULL AND length(trim(${t.amendmentReason})) > 0 AND ${t.supersedesId} <> ${t.id})`),
]);

export const custodialCountLines = pgTable("custodial_count_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  countId: uuid("count_id").notNull().references(() => custodialCounts.id, { onDelete: "restrict" }),
  lotId: uuid("lot_id").notNull().references(() => custodialLots.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  importBatchId: uuid("import_batch_id").references(() => custodialImportBatches.id, { onDelete: "restrict" }),
  importEvidence: jsonb("import_evidence"),
  status: custodialCountLineStatus("status").default("uncounted").notNull(),
  physicalQuantity: integer("physical_quantity"),
  condition: text("condition"),
  conditionBreakdown: jsonb("condition_breakdown").$type<Array<{ condition: string; quantity: number }>>(),
  remarks: text("remarks"),
  reviewerNote: text("reviewer_note"),
  resolution: text("resolution"),
  reviewRequired: boolean("review_required").default(false).notNull(),
  version: integer("version").default(0).notNull(),
}, (t) => [
  uniqueIndex("custodial_count_lines_count_lot_unique").on(t.countId, t.lotId),
  uniqueIndex("custodial_count_lines_id_count_unique").on(t.id, t.countId),
  check("custodial_count_lines_quantity", sql`(${t.status} = 'counted' AND ${t.physicalQuantity} IS NOT NULL AND ${t.physicalQuantity} >= 0) OR (${t.status} <> 'counted' AND ${t.physicalQuantity} IS NULL)`),
  check("custodial_count_lines_resolution", sql`${t.status} NOT IN ('excluded', 'unavailable') OR (${t.resolution} IS NOT NULL AND length(trim(${t.resolution})) > 0)`),
  check("custodial_count_lines_version", sql`${t.version} >= 0`),
  check("custodial_count_lines_import_evidence", sql`(${t.importBatchId} IS NULL AND ${t.importEvidence} IS NULL) OR (${t.importBatchId} IS NOT NULL AND ${t.importEvidence} IS NOT NULL)`),
]);

export const custodialCountAssignments = pgTable("custodial_count_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  countId: uuid("count_id").notNull().references(() => custodialCounts.id, { onDelete: "restrict" }),
  lineId: uuid("line_id").references(() => custodialCountLines.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  active: boolean("active").default(true).notNull(),
  assignedBy: text("assigned_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("custodial_count_assignments_scope_idx").on(t.countId, t.userId, t.active),
  uniqueIndex("custodial_count_assignments_session_unique").on(t.countId, t.userId).where(sql`${t.lineId} IS NULL`),
  uniqueIndex("custodial_count_assignments_line_unique").on(t.countId, t.lineId, t.userId).where(sql`${t.lineId} IS NOT NULL`),
  foreignKey({ name: "custodial_count_assignment_line_scope_fk", columns: [t.lineId, t.countId], foreignColumns: [custodialCountLines.id, custodialCountLines.countId] }).onDelete("restrict"),
]);

export const custodialCountOmissions = pgTable("custodial_count_omissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  countId: uuid("count_id").notNull().references(() => custodialCounts.id, { onDelete: "restrict" }),
  lotId: uuid("lot_id").notNull().references(() => custodialLots.id, { onDelete: "restrict" }),
  sourceFingerprint: text("source_fingerprint").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  reason: text("reason").notNull(),
  active: boolean("active").default(true).notNull(),
  decidedBy: text("decided_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("custodial_count_omission_unique").on(t.countId, t.lotId),
  check("custodial_count_omission_reason_nonblank", sql`length(trim(${t.reason})) > 0`),
]);

export const custodialImportRows = pgTable("custodial_import_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id").notNull().references(() => custodialImportBatches.id, { onDelete: "restrict" }),
  sheetName: text("sheet_name").notNull(),
  sourceRow: integer("source_row").notNull(),
  evidence: jsonb("evidence").notNull(),
  warnings: jsonb("warnings").notNull(),
  mapping: jsonb("mapping"),
  resolution: text("resolution"),
  version: integer("version").default(0).notNull(),
}, (t) => [
  uniqueIndex("custodial_import_source_row_unique").on(t.batchId, t.sheetName, t.sourceRow),
  check("custodial_import_source_row_positive", sql`${t.sourceRow} > 0`),
  check("custodial_import_row_version", sql`${t.version} >= 0`),
]);

export const custodialBalances = pgTable("custodial_balances", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull().references(() => custodialItems.id, { onDelete: "restrict" }),
  lotId: uuid("lot_id").references(() => custodialLots.id, { onDelete: "restrict" }),
  fundCluster: text("fund_cluster").notNull(),
  office: text("office").notNull(),
  quantity: integer("quantity").default(0).notNull(),
  version: integer("version").default(0).notNull(),
}, (t) => [
  uniqueIndex("custodial_balances_lot_unique").on(t.itemId, t.lotId, t.fundCluster, t.office).where(sql`${t.lotId} IS NOT NULL`),
  uniqueIndex("custodial_balances_unlotted_unique").on(t.itemId, t.fundCluster, t.office).where(sql`${t.lotId} IS NULL`),
  foreignKey({ name: "custodial_balances_lot_scope_fk", columns: [t.lotId, t.itemId, t.fundCluster], foreignColumns: [custodialLots.id, custodialLots.itemId, custodialLots.fundCluster] }).onDelete("restrict"),
  check("custodial_balances_quantity_nonnegative", sql`${t.quantity} >= 0`),
  check("custodial_balances_version_nonnegative", sql`${t.version} >= 0`),
]);

export const custodialOperations = pgTable("custodial_operations", {
  id: uuid("id").defaultRandom().primaryKey(),
  operationId: uuid("operation_id").notNull(),
  actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  operationType: custodialOperationType("operation_type").notNull(),
  sequence: integer("sequence").generatedAlwaysAsIdentity().notNull(),
  transactionDate: date("transaction_date").notNull(),
  reference: text("reference").notNull(),
  reason: text("reason").notNull(),
  counterparty: text("counterparty"),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("custodial_operations_operation_id_unique").on(t.operationId), uniqueIndex("custodial_operations_sequence_unique").on(t.sequence)]);

export const custodialMasterReplays = pgTable("custodial_master_replays", {
  operationId: uuid("operation_id").primaryKey(),
  actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  fingerprint: text("fingerprint").notNull(),
  targetId: uuid("target_id").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const custodialReportExports = pgTable("custodial_report_exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  family: custodialFormFamily("family").notNull(),
  countId: uuid("count_id").references(() => custodialCounts.id, { onDelete: "restrict" }),
  itemId: uuid("item_id").references(() => custodialItems.id, { onDelete: "restrict" }),
  profileId: uuid("profile_id").notNull().references(() => custodialFormProfiles.id, { onDelete: "restrict" }),
  asOfDate: date("as_of_date").notNull(),
  fundCluster: text("fund_cluster").notNull(),
  office: text("office"),
  payload: jsonb("payload").notNull(),
  dataHash: text("data_hash").notNull(),
  checksum: text("checksum").notNull(),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
  artifactBase64: text("artifact_base64"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("custodial_report_exports_created_idx").on(t.createdAt, t.id),
  foreignKey({ name: "custodial_report_exports_profile_family_fk", columns: [t.profileId, t.family], foreignColumns: [custodialFormProfiles.id, custodialFormProfiles.family] }).onDelete("restrict"),
  check("custodial_report_export_scope", sql`(${t.family} = 'stock_card' AND ${t.itemId} IS NOT NULL AND ${t.countId} IS NULL) OR (${t.family} IN ('rpcsp', 'rpcppe') AND ${t.countId} IS NOT NULL AND ${t.itemId} IS NULL)`),
  check("custodial_report_export_hashes", sql`${t.dataHash} ~ '^[0-9a-f]{64}$' AND ${t.checksum} ~ '^[0-9a-f]{64}$'`),
  check("custodial_report_export_row_count", sql`${t.rowCount} >= 0`),
  check("custodial_report_export_size", sql`${t.artifactBase64} IS NULL OR length(${t.artifactBase64}) <= 22369624`),
]);

export const custodialTransactions = pgTable("custodial_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  operationId: uuid("operation_id").notNull().references(() => custodialOperations.id, { onDelete: "restrict" }),
  balanceId: uuid("balance_id").notNull().references(() => custodialBalances.id, { onDelete: "restrict" }),
  delta: integer("delta").notNull(),
  balanceBefore: integer("balance_before").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  daysToConsume: integer("days_to_consume"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("custodial_transactions_balance_idx").on(t.balanceId, t.createdAt), check("custodial_transactions_arithmetic", sql`${t.delta} <> 0 AND ${t.balanceBefore} >= 0 AND ${t.balanceAfter} >= 0 AND ${t.balanceAfter} = ${t.balanceBefore} + ${t.delta}`), check("custodial_transactions_days_nonnegative", sql`${t.daysToConsume} IS NULL OR ${t.daysToConsume} >= 0`)]);

/** Appendix 59 snapshots are append-only; they never post stock. */
export const custodialIcsExports = pgTable("custodial_ics_exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  operationId: uuid("operation_id").notNull(),
  intentHash: text("intent_hash").notNull(),
  number: text("number").notNull(),
  payload: jsonb("payload").notNull(),
  dataHash: text("data_hash").notNull(),
  checksum: text("checksum").notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("custodial_ics_operation_unique").on(t.operationId), index("custodial_ics_number_idx").on(t.number)]);

/** Editable head; every issued export revision remains immutable. */
export const custodialIcsDocuments = pgTable("custodial_ics_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  number: text("number").notNull(),
  currentExportId: uuid("current_export_id").notNull().references(() => custodialIcsExports.id, { onDelete: "restrict" }),
  version: integer("version").default(1).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by").references(() => user.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("custodial_ics_document_number_unique").on(t.number), check("custodial_ics_document_version", sql`${t.version} > 0`), check("custodial_ics_deleted_actor", sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`) ]);

export const custodialIcsVersions = pgTable("custodial_ics_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => custodialIcsDocuments.id, { onDelete: "restrict" }),
  exportId: uuid("export_id").notNull().references(() => custodialIcsExports.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("custodial_ics_document_revision_unique").on(t.documentId, t.version), uniqueIndex("custodial_ics_revision_export_unique").on(t.exportId), check("custodial_ics_revision_version", sql`${t.version} > 0`)]);

export const custodialIcsCounters = pgTable("custodial_ics_counters", {
  period: text("period").primaryKey(),
  lastValue: integer("last_value").default(0).notNull(),
}, (t) => [check("custodial_ics_counter_period", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`), check("custodial_ics_counter_nonnegative", sql`${t.lastValue} >= 0`)]);
