import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { custodialBalances, custodialLots, custodialTransactions } from "./custodial-inventory";
import { schedulingPeople } from "./scheduling";

export const equipmentStates = ["available", "issued", "under_repair", "lost", "disposed"] as const;
export type EquipmentSnapshot = {
  permanentNumber: string; brand: string; model: string; serialNumber: string | null; missingSerialReason: string | null;
  specifications: string; accessories: string; warrantyUntil: string | null; notes: string;
  state: typeof equipmentStates[number]; personId: string | null; personName: string | null;
  location: string; condition: string; version: number;
};
export const equipmentUnits = pgTable("custodial_equipment_units", {
  id: uuid("id").defaultRandom().primaryKey(),
  lotId: uuid("lot_id").notNull().references(() => custodialLots.id, { onDelete: "restrict" }),
  balanceId: uuid("balance_id").notNull().references(() => custodialBalances.id, { onDelete: "restrict" }),
  permanentNumber: text("permanent_number").notNull(), normalizedNumber: text("normalized_number").notNull(),
  brand: text("brand").notNull(), normalizedBrand: text("normalized_brand").notNull(), model: text("model").notNull(),
  serialNumber: text("serial_number"), normalizedSerial: text("normalized_serial"), missingSerialReason: text("missing_serial_reason"),
  specifications: text("specifications").notNull().default(""), accessories: text("accessories").notNull().default(""),
  warrantyUntil: date("warranty_until"), notes: text("notes").notNull().default(""),
  state: text("state").$type<typeof equipmentStates[number]>().notNull().default("available"),
  personId: uuid("person_id").references(() => schedulingPeople.id, { onDelete: "restrict" }), personName: text("person_name"),
  location: text("location").notNull(), condition: text("condition").notNull(),
  effectiveDate: date("effective_date").notNull(), version: integer("version").notNull().default(0),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("equipment_lot_unique").on(t.lotId), uniqueIndex("equipment_number_unique").on(t.normalizedNumber),
  uniqueIndex("equipment_serial_unique").on(t.normalizedBrand, t.normalizedSerial).where(sql`${t.normalizedSerial} IS NOT NULL`),
  index("equipment_person_idx").on(t.personId, t.state),
  check("equipment_version", sql`${t.version} >= 0`),
  check("equipment_state", sql`${t.state} IN ('available','issued','under_repair','lost','disposed')`),
  check("equipment_person", sql`(${t.personId} IS NULL) = (${t.personName} IS NULL) AND (${t.state} <> 'issued' OR ${t.personId} IS NOT NULL) AND (${t.state} NOT IN ('available','disposed') OR ${t.personId} IS NULL)`),
  check("equipment_identity", sql`length(trim(${t.permanentNumber})) > 0 AND ${t.normalizedNumber} = upper(trim(${t.permanentNumber})) AND length(trim(${t.brand})) > 0 AND ${t.normalizedBrand} = upper(trim(${t.brand})) AND length(trim(${t.model})) > 0`),
  check("equipment_serial", sql`(${t.serialNumber} IS NOT NULL AND length(trim(${t.serialNumber})) > 0 AND ${t.normalizedSerial} IS NOT NULL AND ${t.normalizedSerial} = upper(trim(${t.serialNumber})) AND ${t.missingSerialReason} IS NULL) OR (${t.serialNumber} IS NULL AND ${t.normalizedSerial} IS NULL AND ${t.missingSerialReason} IS NOT NULL AND length(trim(${t.missingSerialReason})) > 0)`),
]);
export const equipmentEvents = pgTable("custodial_equipment_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  unitId: uuid("unit_id").notNull().references(() => equipmentUnits.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  transactionId: uuid("transaction_id").references(() => custodialTransactions.id, { onDelete: "restrict" }),
  correctedIssueId: uuid("corrected_issue_id").references(() => custodialTransactions.id, { onDelete: "restrict" }),
  issueDetails: jsonb("issue_details").$type<{date:string;reference:string;purpose:string}>(),
  effectiveDate: date("effective_date").notNull(), reference: text("reference").notNull(), reason: text("reason").notNull(),
  documentReference: text("document_reference"), snapshot: jsonb("snapshot").$type<EquipmentSnapshot>().notNull(),
  version: integer("version").notNull(), actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("equipment_event_version_unique").on(t.unitId, t.version),
  uniqueIndex("equipment_event_transaction_unique").on(t.transactionId).where(sql`${t.transactionId} IS NOT NULL`),
  index("equipment_event_as_of_idx").on(t.unitId, t.effectiveDate, t.version),
  check("equipment_event_kind", sql`${t.kind} IN ('register','adopt','issue','return','reassign','edit','correct_issue','repair','repaired','lost','recover','dispose')`),
  index("equipment_issue_correction_idx").on(t.correctedIssueId, t.version),
  check("equipment_issue_correction", sql`(${t.kind} = 'correct_issue') = (${t.correctedIssueId} IS NOT NULL AND ${t.issueDetails} IS NOT NULL) AND (${t.kind} = 'correct_issue' OR (${t.correctedIssueId} IS NULL AND ${t.issueDetails} IS NULL)) AND (${t.kind} <> 'correct_issue' OR ${t.transactionId} IS NULL)`),
  check("equipment_event_reference", sql`length(trim(${t.reference})) > 0 AND length(trim(${t.reason})) > 0`),
  check("equipment_event_version", sql`${t.version} >= 0`),
]);

// Corrected-away serials remain reserved for their original physical device.
export const equipmentSerialReservations = pgTable("custodial_equipment_serial_reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  unitId: uuid("unit_id").notNull().references(() => equipmentUnits.id, { onDelete: "restrict" }),
  normalizedBrand: text("normalized_brand").notNull(), normalizedSerial: text("normalized_serial").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("equipment_serial_reservation_unique").on(t.normalizedBrand,t.normalizedSerial),
  check("equipment_serial_reservation_normalized",sql`length(trim(${t.normalizedBrand})) > 0 AND ${t.normalizedBrand} = upper(trim(${t.normalizedBrand})) AND length(trim(${t.normalizedSerial})) > 0 AND ${t.normalizedSerial} = upper(trim(${t.normalizedSerial}))`),
]);
