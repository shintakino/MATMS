import { writeAuditEntry } from "@matms/db";
import type { AuditTransaction, Database } from "@matms/db";
import { accessGrants, boxes, documents, folders, movementEvents } from "@matms/db/schema/archive";
import { custodyOperationReplays, documentCheckouts, documentRequests, requestItems } from "@matms/db/schema/custody";
import { user } from "@matms/db/schema/auth";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { normalizeCode } from "./archive-service";
import type { ArchiveActor } from "./archive-service";

export class CustodyError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "UNAVAILABLE" | "CONFLICT" | "VALIDATION" | "ACTIVE_LOAN", message: string) {
    super(message);
    this.name = "CustodyError";
  }
}

function requireOperator(actor: ArchiveActor) {
  if (actor.role === "viewer") throw new CustodyError("FORBIDDEN", "This action is unavailable.");
}
function unavailable(): never { throw new CustodyError("UNAVAILABLE", "This record is unavailable."); }

async function lockRequest(tx: AuditTransaction, id: string) {
  const [request] = await tx.select().from(documentRequests).where(eq(documentRequests.id, id)).for("update").limit(1);
  if (!request) return unavailable();
  return request;
}

async function documentScope(tx: AuditTransaction, actor: ArchiveActor, id: string, lock = false) {
  if (lock) await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, id)).for("update");
  if (lock) await tx.select({ id: boxes.id }).from(boxes).innerJoin(folders, eq(folders.boxId, boxes.id)).innerJoin(documents, eq(documents.folderId, folders.id)).where(eq(documents.id, id)).for("update");
  const [row] = await tx.select({ document: documents, folder: folders, box: boxes }).from(documents)
    .innerJoin(folders, eq(documents.folderId, folders.id)).innerJoin(boxes, eq(folders.boxId, boxes.id))
    .where(eq(documents.id, id)).limit(1);
  if (!row) return unavailable();
  if (actor.role !== "admin") {
    const grants = await tx.select().from(accessGrants).where(and(eq(accessGrants.userId, actor.id), eq(accessGrants.active, true)));
    if ((row.box.confidentiality === "restricted" && !grants.some((g) => g.boxId === row.box.id)) ||
        (row.folder.confidentiality === "restricted" && !grants.some((g) => g.folderId === row.folder.id)) ||
        (row.document.confidentiality === "restricted" && !grants.some((g) => g.documentId === row.document.id))) return unavailable();
  }
  return row;
}

async function folderScope(tx: AuditTransaction, actor: ArchiveActor, id: string) {
  const [row] = await tx.select({ folder: folders, box: boxes }).from(folders).innerJoin(boxes, eq(folders.boxId, boxes.id)).where(eq(folders.id, id)).limit(1);
  if (!row) return unavailable();
  if (actor.role !== "admin") {
    const grants = await tx.select().from(accessGrants).where(and(eq(accessGrants.userId, actor.id), eq(accessGrants.active, true)));
    if ((row.box.confidentiality === "restricted" && !grants.some((g) => g.boxId === row.box.id)) ||
        (row.folder.confidentiality === "restricted" && !grants.some((g) => g.folderId === row.folder.id))) return unavailable();
  }
  return row;
}

function requireRestrictedApproval(item: typeof requestItems.$inferSelect, scope: Awaited<ReturnType<typeof documentScope>>) {
  if (![scope.box.confidentiality, scope.folder.confidentiality, scope.document.confidentiality].includes("restricted")) return;
  if (!item.decidedBy || !item.approvedByAdmin) throw new CustodyError("FORBIDDEN", "An Administrator must approve restricted records.");
}

async function requestScope(tx: AuditTransaction, actor: ArchiveActor, requestId: string) {
  const items = await tx.select().from(requestItems).where(eq(requestItems.requestId, requestId));
  for (const item of items) await documentScope(tx, actor, item.documentId);
  return items;
}

