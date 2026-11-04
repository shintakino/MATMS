import { writeAuditEntry } from "@matms/db";
import type { AuditEntry, AuditTransaction, Database } from "@matms/db";
import {
  accessGrants,
  boxes,
  categories,
  documents,
  folders,
  movementEvents,
  shelfLocations,
} from "@matms/db/schema/archive";
import type { ApplicationRole } from "@matms/db/schema/identity";
import { user } from "@matms/db/schema/auth";
import { templateInventory, templates } from "@matms/db/schema/inventory";
import { documentCheckouts, requestItems } from "@matms/db/schema/custody";
import type { Confidentiality, FolderColor, RecordLifecycle } from "@matms/db/schema/archive";
import { and, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";

export class ArchiveServiceError extends Error {
  public constructor(
    public readonly code: "UNAVAILABLE" | "FORBIDDEN" | "CONFLICT" | "VALIDATION",
    message: string,
  ) {
    super(message);
    this.name = "ArchiveServiceError";
  }
}

export type ArchiveActor = { id: string; role: ApplicationRole };
type Scope = {
  box: { id: string; confidentiality: Confidentiality };
  folder?: { id: string; confidentiality: Confidentiality };
  document?: { id: string; confidentiality: Confidentiality };
};
type GrantSet = { boxes: Set<string>; folders: Set<string>; documents: Set<string> };
type ArchiveReader = Pick<Database, "select">;

export function normalizeCode(value: string) {
  const normalized = value.trim().normalize("NFKC").toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(normalized)) {
    throw new ArchiveServiceError("VALIDATION", "Codes use letters, numbers, periods, underscores, and hyphens.");
  }
  return normalized;
}

export function validateApprovedUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new ArchiveServiceError("VALIDATION", "Digital links must use HTTPS.");
  }
}

async function grantsFor(db: ArchiveReader, userId: string): Promise<GrantSet> {
  const rows = await db
    .select({ boxId: accessGrants.boxId, folderId: accessGrants.folderId, documentId: accessGrants.documentId })
    .from(accessGrants)
    .where(and(eq(accessGrants.userId, userId), eq(accessGrants.active, true)));
  return {
    boxes: new Set(rows.flatMap((row) => (row.boxId ? [row.boxId] : []))),
    folders: new Set(rows.flatMap((row) => (row.folderId ? [row.folderId] : []))),
    documents: new Set(rows.flatMap((row) => (row.documentId ? [row.documentId] : []))),
  };
}

function scopeAllowed(actor: ArchiveActor, grants: GrantSet, scope: Scope) {
  if (actor.role === "admin") return true;
  if (scope.box.confidentiality === "restricted" && !grants.boxes.has(scope.box.id)) return false;
  if (scope.folder?.confidentiality === "restricted" && !grants.folders.has(scope.folder.id)) return false;
  if (scope.document?.confidentiality === "restricted" && !grants.documents.has(scope.document.id)) return false;
  return true;
}

function requireAdmin(actor: ArchiveActor) {
  if (actor.role !== "admin") throw new ArchiveServiceError("FORBIDDEN", "This action is unavailable.");
}

function requireEditor(actor: ArchiveActor) {
  if (actor.role === "viewer") throw new ArchiveServiceError("FORBIDDEN", "This action is unavailable.");
}

async function getBoxScope(db: Database, id: string): Promise<Scope> {
  const [box] = await db.select().from(boxes).where(eq(boxes.id, id)).limit(1);
  if (!box) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  return { box: { id: box.id, confidentiality: box.confidentiality } };
}

async function getFolderScope(db: ArchiveReader, id: string): Promise<Scope> {
  const [row] = await db
    .select({
      folderId: folders.id,
      folderConfidentiality: folders.confidentiality,
      boxId: boxes.id,
      boxConfidentiality: boxes.confidentiality,
    })
    .from(folders)
    .innerJoin(boxes, eq(folders.boxId, boxes.id))
    .where(eq(folders.id, id))
    .limit(1);
  if (!row) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  return {
    box: { id: row.boxId, confidentiality: row.boxConfidentiality },
    folder: { id: row.folderId, confidentiality: row.folderConfidentiality },
  };
}

async function getDocumentScope(db: ArchiveReader, id: string): Promise<Scope> {
  const [row] = await db
    .select({
      documentId: documents.id,
      documentConfidentiality: documents.confidentiality,
      folderId: folders.id,
      folderConfidentiality: folders.confidentiality,
      boxId: boxes.id,
      boxConfidentiality: boxes.confidentiality,
    })
    .from(documents)
    .innerJoin(folders, eq(documents.folderId, folders.id))
    .innerJoin(boxes, eq(folders.boxId, boxes.id))
    .where(eq(documents.id, id))
    .limit(1);
  if (!row) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  return {
    box: { id: row.boxId, confidentiality: row.boxConfidentiality },
    folder: { id: row.folderId, confidentiality: row.folderConfidentiality },
    document: { id: row.documentId, confidentiality: row.documentConfidentiality },
  };
}

async function requireScope(db: ArchiveReader, actor: ArchiveActor, scope: Scope) {
  if (!scopeAllowed(actor, await grantsFor(db, actor.id), scope)) {
    throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  }
}

