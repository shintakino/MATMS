import { writeAuditEntry } from "@matms/db";
import type { AuditEntry, AuditTransaction, Database } from "@matms/db";
import { boxes, folders } from "@matms/db/schema/archive";
import {
  stockOperations,
  stockTransactions,
  templateInventory,
  templates,
} from "@matms/db/schema/inventory";
import { and, eq, gte, sql } from "drizzle-orm";

import { ArchiveServiceError, normalizeCode, requireActiveTemplateFolder, validateApprovedUrl } from "./archive-service";
import type { ArchiveActor } from "./archive-service";

export class InventoryServiceError extends Error {
  public constructor(public readonly code: "FORBIDDEN" | "CONFLICT" | "INSUFFICIENT_STOCK" | "VALIDATION" | "UNAVAILABLE", message: string) {
    super(message);
    this.name = "InventoryServiceError";
  }
}

type StockResult = { operationId: string; balances: Array<{ inventoryId: string; count: number; version: number }> };
type StockType = "receive" | "issue" | "transfer" | "correct";

function requireStockOperator(actor: ArchiveActor) {
  if (actor.role === "viewer") throw new InventoryServiceError("FORBIDDEN", "This action is unavailable.");
}

function requireAdmin(actor: ArchiveActor) {
  if (actor.role !== "admin") throw new InventoryServiceError("FORBIDDEN", "This action is unavailable.");
}

function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new InventoryServiceError("VALIDATION", "Quantity must be a positive whole number.");
}

function nonnegativeInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new InventoryServiceError("VALIDATION", "Count must be a nonnegative whole number.");
}

async function fingerprint(value: object) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function priorOperation(tx: AuditTransaction, operationId: string, payloadFingerprint: string): Promise<StockResult | null> {
  const [operation] = await tx.select().from(stockOperations).where(eq(stockOperations.operationId, operationId)).limit(1);
  if (!operation) return null;
  if (operation.payloadFingerprint !== payloadFingerprint) throw new InventoryServiceError("CONFLICT", "This operation ID was already used for a different request.");
  return operation.result as StockResult;
}

async function persistOperation(tx: AuditTransaction, input: { operationId: string; actorId: string; type: StockType; reason: string; reference?: string | null; fingerprint: string; result: StockResult }) {
  const [operation] = await tx.insert(stockOperations).values({ operationId: input.operationId, actorId: input.actorId, operationType: input.type, reason: input.reason, reference: input.reference?.trim() || null, payloadFingerprint: input.fingerprint, result: input.result }).returning();
  if (!operation) throw new InventoryServiceError("CONFLICT", "The stock operation could not be recorded.");
  return operation;
}

async function writeLedger(tx: AuditTransaction, operationId: string, inventoryId: string, delta: number, balanceAfter: number) {
  await tx.insert(stockTransactions).values({ stockOperationId: operationId, inventoryId, delta, balanceBefore: balanceAfter - delta, balanceAfter });
}

async function audit(tx: AuditTransaction, entry: Omit<AuditEntry, "actorId"> & { actorId: string }) {
  await writeAuditEntry(tx, entry);
}

async function inventoryForMutation(db: Database, actor: ArchiveActor, inventoryId: string) {
  const [row] = await db
    .select({ inventory: templateInventory, template: templates, folder: folders, box: boxes })
    .from(templateInventory)
    .innerJoin(templates, eq(templateInventory.templateId, templates.id))
    .innerJoin(folders, eq(templateInventory.folderId, folders.id))
    .innerJoin(boxes, eq(folders.boxId, boxes.id))
    .where(eq(templateInventory.id, inventoryId))
    .limit(1);
  if (!row) throw new InventoryServiceError("UNAVAILABLE", "This inventory line is unavailable.");
  try {
    await requireActiveTemplateFolder(db, actor, row.inventory.folderId);
  } catch (error) {
    if (error instanceof ArchiveServiceError) throw new InventoryServiceError(error.code === "UNAVAILABLE" ? "UNAVAILABLE" : error.code === "FORBIDDEN" ? "FORBIDDEN" : "CONFLICT", error.message);
    throw error;
  }
  if (row.template.status === "retired") throw new InventoryServiceError("CONFLICT", "Retired template revisions cannot be moved.");
  return row;
}

