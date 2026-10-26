import { sql } from "drizzle-orm";
import {
  check,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { categories, folders } from "./archive";
import { user } from "./auth";

export const templateStatus = pgEnum("template_status", ["active", "superseded", "retired"]);
export const stockOperationType = pgEnum("stock_operation_type", ["receive", "issue", "transfer", "correct"]);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    familyCode: text("family_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    revisionLabel: text("revision_label").notNull(),
    revisionDate: text("revision_date"),
    digitalUrl: text("digital_url").notNull(),
    status: templateStatus("status").default("active").notNull(),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => templates.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("templates_normalized_code_unique").on(table.normalizedCode),
    index("templates_family_status_idx").on(table.familyCode, table.status),
  ],
);

export const templateInventory = pgTable(
  "template_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "restrict" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    count: integer("count").default(0).notNull(),
    threshold: integer("threshold").default(5).notNull(),
    version: integer("version").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("template_inventory_template_folder_unique").on(table.templateId, table.folderId),
    check("template_inventory_count_nonnegative", sql`${table.count} >= 0`),
    check("template_inventory_threshold_nonnegative", sql`${table.threshold} >= 0`),
  ],
);

export const stockOperations = pgTable(
  "stock_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    operationType: stockOperationType("operation_type").notNull(),
    reason: text("reason").notNull(),
    reference: text("reference"),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("stock_operations_operation_id_unique").on(table.operationId), index("stock_operations_actor_created_idx").on(table.actorId, table.createdAt)],
);

export const stockTransactions = pgTable(
  "stock_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stockOperationId: uuid("stock_operation_id")
      .notNull()
      .references(() => stockOperations.id, { onDelete: "restrict" }),
    inventoryId: uuid("inventory_id")
      .notNull()
      .references(() => templateInventory.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(),
    balanceBefore: integer("balance_before").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("stock_transactions_nonzero_delta", sql`${table.delta} <> 0`),
    check("stock_transactions_balance_nonnegative", sql`${table.balanceBefore} >= 0 and ${table.balanceAfter} >= 0`),
    check("stock_transactions_arithmetic", sql`${table.balanceAfter} = ${table.balanceBefore} + ${table.delta}`),
    index("stock_transactions_inventory_created_idx").on(table.inventoryId, table.createdAt),
  ],
);

export type TemplateStatus = (typeof templateStatus.enumValues)[number];
export type StockOperationType = (typeof stockOperationType.enumValues)[number];