/** Shared inventory/custody boundary: a folder must be visible, active, and designated for templates. */
export async function requireActiveTemplateFolder(db: ArchiveReader, actor: ArchiveActor, folderId: string) {
  const scope = await getFolderScope(db, folderId);
  await requireScope(db, actor, scope);
  const [row] = await db
    .select({ folder: folders, box: boxes })
    .from(folders)
    .innerJoin(boxes, eq(folders.boxId, boxes.id))
    .where(eq(folders.id, folderId))
    .limit(1);
  if (!row) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  if (!row.folder.isTemplateFolder) throw new ArchiveServiceError("CONFLICT", "Inventory is only allowed in template folders.");
  if (row.folder.lifecycle !== "active" || row.box.lifecycle !== "active") {
    throw new ArchiveServiceError("CONFLICT", "Inventory operations require an active folder in an active box.");
  }
  return row;
}

function locationSnapshot(location: { code: string; label: string; room: string; shelf: string; rack: string; position: string | null }) {
  return { code: location.code, label: location.label, room: location.room, shelf: location.shelf, rack: location.rack, position: location.position };
}

async function audit(tx: AuditTransaction, input: Omit<AuditEntry, "actorId"> & { actorId: string }) {
  await writeAuditEntry(tx, input);
}

export async function listBoxes(db: Database, actor: ArchiveActor) {
  const rows = await db
    .select({ box: boxes, category: categories, location: shelfLocations })
    .from(boxes)
    .innerJoin(categories, eq(boxes.categoryId, categories.id))
    .innerJoin(shelfLocations, eq(boxes.shelfLocationId, shelfLocations.id))
    .where(ne(boxes.lifecycle, "retired"))
    .orderBy(boxes.code);
  const grants = actor.role === "admin" ? null : await grantsFor(db, actor.id);
  return rows
    .filter((row) => !grants || scopeAllowed(actor, grants, { box: { id: row.box.id, confidentiality: row.box.confidentiality } }))
    .map((row) => ({ ...row.box, categoryName: row.category.name, locationLabel: row.location.label }));
}

export async function getBox(db: Database, actor: ArchiveActor, id: string) {
  const scope = await getBoxScope(db, id);
  await requireScope(db, actor, scope);
  const [box] = await db
    .select({ box: boxes, category: categories, location: shelfLocations })
    .from(boxes)
    .innerJoin(categories, eq(boxes.categoryId, categories.id))
    .innerJoin(shelfLocations, eq(boxes.shelfLocationId, shelfLocations.id))
    .where(eq(boxes.id, id))
    .limit(1);
  if (!box) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  const grants = actor.role === "admin" ? null : await grantsFor(db, actor.id);
  const folderRows = await db.select().from(folders).where(and(eq(folders.boxId, id), ne(folders.lifecycle, "retired"))).orderBy(folders.code);
  const visibleFolders = folderRows.filter(
    (folder) => !grants || scopeAllowed(actor, grants, { ...scope, folder: { id: folder.id, confidentiality: folder.confidentiality } }),
  );
  const folderIds = visibleFolders.map((folder) => folder.id);
  const documentRows = folderIds.length ? await db.select().from(documents).where(and(inArray(documents.folderId, folderIds), ne(documents.lifecycle, "retired"))).orderBy(documents.code) : [];
  const permittedDocuments = documentRows.filter((document) => !grants || scopeAllowed(actor, grants, { ...scope, folder: visibleFolders.find((folder) => folder.id === document.folderId)!, document: { id: document.id, confidentiality: document.confidentiality } }));
  const stock = folderIds.length ? await db.select({ id: templateInventory.id, templateId: templates.id, name: templates.name, code: templates.code, folderId: templateInventory.folderId, count: templateInventory.count, threshold: templateInventory.threshold, revisionStatus: templates.status }).from(templateInventory).innerJoin(templates, eq(templateInventory.templateId, templates.id)).where(inArray(templateInventory.folderId, folderIds)).orderBy(templates.code) : [];
  return { ...box.box, categoryName: box.category.name, location: box.location, folders: visibleFolders, documents: permittedDocuments, stock };
}

export async function listFolderChoices(db: Database, actor: ArchiveActor) {
  const visibleBoxes = await listBoxes(db, actor);
  const result: Array<{ id: string; code: string; name: string; boxCode: string; locationLabel: string; isTemplateFolder: boolean }> = [];
  for (const box of visibleBoxes) {
    if (box.lifecycle !== "active") continue;
    const detail = await getBox(db, actor, box.id);
    for (const folder of detail.folders) {
      if (folder.lifecycle === "active") result.push({ id: folder.id, code: folder.code, name: folder.name, boxCode: box.code, locationLabel: detail.location.label, isTemplateFolder: folder.isTemplateFolder });
    }
  }
  return result;
}