export async function createTemplate(db: Database, actor: ArchiveActor, input: { code: string; familyCode: string; name: string; description?: string | null; categoryId: string; revisionLabel: string; revisionDate?: string | null; digitalUrl: string; supersedesId?: string | null; correlationId: string }) {
  requireAdmin(actor);
  const normalizedCode = normalizeCode(input.code);
  const familyCode = normalizeCode(input.familyCode);
  const digitalUrl = validateApprovedUrl(input.digitalUrl);
  return db.transaction(async (tx) => {
    const [template] = await tx.insert(templates).values({ code: input.code.trim(), normalizedCode, familyCode, name: input.name.trim(), description: input.description?.trim() || null, categoryId: input.categoryId, revisionLabel: input.revisionLabel.trim(), revisionDate: input.revisionDate || null, digitalUrl: digitalUrl!, supersedesId: input.supersedesId || null }).returning();
    if (!template) throw new InventoryServiceError("CONFLICT", "The template could not be created.");
    await audit(tx, { actorId: actor.id, action: "inventory.template_created", targetType: "template", targetId: template.id, after: { code: template.code, familyCode: template.familyCode, revisionLabel: template.revisionLabel }, correlationId: input.correlationId });
    return template;
  });
}

export async function createInventoryLine(db: Database, actor: ArchiveActor, input: { templateId: string; folderId: string; threshold?: number; correlationId: string }) {
  requireAdmin(actor);
  nonnegativeInteger(input.threshold ?? 5);
  await requireActiveTemplateFolder(db, actor, input.folderId);
  return db.transaction(async (tx) => {
    const [line] = await tx.insert(templateInventory).values({ templateId: input.templateId, folderId: input.folderId, threshold: input.threshold ?? 5 }).returning();
    if (!line) throw new InventoryServiceError("CONFLICT", "The inventory line could not be created.");
    await audit(tx, { actorId: actor.id, action: "inventory.line_created", targetType: "template_inventory", targetId: line.id, after: { templateId: line.templateId, folderId: line.folderId, threshold: line.threshold }, correlationId: input.correlationId });
    return line;
  });
}

export async function receiveStock(db: Database, actor: ArchiveActor, input: { inventoryId: string; quantity: number; reason: string; reference?: string | null; operationId: string; correlationId: string }) {
  requireStockOperator(actor);
  positiveInteger(input.quantity);
  await inventoryForMutation(db, actor, input.inventoryId);
  const payloadFingerprint = await fingerprint({ actorId: actor.id, type: "receive", inventoryId: input.inventoryId, quantity: input.quantity, reason: input.reason, reference: input.reference ?? null });
  return db.transaction(async (tx) => {
    const prior = await priorOperation(tx, input.operationId, payloadFingerprint);
    if (prior) return prior;
    const [line] = await tx.update(templateInventory).set({ count: sql`${templateInventory.count} + ${input.quantity}`, version: sql`${templateInventory.version} + 1` }).where(eq(templateInventory.id, input.inventoryId)).returning();
    if (!line) throw new InventoryServiceError("UNAVAILABLE", "This inventory line is unavailable.");
    const result: StockResult = { operationId: input.operationId, balances: [{ inventoryId: line.id, count: line.count, version: line.version }] };
    const operation = await persistOperation(tx, { operationId: input.operationId, actorId: actor.id, type: "receive", reason: input.reason.trim(), reference: input.reference, fingerprint: payloadFingerprint, result });
    await writeLedger(tx, operation.id, line.id, input.quantity, line.count);
    await audit(tx, { actorId: actor.id, action: "inventory.received", targetType: "template_inventory", targetId: line.id, after: { quantity: input.quantity, count: line.count }, correlationId: input.correlationId });
    return result;
  });
}