async function refreshStatus(tx: AuditTransaction, requestId: string) {
  const [request] = await tx.select().from(documentRequests).where(eq(documentRequests.id, requestId)).limit(1);
  if (!request || request.status === "draft") return;
  const items = await tx.select().from(requestItems).where(eq(requestItems.requestId, requestId));
  const openLoans = await tx.select({ id: documentCheckouts.id }).from(documentCheckouts)
    .innerJoin(requestItems, eq(documentCheckouts.requestItemId, requestItems.id))
    .where(and(eq(requestItems.requestId, requestId), isNull(documentCheckouts.resolvedAt), or(isNull(documentCheckouts.returnedAt), isNotNull(documentCheckouts.exception)))).limit(1);
  const fulfilled = items.some((item) => item.status === "fulfilled");
  let status: typeof documentRequests.$inferSelect.status;
  if (items.some((item) => item.status === "pending")) status = "submitted";
  else if (items.every((item) => item.status === "rejected")) status = "rejected";
  else if (items.every((item) => item.status === "cancelled")) status = "cancelled";
  else if (fulfilled && (openLoans.length > 0 || items.some((item) => item.status === "approved"))) status = "in_progress";
  else if (fulfilled) status = "completed";
  else if (items.some((item) => item.status === "approved")) status = "approved";
  else status = "completed";
  await tx.update(documentRequests).set({ status, updatedAt: new Date() }).where(eq(documentRequests.id, requestId));
}

async function recordAudit(tx: AuditTransaction, actor: ArchiveActor, action: string, targetType: string, targetId: string, correlationId: string, after?: Record<string, string | null>) {
  await writeAuditEntry(tx, { actorId: actor.id, action, targetType, targetId, correlationId, after });
}

export async function createRequest(db: Database, actor: ArchiveActor, input: { code: string; requesterName: string; office?: string | null; contact?: string | null; purpose: string; kind: "inspect" | "borrow" | "copy"; notes?: string | null; documentIds: string[]; correlationId: string }) {
  requireOperator(actor);
  if (!input.documentIds.length || new Set(input.documentIds).size !== input.documentIds.length) throw new CustodyError("VALIDATION", "Select one or more distinct documents.");
  return db.transaction(async (tx) => {
    for (const id of [...input.documentIds].sort()) {
      const scope = await documentScope(tx, actor, id, true);
      if (scope.document.lifecycle !== "active" || scope.folder.lifecycle !== "active" || scope.box.lifecycle !== "active") throw new CustodyError("CONFLICT", "Only active records can be requested.");
    }
    const [request] = await tx.insert(documentRequests).values({ code: input.code.trim(), normalizedCode: normalizeCode(input.code), requesterName: input.requesterName.trim(), office: input.office?.trim() || null, contact: input.contact?.trim() || null, purpose: input.purpose.trim(), kind: input.kind, notes: input.notes?.trim() || null, createdBy: actor.id }).returning();
    if (!request) throw new CustodyError("CONFLICT", "Request could not be created.");
    await tx.insert(requestItems).values(input.documentIds.map((documentId) => ({ requestId: request.id, documentId })));
    await recordAudit(tx, actor, "request.created", "document_request", request.id, input.correlationId, { code: request.code });
    return { id: request.id };
  });
}

export async function submitRequest(db: Database, actor: ArchiveActor, input: { requestId: string; correlationId: string }) {
  requireOperator(actor);
  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.requestId);
    const items = await requestScope(tx, actor, request.id);
    if (request.status !== "draft") throw new CustodyError("CONFLICT", "Only a draft request can be submitted.");
    if (!items.length) throw new CustodyError("CONFLICT", "A request must contain at least one document.");
    for (const item of items.sort((a, b) => a.documentId.localeCompare(b.documentId))) {
      const scope = await documentScope(tx, actor, item.documentId, true);
      if (scope.document.lifecycle !== "active" || scope.folder.lifecycle !== "active" || scope.box.lifecycle !== "active") throw new CustodyError("CONFLICT", "Only active records can be requested.");
    }
    await tx.update(documentRequests).set({ status: "submitted", updatedAt: new Date() }).where(eq(documentRequests.id, request.id));
    await recordAudit(tx, actor, "request.submitted", "document_request", request.id, input.correlationId);
    return { submitted: true };
  });
}

export async function cancelRequest(db: Database, actor: ArchiveActor, input: { requestId: string; correlationId: string }) {
  requireOperator(actor);
  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.requestId);
    await requestScope(tx, actor, request.id);
    const changed = await tx.update(requestItems).set({ status: "cancelled", decidedBy: actor.id, decidedAt: new Date(), approvedByAdmin: false })
      .where(and(eq(requestItems.requestId, request.id), inArray(requestItems.status, ["pending", "approved"]))).returning({ id: requestItems.id });
    if (!changed.length) throw new CustodyError("CONFLICT", "There are no unfulfilled lines to cancel.");
    if (request.status === "draft") await tx.update(documentRequests).set({ status: "submitted", updatedAt: new Date() }).where(eq(documentRequests.id, request.id));
    await refreshStatus(tx, request.id);
    await recordAudit(tx, actor, "request.cancelled_unfulfilled", "document_request", request.id, input.correlationId);
    return { cancelled: changed.length };
  });
}