export async function getFolder(db: Database, actor: ArchiveActor, id: string, includeRetired = false) {
  const scope = await getFolderScope(db, id);
  await requireScope(db, actor, scope);
  const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  if (!folder) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  const grants = actor.role === "admin" ? null : await grantsFor(db, actor.id);
  const documentRows = await db.select().from(documents).where(includeRetired ? eq(documents.folderId, id) : and(eq(documents.folderId, id), ne(documents.lifecycle, "retired"))).orderBy(documents.code);
  const visibleDocuments = documentRows.filter(
    (document) =>
      !grants || scopeAllowed(actor, grants, { ...scope, document: { id: document.id, confidentiality: document.confidentiality } }),
  );
  const result = [];
  for (const document of visibleDocuments) {
    const [checkout] = await db.select({ returnedAt: documentCheckouts.returnedAt, resolvedAt: documentCheckouts.resolvedAt }).from(documentCheckouts).where(and(eq(documentCheckouts.documentId, document.id), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
    result.push({ ...document, availability: checkout ? checkout.returnedAt ? "returned_exception" as const : checkout.resolvedAt ? "not_returned" as const : "checked_out" as const : "available" as const });
  }
  return {
    folder,
    box: (await db.select({ id: boxes.id, code: boxes.code, locationLabel: shelfLocations.label }).from(boxes).innerJoin(shelfLocations, eq(boxes.shelfLocationId, shelfLocations.id)).where(eq(boxes.id, folder.boxId)).limit(1))[0]!,
    documents: result,
  };
}

export async function requireFolderAccess(db: ArchiveReader, actor: ArchiveActor, id: string) {
  await requireScope(db, actor, await getFolderScope(db, id));
}

export async function getDocument(db: Database, actor: ArchiveActor, id: string) {
  const scope = await getDocumentScope(db, id);
  await requireScope(db, actor, scope);
  const [document] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!document) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  const [checkout] = await db.select({ returnedAt: documentCheckouts.returnedAt, resolvedAt: documentCheckouts.resolvedAt }).from(documentCheckouts).where(and(eq(documentCheckouts.documentId, id), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
  const [home] = await db.select({ folderId: folders.id, folderName: folders.name, boxId: boxes.id, boxCode: boxes.code, locationLabel: shelfLocations.label }).from(folders).innerJoin(boxes, eq(folders.boxId, boxes.id)).innerJoin(shelfLocations, eq(boxes.shelfLocationId, shelfLocations.id)).where(eq(folders.id, document.folderId)).limit(1);
  return { ...document, home: home!, availability: checkout ? checkout.returnedAt ? "returned_exception" as const : checkout.resolvedAt ? "not_returned" as const : "checked_out" as const : "available" as const };
}

export async function listMovements(db: Database, actor: ArchiveActor, input: { kind: "box" | "folder" | "document"; id: string; page: number }) {
  requireEditor(actor);
  const scope = input.kind === "box" ? await getBoxScope(db, input.id) : input.kind === "folder" ? await getFolderScope(db, input.id) : await getDocumentScope(db, input.id);
  await requireScope(db, actor, scope);
  const target = input.kind === "box" ? movementEvents.boxId : input.kind === "folder" ? movementEvents.folderId : movementEvents.documentId;
  const rows = await db.select({ id: movementEvents.id, source: movementEvents.source, destination: movementEvents.destination, reason: movementEvents.reason, occurredAt: movementEvents.occurredAt, actorName: user.name }).from(movementEvents).innerJoin(user, eq(movementEvents.actorId, user.id)).where(eq(target, input.id)).orderBy(movementEvents.occurredAt, movementEvents.id).limit(26).offset((input.page - 1) * 25);
  async function permittedSnapshot(value: unknown): Promise<unknown> {
    if (!value || typeof value !== "object") return value;
    const snapshot = value as Record<string, unknown>;
    try {
      if (typeof snapshot.boxId === "string") {
        await requireScope(db, actor, await getBoxScope(db, snapshot.boxId));
        const [box] = await db.select({ code: boxes.code }).from(boxes).where(eq(boxes.id, snapshot.boxId)).limit(1);
        return { ...snapshot, label: box?.code ?? "Unavailable" };
      }
      if (typeof snapshot.folderId === "string") {
        await requireScope(db, actor, await getFolderScope(db, snapshot.folderId));
        const [folder] = await db.select({ code: folders.code, name: folders.name }).from(folders).where(eq(folders.id, snapshot.folderId)).limit(1);
        return { ...snapshot, label: folder ? `${folder.code} — ${folder.name}` : "Unavailable" };
      }
      return value;
    } catch (error) { if (error instanceof ArchiveServiceError) return { redacted: true, location: "Unavailable" }; throw error; }
  }
  const items = [];
  for (const row of rows.slice(0, 25)) {
    const source = await permittedSnapshot(row.source); const destination = await permittedSnapshot(row.destination);
    const redacted = [source, destination].some((value) => value && typeof value === "object" && "redacted" in value);
    items.push({ ...row, source, destination, reason: redacted ? "Movement recorded" : row.reason });
  }
  return { items, hasMore: rows.length > 25 };
}

export async function listDocuments(db: Database, actor: ArchiveActor) {
  const rows = await db
    .select({ document: documents, folder: folders, box: boxes })
    .from(documents)
    .innerJoin(folders, eq(documents.folderId, folders.id))
    .innerJoin(boxes, eq(folders.boxId, boxes.id))
    .where(and(ne(documents.lifecycle, "retired"), ne(folders.lifecycle, "retired"), ne(boxes.lifecycle, "retired")))
    .orderBy(documents.code);
  const grants = actor.role === "admin" ? null : await grantsFor(db, actor.id);
  return rows
    .filter(
      (row) =>
        !grants ||
        scopeAllowed(actor, grants, {
          box: { id: row.box.id, confidentiality: row.box.confidentiality },
          folder: { id: row.folder.id, confidentiality: row.folder.confidentiality },
          document: { id: row.document.id, confidentiality: row.document.confidentiality },
        }),
    )
    .map((row) => ({ ...row.document, folderName: row.folder.name, boxCode: row.box.code }));
}

export async function createCategory(db: Database, actor: ArchiveActor, input: { code: string; name: string; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [category] = await tx.insert(categories).values({ code: input.code.trim(), normalizedCode, name: input.name.trim() }).returning();
    if (!category) throw new ArchiveServiceError("CONFLICT", "The category could not be created.");
    await audit(tx, { actorId: actor.id, action: "archive.category_created", targetType: "category", targetId: category.id, after: { code: category.code, name: category.name }, correlationId: input.correlationId });
    return category;
  });
}

export async function createLocation(db: Database, actor: ArchiveActor, input: { code: string; room: string; shelf: string; rack: string; position?: string | null; label: string; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [location] = await tx.insert(shelfLocations).values({ code: input.code.trim(), normalizedCode, position: input.position?.trim() || null, room: input.room.trim(), shelf: input.shelf.trim(), rack: input.rack.trim(), label: input.label.trim() }).returning();
    if (!location) throw new ArchiveServiceError("CONFLICT", "The location could not be created.");
    await audit(tx, { actorId: actor.id, action: "archive.location_created", targetType: "shelf_location", targetId: location.id, after: locationSnapshot(location), correlationId: input.correlationId });
    return location;
  });
}

export async function updateCategory(db: Database, actor: ArchiveActor, input: { id: string; code: string; name: string; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(categories).where(eq(categories.id, input.id)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    const [after] = await tx.update(categories).set({ code: input.code.trim(), normalizedCode, name: input.name.trim() }).where(eq(categories.id, input.id)).returning();
    if (!after) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: "archive.category_updated", targetType: "category", targetId: after.id, before: { code: before.code, name: before.name }, after: { code: after.code, name: after.name }, correlationId: input.correlationId });
    return after;
  });
}

