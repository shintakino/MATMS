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
import { templateInventory } from "@matms/db/schema/inventory";
import type { Confidentiality, FolderColor, RecordLifecycle } from "@matms/db/schema/archive";
import { and, eq, gt } from "drizzle-orm";

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

async function grantsFor(db: Database, userId: string): Promise<GrantSet> {
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

async function getFolderScope(db: Database, id: string): Promise<Scope> {
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

async function getDocumentScope(db: Database, id: string): Promise<Scope> {
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

async function requireScope(db: Database, actor: ArchiveActor, scope: Scope) {
  if (!scopeAllowed(actor, await grantsFor(db, actor.id), scope)) {
    throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  }
}

/** Shared inventory/custody boundary: a folder must be visible, active, and designated for templates. */
export async function requireActiveTemplateFolder(db: Database, actor: ArchiveActor, folderId: string) {
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
  const folderRows = await db.select().from(folders).where(eq(folders.boxId, id)).orderBy(folders.code);
  const visibleFolders = folderRows.filter(
    (folder) => !grants || scopeAllowed(actor, grants, { ...scope, folder: { id: folder.id, confidentiality: folder.confidentiality } }),
  );
  return { ...box.box, categoryName: box.category.name, location: box.location, folders: visibleFolders };
}

export async function getFolder(db: Database, actor: ArchiveActor, id: string) {
  const scope = await getFolderScope(db, id);
  await requireScope(db, actor, scope);
  const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  if (!folder) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  const grants = actor.role === "admin" ? null : await grantsFor(db, actor.id);
  const documentRows = await db.select().from(documents).where(eq(documents.folderId, id)).orderBy(documents.code);
  return {
    folder,
    documents: documentRows.filter(
      (document) =>
        !grants || scopeAllowed(actor, grants, { ...scope, document: { id: document.id, confidentiality: document.confidentiality } }),
    ),
  };
}

export async function getDocument(db: Database, actor: ArchiveActor, id: string) {
  const scope = await getDocumentScope(db, id);
  await requireScope(db, actor, scope);
  const [document] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!document) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  return document;
}

export async function listDocuments(db: Database, actor: ArchiveActor) {
  const rows = await db
    .select({ document: documents, folder: folders, box: boxes })
    .from(documents)
    .innerJoin(folders, eq(documents.folderId, folders.id))
    .innerJoin(boxes, eq(folders.boxId, boxes.id))
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

export async function createBox(db: Database, actor: ArchiveActor, input: { code: string; categoryId: string; shelfLocationId: string; confidentiality: Confidentiality; notes?: string | null; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
    const [box] = await tx.insert(boxes).values({ code: input.code.trim(), normalizedCode, categoryId: input.categoryId, shelfLocationId: input.shelfLocationId, confidentiality: input.confidentiality, notes: input.notes?.trim() || null }).returning();
    if (!box) throw new ArchiveServiceError("CONFLICT", "The box could not be created.");
    await audit(tx, { actorId: actor.id, action: "archive.box_created", targetType: "box", targetId: box.id, after: { code: box.code, confidentiality: box.confidentiality }, correlationId: input.correlationId });
    return box;
  });
}

export async function createFolder(db: Database, actor: ArchiveActor, input: { boxId: string; code: string; name: string; color: FolderColor; isTemplateFolder?: boolean; urgency?: string | null; notes?: string | null; confidentiality: Confidentiality; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  return db.transaction(async (tx) => {
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
    const [before] = await tx.select().from(boxes).where(eq(boxes.id, input.boxId)).limit(1);
    if (!before) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    const [box] = await tx.update(boxes).set({ code: input.code.trim(), normalizedCode }).where(eq(boxes.id, input.boxId)).returning();
    if (!box) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: "archive.box_code_changed", targetType: "box", targetId: box.id, before: { code: before.code }, after: { code: box.code }, correlationId: input.correlationId });
    return box;
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
      .limit(1);
    const [destination] = await tx.select().from(shelfLocations).where(eq(shelfLocations.id, input.shelfLocationId)).limit(1);
    if (!current || !destination) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
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
    const [folder] = await tx.update(folders).set({ boxId: input.boxId }).where(eq(folders.id, input.folderId)).returning();
    if (!folder) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await tx.insert(movementEvents).values({ folderId: folder.id, source: { boxId: sourceScope.box.id }, destination: { boxId: input.boxId }, reason: input.reason.trim(), actorId: actor.id });
    await audit(tx, { actorId: actor.id, action: "archive.folder_relocated", targetType: "folder", targetId: folder.id, before: { boxId: sourceScope.box.id }, after: { boxId: input.boxId }, correlationId: input.correlationId });
    return folder;
  });
}

export async function refileDocument(db: Database, actor: ArchiveActor, input: { documentId: string; folderId: string; reason: string; correlationId: string }) {
  requireEditor(actor);
  const sourceScope = await getDocumentScope(db, input.documentId);
  const destinationScope = await getFolderScope(db, input.folderId);
  await requireScope(db, actor, sourceScope);
  await requireScope(db, actor, destinationScope);
  if (actor.role !== "admin" && sourceScope.box.confidentiality === "restricted" && destinationScope.box.confidentiality === "internal") {
    throw new ArchiveServiceError("FORBIDDEN", "An Administrator must review a move into less restrictive ancestry.");
  }
  return db.transaction(async (tx) => {
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
  if (input.lifecycle === "retired") {
    const activeFolders = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.boxId, input.boxId), eq(folders.lifecycle, "active"))).limit(1);
    if (activeFolders.length) throw new ArchiveServiceError("CONFLICT", "Retire or relocate active folders before retiring this box.");
    const remainingInventory = await db
      .select({ id: templateInventory.id })
      .from(templateInventory)
      .innerJoin(folders, eq(templateInventory.folderId, folders.id))
      .where(and(eq(folders.boxId, input.boxId), gt(templateInventory.count, 0)))
      .limit(1);
    if (remainingInventory.length) {
      throw new ArchiveServiceError("CONFLICT", "Move, issue, or resolve remaining template inventory before retiring this box.");
    }
  }
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(boxes).where(eq(boxes.id, input.boxId)).limit(1);
    const [box] = await tx.update(boxes).set({ lifecycle: input.lifecycle }).where(eq(boxes.id, input.boxId)).returning();
    if (!box) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
    await audit(tx, { actorId: actor.id, action: `archive.box_${input.lifecycle}`, targetType: "box", targetId: box.id, before: before ? { lifecycle: before.lifecycle } : undefined, after: { lifecycle: box.lifecycle }, correlationId: input.correlationId });
    return box;
  });
}