export async function decideLine(db: Database, actor: ArchiveActor, input: { itemId: string; decision: "approved" | "rejected" | "cancelled"; reason?: string | null; correlationId: string }) {
  requireOperator(actor);
  if (input.decision === "rejected" && !input.reason?.trim()) throw new CustodyError("VALIDATION", "A rejection reason is required.");
  return db.transaction(async (tx) => {
    let [item] = await tx.select().from(requestItems).where(eq(requestItems.id, input.itemId)).limit(1);
    if (!item) return unavailable();
    const request = await lockRequest(tx, item.requestId);
    [item] = await tx.select().from(requestItems).where(eq(requestItems.id, input.itemId)).limit(1);
    if (!item) return unavailable();
    const scope = await documentScope(tx, actor, item.documentId);
    const restricted = [scope.box.confidentiality, scope.folder.confidentiality, scope.document.confidentiality].includes("restricted");
    if (input.decision === "approved" && restricted && actor.role !== "admin") throw new CustodyError("FORBIDDEN", "An Administrator must approve restricted records.");
    const adminReapproval = item.status === "approved" && input.decision === "approved" && actor.role === "admin" && !item.approvedByAdmin;
    if (request.status === "draft" || (item.status !== "pending" && !(input.decision === "cancelled" && item.status === "approved") && !adminReapproval)) throw new CustodyError("CONFLICT", "This line cannot be decided in its current state.");
    if (input.decision === "approved" && (scope.document.lifecycle !== "active" || scope.folder.lifecycle !== "active" || scope.box.lifecycle !== "active")) throw new CustodyError("CONFLICT", "Only active records can be approved.");
    await tx.update(requestItems).set({ status: input.decision, decidedBy: actor.id, decidedAt: new Date(), approvedByAdmin: input.decision === "approved" && actor.role === "admin", decisionReason: input.reason?.trim() || null }).where(eq(requestItems.id, item.id));
    await refreshStatus(tx, request.id);
    await recordAudit(tx, actor, `request.line_${input.decision}`, "request_item", item.id, input.correlationId);
    return { decided: true };
  });
}