export async function updateLocation(db: Database, actor: ArchiveActor, input: { id: string; code: string; room: string; shelf: string; rack: string; position?: string | null; label: string; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(shelfLocations).where(eq(shelfLocations.id, input.id)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    const [after] = await tx.update(shelfLocations).set({ code: input.code.trim(), normalizedCode, room: input.room.trim(), shelf: input.shelf.trim(), rack: input.rack.trim(), position: input.position?.trim() || null, label: input.label.trim() }).where(eq(shelfLocations.id, input.id)).returning();
    if (!after) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: "archive.location_updated", targetType: "shelf_location", targetId: after.id, before: locationSnapshot(before), after: locationSnapshot(after), correlationId: input.correlationId });
    return after;
  });
}

export async function createBox(db: Database, actor: ArchiveActor, input: { code: string; categoryId: string; shelfLocationId: string; confidentiality: Confidentiality; notes?: string | null; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [category] = await tx.select().from(categories).where(eq(categories.id, input.categoryId)).for("update").limit(1);
    const [location] = await tx.select().from(shelfLocations).where(eq(shelfLocations.id, input.shelfLocationId)).for("update").limit(1);
    if (!category?.active || !location?.active) throw new ArchiveServiceError("CONFLICT", "Choose an active category and shelf location.");
    const [box] = await tx.insert(boxes).values({ code: input.code.trim(), normalizedCode, categoryId: input.categoryId, shelfLocationId: input.shelfLocationId, confidentiality: input.confidentiality, notes: input.notes?.trim() || null }).returning();
    if (!box) throw new ArchiveServiceError("CONFLICT", "The box could not be created.");
    await audit(tx, { actorId: actor.id, action: "archive.box_created", targetType: "box", targetId: box.id, after: { code: box.code, confidentiality: box.confidentiality }, correlationId: input.correlationId });
    return box;
  });
}

export async function updateBoxDetails(db: Database, actor: ArchiveActor, input: { boxId: string; categoryId: string; confidentiality: Confidentiality; notes?: string | null; correlationId: string }) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(boxes).where(eq(boxes.id, input.boxId)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    if (before.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "Retired boxes cannot be edited.");
    const [category] = await tx.select().from(categories).where(eq(categories.id, input.categoryId)).for("update").limit(1);
    if (!category?.active && input.categoryId !== before.categoryId) throw new ArchiveServiceError("CONFLICT", "Choose an active category.");
    const [after] = await tx.update(boxes).set({ categoryId: input.categoryId, confidentiality: input.confidentiality, notes: input.notes?.trim() || null }).where(eq(boxes.id, input.boxId)).returning();
    if (!after) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: "archive.box_updated", targetType: "box", targetId: after.id, before: { categoryId: before.categoryId, confidentiality: before.confidentiality, notes: before.notes }, after: { categoryId: after.categoryId, confidentiality: after.confidentiality, notes: after.notes }, correlationId: input.correlationId });
    return after;
  });
}

export async function setReferenceActive(db: Database, actor: ArchiveActor, input: { kind: "category" | "location"; id: string; active: boolean; correlationId: string }) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    if (input.kind === "category") {
      const [before] = await tx.select().from(categories).where(eq(categories.id, input.id)).for("update").limit(1);
      if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
      const [after] = await tx.update(categories).set({ active: input.active }).where(eq(categories.id, input.id)).returning();
      await audit(tx, { actorId: actor.id, action: "archive.category_status_changed", targetType: "category", targetId: input.id, before: { active: before.active }, after: { active: input.active }, correlationId: input.correlationId });
      return after;
    }
    const [before] = await tx.select().from(shelfLocations).where(eq(shelfLocations.id, input.id)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    const [after] = await tx.update(shelfLocations).set({ active: input.active }).where(eq(shelfLocations.id, input.id)).returning();
    await audit(tx, { actorId: actor.id, action: "archive.location_status_changed", targetType: "shelf_location", targetId: input.id, before: { active: before.active }, after: { active: input.active }, correlationId: input.correlationId });
    return after;
  });
}

