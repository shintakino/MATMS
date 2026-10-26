import { defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const confidentiality = pgEnum("confidentiality", ["internal", "restricted"]);
export const recordLifecycle = pgEnum("record_lifecycle", ["active", "archived", "retired"]);
export const folderColor = pgEnum("folder_color", ["yellow", "blue", "red", "other"]);

const mutableTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    ...mutableTimestamps,
  },
  (table) => [uniqueIndex("categories_normalized_code_unique").on(table.normalizedCode)],
);

export const shelfLocations = pgTable(
  "shelf_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    room: text("room").notNull(),
    shelf: text("shelf").notNull(),
    rack: text("rack").notNull(),
    position: text("position"),
    label: text("label").notNull(),
    active: boolean("active").default(true).notNull(),
    ...mutableTimestamps,
  },
  (table) => [uniqueIndex("shelf_locations_normalized_code_unique").on(table.normalizedCode)],
);

export const boxes = pgTable(
  "boxes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    shelfLocationId: uuid("shelf_location_id")
      .notNull()
      .references(() => shelfLocations.id, { onDelete: "restrict" }),
    lifecycle: recordLifecycle("lifecycle").default("active").notNull(),
    confidentiality: confidentiality("confidentiality").default("internal").notNull(),
    notes: text("notes"),
    ...mutableTimestamps,
  },
  (table) => [
    uniqueIndex("boxes_normalized_code_unique").on(table.normalizedCode),
    index("boxes_category_location_idx").on(table.categoryId, table.shelfLocationId),
    index("boxes_lifecycle_confidentiality_idx").on(table.lifecycle, table.confidentiality),
  ],
);

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id")
      .notNull()
      .references(() => boxes.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    name: text("name").notNull(),
    color: folderColor("color").default("other").notNull(),
    isTemplateFolder: boolean("is_template_folder").default(false).notNull(),
    urgency: text("urgency"),
    notes: text("notes"),
    confidentiality: confidentiality("confidentiality").default("internal").notNull(),
    lifecycle: recordLifecycle("lifecycle").default("active").notNull(),
    ...mutableTimestamps,
  },
  (table) => [
    uniqueIndex("folders_normalized_code_unique").on(table.normalizedCode),
    index("folders_box_lifecycle_idx").on(table.boxId, table.lifecycle),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    title: text("title").notNull(),
    documentDate: text("document_date"),
    coveredPeriod: text("covered_period"),
    keywords: text("keywords"),
    description: text("description"),
    digitalUrl: text("digital_url"),
    confidentiality: confidentiality("confidentiality").default("internal").notNull(),
    lifecycle: recordLifecycle("lifecycle").default("active").notNull(),
    ...mutableTimestamps,
  },
  (table) => [
    uniqueIndex("documents_normalized_code_unique").on(table.normalizedCode),
    index("documents_folder_lifecycle_idx").on(table.folderId, table.lifecycle),
  ],
);

export const accessGrants = pgTable(
  "access_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "restrict" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "restrict" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "access_grants_exactly_one_target",
      sql`(case when ${table.boxId} is null then 0 else 1 end + case when ${table.folderId} is null then 0 else 1 end + case when ${table.documentId} is null then 0 else 1 end) = 1`,
    ),
    uniqueIndex("access_grants_active_box_unique").on(table.userId, table.boxId).where(sql`${table.active} = true and ${table.boxId} is not null`),
    uniqueIndex("access_grants_active_folder_unique").on(table.userId, table.folderId).where(sql`${table.active} = true and ${table.folderId} is not null`),
    uniqueIndex("access_grants_active_document_unique").on(table.userId, table.documentId).where(sql`${table.active} = true and ${table.documentId} is not null`),
  ],
);

export const movementEvents = pgTable(
  "movement_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "restrict" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "restrict" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "restrict" }),
    source: jsonb("source").notNull(),
    destination: jsonb("destination").notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "movement_events_exactly_one_target",
      sql`(case when ${table.boxId} is null then 0 else 1 end + case when ${table.folderId} is null then 0 else 1 end + case when ${table.documentId} is null then 0 else 1 end) = 1`,
    ),
    index("movement_events_occurred_at_idx").on(table.occurredAt),
  ],
);

export const archiveRelations = defineRelationsPart(
  { categories, shelfLocations, boxes, folders, documents, accessGrants, movementEvents, user },
  (r) => ({
    categories: { boxes: r.many.boxes({ from: r.categories.id, to: r.boxes.categoryId }) },
    shelfLocations: { boxes: r.many.boxes({ from: r.shelfLocations.id, to: r.boxes.shelfLocationId }) },
    boxes: {
      category: r.one.categories({ from: r.boxes.categoryId, to: r.categories.id }),
      shelfLocation: r.one.shelfLocations({ from: r.boxes.shelfLocationId, to: r.shelfLocations.id }),
      folders: r.many.folders({ from: r.boxes.id, to: r.folders.boxId }),
    },
    folders: {
      box: r.one.boxes({ from: r.folders.boxId, to: r.boxes.id }),
      documents: r.many.documents({ from: r.folders.id, to: r.documents.folderId }),
    },
    documents: { folder: r.one.folders({ from: r.documents.folderId, to: r.folders.id }) },
  }),
);

export type Confidentiality = (typeof confidentiality.enumValues)[number];
export type RecordLifecycle = (typeof recordLifecycle.enumValues)[number];
export type FolderColor = (typeof folderColor.enumValues)[number];