export async function fulfillLine(db: Database, actor: ArchiveActor, input: { itemId: string; correlationId: string }) {
  requireOperator(actor);
  return db.transaction(async (tx) => {
    let [item] = await tx.select().from(requestItems).where(eq(requestItems.id, input.itemId)).limit(1);
    if (!item) return unavailable();
    const request = await lockRequest(tx, item.requestId);
    [item] = await tx.select().from(requestItems).where(eq(requestItems.id, input.itemId)).limit(1);
    if (!item) return unavailable();
    const scope = await documentScope(tx, actor, item.documentId, true);
    if (request.kind === "borrow" || item.status !== "approved") throw new CustodyError("CONFLICT", "This line cannot be fulfilled in its current state.");
    if (scope.document.lifecycle !== "active" || scope.folder.lifecycle !== "active" || scope.box.lifecycle !== "active") throw new CustodyError("CONFLICT", "The record is not active.");
    requireRestrictedApproval(item, scope);
    const [open] = await tx.select({ id: documentCheckouts.id }).from(documentCheckouts).where(and(eq(documentCheckouts.documentId, item.documentId), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
    if (open) throw new CustodyError("ACTIVE_LOAN", "The record is already on loan.");
    await tx.update(requestItems).set({ status: "fulfilled", fulfilledBy: actor.id, fulfilledAt: new Date() }).where(eq(requestItems.id, item.id));
    await refreshStatus(tx, request.id);
    await recordAudit(tx, actor, "request.line_fulfilled", "request_item", item.id, input.correlationId);
    return { fulfilled: true };
  });
}

async function hashPayload(value: object) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function replay(tx: AuditTransaction, actor: ArchiveActor, operationId: string, kind: "release" | "return", fingerprint: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${operationId}, 0))`);
  const [existing] = await tx.select().from(custodyOperationReplays).where(eq(custodyOperationReplays.operationId, operationId)).limit(1);
  if (!existing) return null;
  if (existing.kind !== kind || existing.actorId !== actor.id || existing.payloadFingerprint !== fingerprint) throw new CustodyError("CONFLICT", "This operation ID was used for a different action.");
  return existing.result as { checkoutId: string };
}

export async function releaseDocument(db: Database, actor: ArchiveActor, input: { itemId: string; recipient: string; acknowledged: boolean; dueAt: string; operationId: string; correlationId: string }) {
  requireOperator(actor);
  if (!input.acknowledged) throw new CustodyError("VALIDATION", "Recipient acknowledgement is required.");
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.valueOf())) throw new CustodyError("VALIDATION", "A valid due time is required.");
  const fingerprint = await hashPayload({ actorId: actor.id, itemId: input.itemId, recipient: input.recipient, acknowledged: input.acknowledged, dueAt: input.dueAt });
  return db.transaction(async (tx) => {
    let [item] = await tx.select().from(requestItems).where(eq(requestItems.id, input.itemId)).limit(1);
    if (!item) return unavailable();
    const request = await lockRequest(tx, item.requestId);
    [item] = await tx.select().from(requestItems).where(eq(requestItems.id, input.itemId)).limit(1);
    if (!item) return unavailable();
    const scope = await documentScope(tx, actor, item.documentId, true);
    const prior = await replay(tx, actor, input.operationId, "release", fingerprint);
    if (prior) return prior;
    if (request.kind !== "borrow" || item.status !== "approved") throw new CustodyError("CONFLICT", "This line is not approved for release.");
    if (scope.document.lifecycle !== "active" || scope.folder.lifecycle !== "active" || scope.box.lifecycle !== "active") throw new CustodyError("CONFLICT", "The record is not active.");
    requireRestrictedApproval(item, scope);
    const now = new Date();
    if (dueAt < now) throw new CustodyError("VALIDATION", "The due time must be after release.");
    const [open] = await tx.select({ id: documentCheckouts.id }).from(documentCheckouts).where(and(eq(documentCheckouts.documentId, item.documentId), or(isNull(documentCheckouts.returnedAt), and(isNull(documentCheckouts.resolvedAt), isNotNull(documentCheckouts.exception))))).limit(1);
    if (open) throw new CustodyError("ACTIVE_LOAN", "The record is already on loan.");
    const [checkout] = await tx.insert(documentCheckouts).values({ requestItemId: item.id, documentId: item.documentId, homeFolderId: scope.folder.id, recipient: input.recipient.trim(), acknowledged: true, releasedBy: actor.id, releasedAt: now, dueAt }).returning();
    if (!checkout) throw new CustodyError("CONFLICT", "Release could not be recorded.");
    await tx.update(requestItems).set({ status: "fulfilled", fulfilledBy: actor.id, fulfilledAt: now }).where(eq(requestItems.id, item.id));
    await refreshStatus(tx, request.id);
    const result = { checkoutId: checkout.id };
    await tx.insert(custodyOperationReplays).values({ operationId: input.operationId, kind: "release", actorId: actor.id, scopeFingerprint: await hashPayload({ documentId: item.documentId }), payloadFingerprint: fingerprint, result });
    await recordAudit(tx, actor, "custody.released", "document_checkout", checkout.id, input.correlationId, { documentId: item.documentId });
    return result;
  });
}

export async function returnDocument(db: Database, actor: ArchiveActor, input: { checkoutId: string; condition: string; folderId?: string | null; relocationReason?: string | null; operationId: string; correlationId: string }) {
  requireOperator(actor);
  if (/^lost$/i.test(input.condition.trim())) throw new CustodyError("VALIDATION", "Record a lost item as an exception; it cannot be returned until found.");
  const fingerprint = await hashPayload({ actorId: actor.id, checkoutId: input.checkoutId, condition: input.condition, folderId: input.folderId ?? null, relocationReason: input.relocationReason ?? null });
  return db.transaction(async (tx) => {
    let [checkout] = await tx.select().from(documentCheckouts).where(eq(documentCheckouts.id, input.checkoutId)).limit(1);
    if (!checkout) return unavailable();
    const [item] = await tx.select().from(requestItems).where(eq(requestItems.id, checkout.requestItemId)).limit(1);
    if (!item) return unavailable();
    const request = await lockRequest(tx, item.requestId);
    [checkout] = await tx.select().from(documentCheckouts).where(eq(documentCheckouts.id, input.checkoutId)).limit(1);
    if (!checkout) return unavailable();
    const source = await documentScope(tx, actor, checkout.documentId, true);
    const destination = await folderScope(tx, actor, input.folderId ?? checkout.homeFolderId);
    const prior = await replay(tx, actor, input.operationId, "return", fingerprint);
    if (prior) return prior;
    if (checkout.returnedAt || (checkout.resolvedAt && !checkout.exception)) throw new CustodyError("CONFLICT", "This loan is already closed.");
    if (destination.folder.lifecycle === "retired" || destination.box.lifecycle === "retired") throw new CustodyError("CONFLICT", "A retired location cannot receive a return.");
    if (destination.folder.id !== checkout.homeFolderId) {
      if (!input.relocationReason?.trim()) throw new CustodyError("VALIDATION", "A reason is required for an alternative return location.");
      if (destination.box.lifecycle !== "active" || destination.folder.lifecycle !== "active") throw new CustodyError("CONFLICT", "The alternative location must be active.");
      if (actor.role !== "admin" && ((source.box.confidentiality === "restricted" && destination.box.confidentiality !== "restricted") || (source.folder.confidentiality === "restricted" && destination.folder.confidentiality !== "restricted"))) throw new CustodyError("FORBIDDEN", "An Administrator must review a move into less restrictive ancestry.");
      await tx.update(documents).set({ folderId: destination.folder.id }).where(eq(documents.id, checkout.documentId));
      await tx.insert(movementEvents).values({ documentId: checkout.documentId, source: { folderId: source.folder.id, folderCode: source.folder.code }, destination: { folderId: destination.folder.id, folderCode: destination.folder.code }, reason: input.relocationReason.trim(), actorId: actor.id });
    }
    const now = new Date();
    const damaged = /^damage(?:d)?$/i.test(input.condition.trim());
    await tx.update(documentCheckouts).set({ returnedAt: now, returnedBy: actor.id, returnCondition: input.condition.trim(), returnedFolderId: destination.folder.id, ...(damaged && !checkout.exception ? { exception: "damaged" as const, exceptionNotes: "Damage recorded on return.", exceptionRecordedBy: actor.id, exceptionRecordedAt: now } : {}) }).where(eq(documentCheckouts.id, checkout.id));
    await refreshStatus(tx, request.id);
    const result = { checkoutId: checkout.id };
    await tx.insert(custodyOperationReplays).values({ operationId: input.operationId, kind: "return", actorId: actor.id, scopeFingerprint: await hashPayload({ documentId: checkout.documentId, folderId: destination.folder.id }), payloadFingerprint: fingerprint, result });
    await recordAudit(tx, actor, "custody.returned", "document_checkout", checkout.id, input.correlationId, { documentId: checkout.documentId, folderId: destination.folder.id });
    return result;
  });
}

export async function recordException(db: Database, actor: ArchiveActor, input: { checkoutId: string; exception: "lost" | "damaged"; notes: string; correlationId: string }) {
  requireOperator(actor);
  return db.transaction(async (tx) => {
    let [checkout] = await tx.select().from(documentCheckouts).where(eq(documentCheckouts.id, input.checkoutId)).limit(1);
    if (!checkout) return unavailable();
    const [item] = await tx.select().from(requestItems).where(eq(requestItems.id, checkout.requestItemId)).limit(1);
    if (!item) return unavailable();
    await lockRequest(tx, item.requestId);
    [checkout] = await tx.select().from(documentCheckouts).where(eq(documentCheckouts.id, input.checkoutId)).limit(1);
    if (!checkout) return unavailable();
    await documentScope(tx, actor, checkout.documentId, true);
    if (checkout.returnedAt || checkout.resolvedAt || checkout.exception) throw new CustodyError("CONFLICT", "This loan cannot be changed.");
    await tx.update(documentCheckouts).set({ exception: input.exception, exceptionNotes: input.notes.trim(), exceptionRecordedBy: actor.id, exceptionRecordedAt: new Date() }).where(eq(documentCheckouts.id, checkout.id));
    await recordAudit(tx, actor, "custody.exception_recorded", "document_checkout", checkout.id, input.correlationId, { exception: input.exception });
    return { recorded: true };
  });
}

export async function resolveException(db: Database, actor: ArchiveActor, input: { checkoutId: string; disposition: string; notes: string; correlationId: string }) {
  if (actor.role !== "admin") throw new CustodyError("FORBIDDEN", "Only an Administrator may resolve an exception.");
  return db.transaction(async (tx) => {
    let [checkout] = await tx.select().from(documentCheckouts).where(eq(documentCheckouts.id, input.checkoutId)).limit(1);
    if (!checkout) return unavailable();
    const [item] = await tx.select().from(requestItems).where(eq(requestItems.id, checkout.requestItemId)).limit(1);
    if (!item) return unavailable();
    const request = await lockRequest(tx, item.requestId);
    [checkout] = await tx.select().from(documentCheckouts).where(eq(documentCheckouts.id, input.checkoutId)).limit(1);
    if (!checkout) return unavailable();
    await documentScope(tx, actor, checkout.documentId, true);
    if (!checkout.exception || checkout.resolvedAt) throw new CustodyError("CONFLICT", "This exception cannot be resolved.");
    await tx.update(documentCheckouts).set({ resolution: input.disposition.trim(), resolutionNotes: input.notes.trim(), resolvedBy: actor.id, resolvedAt: new Date() }).where(eq(documentCheckouts.id, checkout.id));
    await refreshStatus(tx, request.id);
    await recordAudit(tx, actor, "custody.exception_resolved", "document_checkout", checkout.id, input.correlationId, { disposition: input.disposition.trim() });
    return { resolved: true };
  });
}

export async function listRequests(db: Database, actor: ArchiveActor, page = 1) {
  requireOperator(actor);
  return db.transaction(async (tx) => {
    const requests = await tx.select().from(documentRequests).orderBy(documentRequests.createdAt, documentRequests.id);
    const visible: typeof requests = [];
    for (const request of requests) {
      try { await requestScope(tx, actor, request.id); visible.push(request); } catch (error) { if (!(error instanceof CustodyError && error.code === "UNAVAILABLE")) throw error; }
    }
    return { items: visible.slice((page - 1) * 25, page * 25), hasMore: visible.length > page * 25 };
  });
}

export async function getRequest(db: Database, actor: ArchiveActor, id: string) {
  requireOperator(actor);
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(documentRequests).where(eq(documentRequests.id, id)).limit(1);
    if (!request) return unavailable();
    const items = await requestScope(tx, actor, id);
    const lines = [];
    for (const item of items) {
      const scope = await documentScope(tx, actor, item.documentId);
      const [checkout] = await tx.select().from(documentCheckouts).where(eq(documentCheckouts.requestItemId, item.id)).limit(1);
      lines.push({ ...item, documentCode: scope.document.code, documentTitle: scope.document.title, checkout: checkout ?? null });
    }
    return { request, lines };
  });
}

export async function listLoans(db: Database, actor: ArchiveActor, filter: "all" | "active" | "overdue" | "returned" | "exception" = "active", page = 1) {
  requireOperator(actor);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(documentCheckouts).orderBy(documentCheckouts.releasedAt, documentCheckouts.id);
    const visible: Array<(typeof rows)[number] & { overdue: boolean; documentCode: string; documentTitle: string; releasedByName: string; returnedByName: string | null }> = [];
    for (const row of rows) {
      try {
        const scope = await documentScope(tx, actor, row.documentId);
        const [releaser] = await tx.select({ name: user.name }).from(user).where(eq(user.id, row.releasedBy)).limit(1);
        const receiver = row.returnedBy ? (await tx.select({ name: user.name }).from(user).where(eq(user.id, row.returnedBy)).limit(1))[0] : undefined;
        visible.push({ ...row, overdue: !row.resolvedAt && (!row.returnedAt || Boolean(row.exception)) && row.dueAt < new Date(), documentCode: scope.document.code, documentTitle: scope.document.title, releasedByName: releaser?.name ?? "Unavailable", returnedByName: receiver?.name ?? null });
      } catch (error) { if (!(error instanceof CustodyError && error.code === "UNAVAILABLE")) throw error; }
    }
    const filtered = visible.filter((loan) => filter === "all" || (filter === "active" && !loan.resolvedAt && (!loan.returnedAt || Boolean(loan.exception))) || (filter === "overdue" && loan.overdue) || (filter === "returned" && Boolean(loan.returnedAt)) || (filter === "exception" && Boolean(loan.exception)));
    return { items: filtered.slice((page - 1) * 25, page * 25), hasMore: filtered.length > page * 25 };
  });
}