export async function createFolder(db: Database, actor: ArchiveActor, input: { boxId: string; code: string; name: string; color: FolderColor; isTemplateFolder?: boolean; urgency?: string | null; notes?: string | null; confidentiality: Confidentiality; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [parent] = await tx.select().from(boxes).where(eq(boxes.id, input.boxId)).for("update").limit(1);
    if (!parent) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    if (parent.lifecycle !== "active") throw new ArchiveServiceError("CONFLICT", "Reactivate the box before filing a folder.");
    const [folder] = await tx.insert(folders).values({ boxId: input.boxId, code: input.code.trim(), normalizedCode, name: input.name.trim(), color: input.color, isTemplateFolder: input.isTemplateFolder ?? false, urgency: input.urgency?.trim() || null, notes: input.notes?.trim() || null, confidentiality: input.confidentiality }).returning();
    if (!folder) throw new ArchiveServiceError("CONFLICT", "The folder could not be created.");
    await audit(tx, { actorId: actor.id, action: "archive.folder_created", targetType: "folder", targetId: folder.id, after: { code: folder.code, boxId: folder.boxId }, correlationId: input.correlationId });
    return folder;
  });
}

export async function createDocument(db: Database, actor: ArchiveActor, input: { folderId: string; code: string; title: string; documentDate?: string | null; coveredPeriod?: string | null; keywords?: string | null; description?: string | null; digitalUrl?: string | null; confidentiality: Confidentiality; correlationId: string }) {
  requireEditor(actor);
  await requireScope(db, actor, await getFolderScope(db, input.folderId));
  const normalizedCode = normalizeCode(input.code);
  const digitalUrl = validateApprovedUrl(input.digitalUrl);
  return db.transaction(async (tx) => {
    const [parent] = await tx.select({ folder: folders, box: boxes }).from(folders).innerJoin(boxes, eq(folders.boxId, boxes.id)).where(eq(folders.id, input.folderId)).for("update").limit(1);
    if (!parent) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await requireScope(tx, actor, { box: { id: parent.box.id, confidentiality: parent.box.confidentiality }, folder: { id: parent.folder.id, confidentiality: parent.folder.confidentiality } });
    if (parent.folder.lifecycle !== "active" || parent.box.lifecycle !== "active") throw new ArchiveServiceError("CONFLICT", "Reactivate the folder and box before filing a document.");
    const [document] = await tx.insert(documents).values({ folderId: input.folderId, code: input.code.trim(), normalizedCode, title: input.title.trim(), documentDate: input.documentDate || null, coveredPeriod: input.coveredPeriod?.trim() || null, keywords: input.keywords?.trim() || null, description: input.description?.trim() || null, digitalUrl, confidentiality: input.confidentiality }).returning();
    if (!document) throw new ArchiveServiceError("CONFLICT", "The document could not be created.");
    await audit(tx, { actorId: actor.id, action: "archive.document_created", targetType: "document", targetId: document.id, after: { code: document.code, folderId: document.folderId }, correlationId: input.correlationId });
    return document;
  });
}

export async function updateBoxCode(db: Database, actor: ArchiveActor, input: { boxId: string; code: string; correlationId: string }) {
  requireAdmin(actor);
  const scope = await getBoxScope(db, input.boxId);
  await requireScope(db, actor, scope);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(boxes).where(eq(boxes.id, input.boxId)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    if (before.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "Retired box codes cannot be changed.");
    const [box] = await tx.update(boxes).set({ code: input.code.trim(), normalizedCode }).where(eq(boxes.id, input.boxId)).returning();
    if (!box) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: "archive.box_code_changed", targetType: "box", targetId: box.id, before: { code: before.code }, after: { code: box.code }, correlationId: input.correlationId });
    return box;
  });
}

export async function updateFolder(db: Database, actor: ArchiveActor, input: { id: string; code?: string; isTemplateFolder?: boolean; name: string; color: FolderColor; urgency?: string | null; notes?: string | null; confidentiality: Confidentiality; correlationId: string }) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(folders).where(eq(folders.id, input.id)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    if (before.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "Retired folders cannot be edited.");
    if (input.isTemplateFolder === false && before.isTemplateFolder) {
      const [stock] = await tx.select({ id: templateInventory.id }).from(templateInventory).where(eq(templateInventory.folderId, input.id)).limit(1);
      if (stock) throw new ArchiveServiceError("CONFLICT", "This folder has inventory history and must remain a template folder.");
    }
    const afterValues = { code: input.code?.trim() ?? before.code, normalizedCode: normalizeCode(input.code ?? before.code), isTemplateFolder: input.isTemplateFolder ?? before.isTemplateFolder, name: input.name.trim(), color: input.color, urgency: input.urgency?.trim() || null, notes: input.notes?.trim() || null, confidentiality: input.confidentiality };
    const [after] = await tx.update(folders).set(afterValues).where(eq(folders.id, input.id)).returning();
    await audit(tx, { actorId: actor.id, action: "archive.folder_updated", targetType: "folder", targetId: input.id, before: { code: before.code, isTemplateFolder: before.isTemplateFolder, name: before.name, color: before.color, urgency: before.urgency, notes: before.notes, confidentiality: before.confidentiality }, after: afterValues, correlationId: input.correlationId });
    return after!;
  });
}