export async function issueStock(db: Database, actor: ArchiveActor, input: { inventoryId: string; quantity: number; reason: string; reference?: string | null; supersededDecision?: string | null; operationId: string; correlationId: string }) {
  requireStockOperator(actor);
  positiveInteger(input.quantity);
  const source = await inventoryForMutation(db, actor, input.inventoryId);
  if (source.template.status === "superseded" && (actor.role !== "admin" || !input.supersededDecision?.trim())) {
    throw new InventoryServiceError("FORBIDDEN", "An Administrator decision is required before issuing superseded stock.");
  }
  const payloadFingerprint = await fingerprint({ actorId: actor.id, type: "issue", inventoryId: input.inventoryId, quantity: input.quantity, reason: input.reason, reference: input.reference ?? null, supersededDecision: input.supersededDecision ?? null });
  return db.transaction(async (tx) => {
    const prior = await priorOperation(tx, input.operationId, payloadFingerprint);
    if (prior) return prior;
    const [line] = await tx.update(templateInventory).set({ count: sql`${templateInventory.count} - ${input.quantity}`, version: sql`${templateInventory.version} + 1` }).where(and(eq(templateInventory.id, input.inventoryId), gte(templateInventory.count, input.quantity))).returning();
    if (!line) throw new InventoryServiceError("INSUFFICIENT_STOCK", "There is not enough stock available.");
    const result: StockResult = { operationId: input.operationId, balances: [{ inventoryId: line.id, count: line.count, version: line.version }] };
    const operation = await persistOperation(tx, { operationId: input.operationId, actorId: actor.id, type: "issue", reason: input.reason.trim(), reference: input.reference, fingerprint: payloadFingerprint, result });
    await writeLedger(tx, operation.id, line.id, -input.quantity, line.count);
    await audit(tx, { actorId: actor.id, action: "inventory.issued", targetType: "template_inventory", targetId: line.id, after: { quantity: input.quantity, count: line.count, supersededDecision: input.supersededDecision ?? null }, correlationId: input.correlationId });
    return result;
  });
}

export async function transferStock(db: Database, actor: ArchiveActor, input: { sourceInventoryId: string; destinationInventoryId: string; quantity: number; reason: string; operationId: string; correlationId: string }) {
  requireStockOperator(actor);
  positiveInteger(input.quantity);
  if (input.sourceInventoryId === input.destinationInventoryId) throw new InventoryServiceError("VALIDATION", "Choose a different destination inventory line.");
  const source = await inventoryForMutation(db, actor, input.sourceInventoryId);
  const destination = await inventoryForMutation(db, actor, input.destinationInventoryId);
  if (source.inventory.templateId !== destination.inventory.templateId) throw new InventoryServiceError("VALIDATION", "Transfers require the same template revision.");
  const payloadFingerprint = await fingerprint({ actorId: actor.id, type: "transfer", sourceInventoryId: input.sourceInventoryId, destinationInventoryId: input.destinationInventoryId, quantity: input.quantity, reason: input.reason });
  return db.transaction(async (tx) => {
    const prior = await priorOperation(tx, input.operationId, payloadFingerprint);
    if (prior) return prior;
    const [debit] = await tx.update(templateInventory).set({ count: sql`${templateInventory.count} - ${input.quantity}`, version: sql`${templateInventory.version} + 1` }).where(and(eq(templateInventory.id, input.sourceInventoryId), gte(templateInventory.count, input.quantity))).returning();
    if (!debit) throw new InventoryServiceError("INSUFFICIENT_STOCK", "There is not enough stock available.");
    const [credit] = await tx.update(templateInventory).set({ count: sql`${templateInventory.count} + ${input.quantity}`, version: sql`${templateInventory.version} + 1` }).where(eq(templateInventory.id, input.destinationInventoryId)).returning();
    if (!credit) throw new InventoryServiceError("UNAVAILABLE", "This inventory line is unavailable.");
    const result: StockResult = { operationId: input.operationId, balances: [{ inventoryId: debit.id, count: debit.count, version: debit.version }, { inventoryId: credit.id, count: credit.count, version: credit.version }] };
    const operation = await persistOperation(tx, { operationId: input.operationId, actorId: actor.id, type: "transfer", reason: input.reason.trim(), fingerprint: payloadFingerprint, result });
    await writeLedger(tx, operation.id, debit.id, -input.quantity, debit.count);
    await writeLedger(tx, operation.id, credit.id, input.quantity, credit.count);
    await audit(tx, { actorId: actor.id, action: "inventory.transferred", targetType: "stock_operation", targetId: operation.id, after: { sourceInventoryId: debit.id, destinationInventoryId: credit.id, quantity: input.quantity }, correlationId: input.correlationId });
    return result;
  });
}