export async function updateDocument(db: Database, actor: ArchiveActor, input: { id: string; code?: string; title: string; documentDate?: string | null; coveredPeriod?: string | null; keywords?: string | null; description?: string | null; digitalUrl?: string | null; confidentiality: Confidentiality; correlationId: string }) {
  requireEditor(actor);
  const digitalUrl = validateApprovedUrl(input.digitalUrl);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(documents).where(eq(documents.id, input.id)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await requireScope(tx, actor, await getDocumentScope(tx, input.id));
    if (before.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "Retired documents cannot be edited.");
    if (actor.role !== "admin" && before.confidentiality === "restricted" && input.confidentiality === "internal") throw new ArchiveServiceError("FORBIDDEN", "Only an Administrator may reduce confidentiality.");
    const afterValues = { code: input.code?.trim() ?? before.code, normalizedCode: normalizeCode(input.code ?? before.code), title: input.title.trim(), documentDate: input.documentDate || null, coveredPeriod: input.coveredPeriod?.trim() || null, keywords: input.keywords?.trim() || null, description: input.description?.trim() || null, digitalUrl, confidentiality: input.confidentiality };
    const [after] = await tx.update(documents).set(afterValues).where(eq(documents.id, input.id)).returning();
    await audit(tx, { actorId: actor.id, action: "archive.document_updated", targetType: "document", targetId: input.id, before: { code: before.code, title: before.title, documentDate: before.documentDate, coveredPeriod: before.coveredPeriod, keywords: before.keywords, description: before.description, digitalUrl: before.digitalUrl, confidentiality: before.confidentiality }, after: afterValues, correlationId: input.correlationId });
    return after!;
  });
}

export async function relocateBox(db: Database, actor: ArchiveActor, input: { boxId: string; shelfLocationId: string; reason: string; correlationId: string }) {
  requireEditor(actor);
  const scope = await getBoxScope(db, input.boxId);
  await requireScope(db, actor, scope);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ box: boxes, location: shelfLocations })
      .from(boxes)
      .innerJoin(shelfLocations, eq(boxes.shelfLocationId, shelfLocations.id))
      .where(eq(boxes.id, input.boxId))
      .for("update", { of: boxes })
      .limit(1);
    const [destination] = await tx.select().from(shelfLocations).where(eq(shelfLocations.id, input.shelfLocationId)).for("update").limit(1);
    if (!current || !destination) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await requireScope(tx, actor, { box: { id: current.box.id, confidentiality: current.box.confidentiality } });
    if (current.box.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "Retired boxes cannot be relocated.");
    if (!destination.active) throw new ArchiveServiceError("CONFLICT", "The destination is inactive.");
    const [box] = await tx.update(boxes).set({ shelfLocationId: destination.id }).where(eq(boxes.id, input.boxId)).returning();
    if (!box) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await tx.insert(movementEvents).values({ boxId: box.id, source: locationSnapshot(current.location), destination: locationSnapshot(destination), reason: input.reason.trim(), actorId: actor.id });
    await audit(tx, { actorId: actor.id, action: "archive.box_relocated", targetType: "box", targetId: box.id, before: { shelfLocationId: current.location.id }, after: { shelfLocationId: destination.id }, correlationId: input.correlationId });
    return box;
  });
}

export async function relocateFolder(db: Database, actor: ArchiveActor, input: { folderId: string; boxId: string; reason: string; correlationId: string }) {
  requireEditor(actor);
  const sourceScope = await getFolderScope(db, input.folderId);
  const destinationScope = await getBoxScope(db, input.boxId);
  await requireScope(db, actor, sourceScope);
  await requireScope(db, actor, destinationScope);
  if (actor.role !== "admin" && sourceScope.box.confidentiality === "restricted" && destinationScope.box.confidentiality === "internal") {
    throw new ArchiveServiceError("FORBIDDEN", "An Administrator must review a move into less restrictive ancestry.");
  }
  return db.transaction(async (tx) => {
    const locked = await tx.select().from(boxes).where(inArray(boxes.id, [...new Set([sourceScope.box.id, input.boxId])])).orderBy(boxes.id).for("update");
    const [current] = await tx.select().from(folders).where(eq(folders.id, input.folderId)).for("update").limit(1);
    if (!current || current.boxId !== sourceScope.box.id) throw new ArchiveServiceError("CONFLICT", "The folder location changed. Retry the operation.");
    const destination = locked.find((box) => box.id === input.boxId);
    if (!destination || destination.lifecycle !== "active" || current.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "The destination must be active and the folder must not be retired.");
    await requireScope(tx, actor, { box: { id: destination.id, confidentiality: destination.confidentiality } });
    await requireScope(tx, actor, { box: sourceScope.box, folder: { id: current.id, confidentiality: current.confidentiality } });
    const [folder] = await tx.update(folders).set({ boxId: input.boxId }).where(eq(folders.id, input.folderId)).returning();
    if (!folder) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await tx.insert(movementEvents).values({ folderId: folder.id, source: { boxId: sourceScope.box.id }, destination: { boxId: input.boxId }, reason: input.reason.trim(), actorId: actor.id });
    await audit(tx, { actorId: actor.id, action: "archive.folder_relocated", targetType: "folder", targetId: folder.id, before: { boxId: sourceScope.box.id }, after: { boxId: input.boxId }, correlationId: input.correlationId });
    return folder;
  });
}

export async function refileDocument(db: Database, actor: ArchiveActor, input: { documentId: string; folderId: string; reason: string; correlationId: string }) {
  requireEditor(actor);
  return db.transaction(async (tx) => {
    const [source] = await tx.select({ id: documents.id, lifecycle: documents.lifecycle }).from(documents).where(eq(documents.id, input.documentId)).for("update");
    if (!source) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    if (source.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "Reactivate the document before refiling it.");
    const sourceScope = await getDocumentScope(tx, input.documentId);
    const destinationScope = await getFolderScope(tx, input.folderId);
    const lockedBoxes = await tx.select().from(boxes).where(inArray(boxes.id, [...new Set([sourceScope.box.id, destinationScope.box.id])])).orderBy(boxes.id).for("update");
    if ((await getDocumentScope(tx, input.documentId)).box.id !== sourceScope.box.id || (await getFolderScope(tx, input.folderId)).box.id !== destinationScope.box.id) throw new ArchiveServiceError("CONFLICT", "A folder location changed. Retry the operation.");
    if (lockedBoxes.find((box) => box.id === sourceScope.box.id)?.lifecycle === "retired") throw new ArchiveServiceError("CONFLICT", "Reactivate the source box before refiling this document.");
    await requireScope(tx, actor, sourceScope);
    await requireScope(tx, actor, destinationScope);
    if (actor.role !== "admin" && ((sourceScope.box.confidentiality === "restricted" && destinationScope.box.confidentiality === "internal") || (sourceScope.folder?.confidentiality === "restricted" && destinationScope.folder?.confidentiality === "internal"))) {
      throw new ArchiveServiceError("FORBIDDEN", "An Administrator must review a move into less restrictive ancestry.");
    }
    const [destination] = await tx.select({ folder: folders, box: boxes }).from(folders).innerJoin(boxes, eq(folders.boxId, boxes.id)).where(eq(folders.id, input.folderId)).for("update").limit(1);
    if (!destination || destination.folder.lifecycle !== "active" || destination.box.lifecycle !== "active") throw new ArchiveServiceError("CONFLICT", "The destination must be active.");
    const [openLoan] = await tx.select({ id: documentCheckouts.id }).from(documentCheckouts).where(and(eq(documentCheckouts.documentId, input.documentId), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
    if (openLoan) throw new ArchiveServiceError("CONFLICT", "Return the document and resolve any outstanding exception before refiling.");
    const [document] = await tx.update(documents).set({ folderId: input.folderId }).where(eq(documents.id, input.documentId)).returning();
    if (!document) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await tx.insert(movementEvents).values({ documentId: document.id, source: { folderId: sourceScope.folder!.id }, destination: { folderId: input.folderId }, reason: input.reason.trim(), actorId: actor.id });
    await audit(tx, { actorId: actor.id, action: "archive.document_refiled", targetType: "document", targetId: document.id, before: { folderId: sourceScope.folder!.id }, after: { folderId: input.folderId }, correlationId: input.correlationId });
    return document;
  });
}

export async function grantAccess(db: Database, actor: ArchiveActor, input: { userId: string; boxId?: string; folderId?: string; documentId?: string; correlationId: string }) {
  requireAdmin(actor);
  const targets = [input.boxId, input.folderId, input.documentId].filter(Boolean);
  if (targets.length !== 1) throw new ArchiveServiceError("VALIDATION", "Select exactly one grant target.");
  return db.transaction(async (tx) => {
    const [grant] = await tx.insert(accessGrants).values({ userId: input.userId, boxId: input.boxId, folderId: input.folderId, documentId: input.documentId, grantedBy: actor.id }).returning();
    if (!grant) throw new ArchiveServiceError("CONFLICT", "The grant could not be created.");
    await audit(tx, { actorId: actor.id, action: "identity.access_granted", targetType: "access_grant", targetId: grant.id, after: { userId: grant.userId, boxId: grant.boxId, folderId: grant.folderId, documentId: grant.documentId }, correlationId: input.correlationId });
    return grant;
  });
}

export async function revokeAccess(db: Database, actor: ArchiveActor, input: { grantId: string; correlationId: string }) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const [grant] = await tx.select().from(accessGrants).where(eq(accessGrants.id, input.grantId)).limit(1);
    if (!grant || !grant.active) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await tx.update(accessGrants).set({ active: false, revokedAt: new Date() }).where(eq(accessGrants.id, input.grantId));
    await audit(tx, { actorId: actor.id, action: "identity.access_revoked", targetType: "access_grant", targetId: grant.id, before: { userId: grant.userId, boxId: grant.boxId, folderId: grant.folderId, documentId: grant.documentId }, correlationId: input.correlationId });
  });
}

export async function setBoxLifecycle(db: Database, actor: ArchiveActor, input: { boxId: string; lifecycle: RecordLifecycle; correlationId: string }) {
  requireAdmin(actor);
  const scope = await getBoxScope(db, input.boxId);
  await requireScope(db, actor, scope);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(boxes).where(eq(boxes.id, input.boxId)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    if (input.lifecycle === "retired") {
      const [remainingInventory] = await tx.select({ id: templateInventory.id }).from(templateInventory).innerJoin(folders, eq(templateInventory.folderId, folders.id)).where(and(eq(folders.boxId, input.boxId), gt(templateInventory.count, 0))).limit(1);
      if (remainingInventory) throw new ArchiveServiceError("CONFLICT", "Move, issue, or resolve remaining template inventory before retiring this box.");
      const [openLoan] = await tx.select({ id: documentCheckouts.id }).from(documentCheckouts).innerJoin(documents, eq(documentCheckouts.documentId, documents.id)).innerJoin(folders, eq(documents.folderId, folders.id)).where(and(eq(folders.boxId, input.boxId), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
      if (openLoan) throw new ArchiveServiceError("CONFLICT", "Return outstanding loans and resolve exceptions on returned items before retiring this box.");
      const [activeRequest] = await tx.select({ id: requestItems.id }).from(requestItems).innerJoin(documents, eq(requestItems.documentId, documents.id)).innerJoin(folders, eq(documents.folderId, folders.id)).where(and(eq(folders.boxId, input.boxId), inArray(requestItems.status, ["pending", "approved"]))).limit(1);
      if (activeRequest) throw new ArchiveServiceError("CONFLICT", "Resolve active request lines before retiring this box.");
      const [activeFolder] = await tx.select({ id: folders.id }).from(folders).where(and(eq(folders.boxId, input.boxId), eq(folders.lifecycle, "active"))).limit(1);
      if (activeFolder) throw new ArchiveServiceError("CONFLICT", "Retire or relocate active folders before retiring this box.");
    }
    const [box] = await tx.update(boxes).set({ lifecycle: input.lifecycle }).where(eq(boxes.id, input.boxId)).returning();
    if (!box) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: `archive.box_${input.lifecycle}`, targetType: "box", targetId: box.id, before: before ? { lifecycle: before.lifecycle } : undefined, after: { lifecycle: box.lifecycle }, correlationId: input.correlationId });
    return box;
  });
}