export async function correctStock(db: Database, actor: ArchiveActor, input: { inventoryId: string; count: number; expectedVersion: number; reason: string; operationId: string; correlationId: string }) {
  requireAdmin(actor);
  nonnegativeInteger(input.count);
  nonnegativeInteger(input.expectedVersion);
  await inventoryForMutation(db, actor, input.inventoryId);
  const payloadFingerprint = await fingerprint({ actorId: actor.id, type: "correct", inventoryId: input.inventoryId, count: input.count, expectedVersion: input.expectedVersion, reason: input.reason });
  return db.transaction(async (tx) => {
    const prior = await priorOperation(tx, input.operationId, payloadFingerprint);
    if (prior) return prior;
    const [before] = await tx.select().from(templateInventory).where(eq(templateInventory.id, input.inventoryId)).limit(1);
    if (!before) throw new InventoryServiceError("UNAVAILABLE", "This inventory line is unavailable.");
    if (before.count === input.count) throw new InventoryServiceError("VALIDATION", "The corrected balance must differ from the current balance.");
    const [line] = await tx.update(templateInventory).set({ count: input.count, version: sql`${templateInventory.version} + 1` }).where(and(eq(templateInventory.id, input.inventoryId), eq(templateInventory.version, input.expectedVersion))).returning();
    if (!line) throw new InventoryServiceError("CONFLICT", "The balance changed before this correction could be applied.");
    const delta = input.count - before.count;
    const result: StockResult = { operationId: input.operationId, balances: [{ inventoryId: line.id, count: line.count, version: line.version }] };
    const operation = await persistOperation(tx, { operationId: input.operationId, actorId: actor.id, type: "correct", reason: input.reason.trim(), fingerprint: payloadFingerprint, result });
    await tx.insert(stockTransactions).values({ stockOperationId: operation.id, inventoryId: line.id, delta, balanceBefore: before.count, balanceAfter: input.count });
    await audit(tx, { actorId: actor.id, action: "inventory.corrected", targetType: "template_inventory", targetId: line.id, before: { count: before.count, version: input.expectedVersion }, after: { count: input.count, version: line.version }, correlationId: input.correlationId });
    return result;
  });
}

export async function listInventory(db: Database, actor: ArchiveActor) {
  const rows = await db
    .select({ inventory: templateInventory, template: templates, folder: folders, box: boxes })
    .from(templateInventory)
    .innerJoin(templates, eq(templateInventory.templateId, templates.id))
    .innerJoin(folders, eq(templateInventory.folderId, folders.id))
    .innerJoin(boxes, eq(folders.boxId, boxes.id))
    .orderBy(templates.name, folders.code);
  const visible = [] as Array<(typeof rows)[number]>;
  for (const row of rows) {
    try { await requireActiveTemplateFolder(db, actor, row.folder.id); visible.push(row); } catch (error) { if (!(error instanceof ArchiveServiceError) && !(error instanceof InventoryServiceError)) throw error; }
  }
  return visible.map((row) => ({ ...row.inventory, templateCode: row.template.code, templateName: row.template.name, templateStatus: row.template.status, folderCode: row.folder.code, folderName: row.folder.name, boxCode: row.box.code }));
}