export async function setFolderLifecycle(db: Database, actor: ArchiveActor, input: { folderId: string; lifecycle: RecordLifecycle; correlationId: string }) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const initial = await getFolderScope(tx, input.folderId);
    await tx.select({ id: boxes.id }).from(boxes).where(eq(boxes.id, initial.box.id)).for("update");
    const [before] = await tx.select().from(folders).where(eq(folders.id, input.folderId)).for("update").limit(1);
    if (!before || before.boxId !== initial.box.id) throw new ArchiveServiceError("CONFLICT", "The folder location changed. Retry the operation.");
    const [parent] = await tx.select().from(boxes).where(eq(boxes.id, before.boxId)).limit(1);
    if (input.lifecycle === "active" && parent?.lifecycle !== "active") throw new ArchiveServiceError("CONFLICT", "Reactivate the box before the folder.");
    if (input.lifecycle === "retired") {
      const [stock] = await tx.select({ id: templateInventory.id }).from(templateInventory).where(and(eq(templateInventory.folderId, before.id), gt(templateInventory.count, 0))).limit(1);
      if (stock) throw new ArchiveServiceError("CONFLICT", "Move, issue, or resolve remaining template inventory before retiring this folder.");
      const [loan] = await tx.select({ id: documentCheckouts.id }).from(documentCheckouts).innerJoin(documents, eq(documentCheckouts.documentId, documents.id)).where(and(eq(documents.folderId, before.id), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
      if (loan) throw new ArchiveServiceError("CONFLICT", "Return outstanding loans and resolve exceptions on returned items before retiring this folder.");
      const [request] = await tx.select({ id: requestItems.id }).from(requestItems).innerJoin(documents, eq(requestItems.documentId, documents.id)).where(and(eq(documents.folderId, before.id), inArray(requestItems.status, ["pending", "approved"]))).limit(1);
      if (request) throw new ArchiveServiceError("CONFLICT", "Resolve active request lines before retiring this folder.");
      const [activeDocument] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.folderId, before.id), eq(documents.lifecycle, "active"))).limit(1);
      if (activeDocument) throw new ArchiveServiceError("CONFLICT", "Retire or relocate active documents before retiring this folder.");
    }
    const [folder] = await tx.update(folders).set({ lifecycle: input.lifecycle }).where(eq(folders.id, before.id)).returning();
    if (!folder) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: `archive.folder_${input.lifecycle}`, targetType: "folder", targetId: folder.id, before: { lifecycle: before.lifecycle }, after: { lifecycle: folder.lifecycle }, correlationId: input.correlationId });
    return folder;
  });
}

export async function setDocumentLifecycle(db: Database, actor: ArchiveActor, input: { documentId: string; lifecycle: RecordLifecycle; correlationId: string }) {
  requireAdmin(actor);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(documents).where(eq(documents.id, input.documentId)).for("update").limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    const initial = await getDocumentScope(tx, input.documentId);
    await tx.select({ id: boxes.id }).from(boxes).where(eq(boxes.id, initial.box.id)).for("update");
    const [parent] = await tx.select({ folder: folders, box: boxes }).from(folders).innerJoin(boxes, eq(folders.boxId, boxes.id)).where(eq(folders.id, before.folderId)).limit(1);
    if (!parent || parent.box.id !== initial.box.id) throw new ArchiveServiceError("CONFLICT", "The record location changed. Retry the operation.");
    if (input.lifecycle === "active" && (parent.folder.lifecycle !== "active" || parent.box.lifecycle !== "active")) throw new ArchiveServiceError("CONFLICT", "Reactivate the box and folder before the document.");
    if (input.lifecycle === "retired") {
      const [loan] = await tx.select({ id: documentCheckouts.id }).from(documentCheckouts).where(and(eq(documentCheckouts.documentId, before.id), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
      if (loan) throw new ArchiveServiceError("CONFLICT", "Return the outstanding loan and resolve any exception before retiring this document.");
      const [request] = await tx.select({ id: requestItems.id }).from(requestItems).where(and(eq(requestItems.documentId, before.id), inArray(requestItems.status, ["pending", "approved"]))).limit(1);
      if (request) throw new ArchiveServiceError("CONFLICT", "Resolve active request lines before retiring this document.");
    }
    const [document] = await tx.update(documents).set({ lifecycle: input.lifecycle }).where(eq(documents.id, before.id)).returning();
    if (!document) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: `archive.document_${input.lifecycle}`, targetType: "document", targetId: document.id, before: { lifecycle: before.lifecycle }, after: { lifecycle: document.lifecycle }, correlationId: input.correlationId });
    return document;
  });
}
