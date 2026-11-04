import { writeAuditEntry } from "@matms/db";
import type { Database } from "@matms/db";
import { auditLogs } from "@matms/db/schema/audit";
import { accessGrants, boxes, documents, folders } from "@matms/db/schema/archive";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { schoolSettings } from "@matms/db/schema/settings";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import type { ArchiveActor } from "./archive-service";
import { MatmsError } from "./errors";

export type AuditFilters = { action?: string; targetType?: string; actorId?: string; from?: string; to?: string };

export async function listActiveGrants(db: Database, actor: ArchiveActor, page: number) {
  if (actor.role !== "admin") throw new MatmsError("FORBIDDEN", "This action is unavailable.").toORPCError();
  const rows = await db.select({ id: accessGrants.id, userId: accessGrants.userId, userName: user.name, boxCode: boxes.code, folderCode: folders.code, documentCode: documents.code, createdAt: accessGrants.createdAt })
    .from(accessGrants).innerJoin(user, eq(user.id, accessGrants.userId)).leftJoin(boxes, eq(boxes.id, accessGrants.boxId)).leftJoin(folders, eq(folders.id, accessGrants.folderId)).leftJoin(documents, eq(documents.id, accessGrants.documentId)).where(eq(accessGrants.active, true)).orderBy(desc(accessGrants.createdAt), desc(accessGrants.id)).limit(26).offset((page - 1) * 25);
  return { rows: rows.slice(0, 25), hasMore: rows.length > 25 };
}

export async function getSchoolSettings(db: Pick<Database, "select">) {
  const [settings] = await db.select().from(schoolSettings).where(eq(schoolSettings.id, 1)).limit(1);
  return settings ?? { schoolName: "Meocan High School", timezone: "Asia/Manila", canonicalOrigin: null, sessionIdleMinutes: 30, sessionMaxHours: 12 };
}

export async function updateSchoolSettings(db: Database, actor: ArchiveActor, input: { schoolName: string; timezone: "Asia/Manila"; canonicalOrigin: string | null; redirectPlan?: string; sessionIdleMinutes?: number; sessionMaxHours?: number; correlationId: string }) {
  if (actor.role !== "admin") throw new MatmsError("FORBIDDEN", "This action is unavailable.").toORPCError();
  let origin: string | null = null;
  if (input.canonicalOrigin) {
    try {
      const url = new URL(input.canonicalOrigin);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
      origin = url.origin;
    } catch { throw new MatmsError("VALIDATION_ERROR", "The canonical URL must be an HTTPS origin without a path, credentials, query, or fragment.").toORPCError(); }
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('matms:school-settings', 0))`);
    const before = await getSchoolSettings(tx);
    if (origin !== before.canonicalOrigin && !input.redirectPlan?.trim()) throw new MatmsError("VALIDATION_ERROR", "Describe the old-label redirect and reprint plan before changing the canonical origin.").toORPCError();
    const policy = { sessionIdleMinutes: input.sessionIdleMinutes ?? before.sessionIdleMinutes, sessionMaxHours: input.sessionMaxHours ?? before.sessionMaxHours };
    if (!Number.isInteger(policy.sessionIdleMinutes) || !Number.isInteger(policy.sessionMaxHours) || policy.sessionIdleMinutes < 5 || policy.sessionIdleMinutes > 120 || policy.sessionMaxHours < 1 || policy.sessionMaxHours > 24 || policy.sessionIdleMinutes > policy.sessionMaxHours * 60) throw new MatmsError("VALIDATION_ERROR", "Choose a valid session policy.").toORPCError();
    const [settings] = await tx.insert(schoolSettings).values({ id: 1, schoolName: input.schoolName.trim(), timezone: input.timezone, canonicalOrigin: origin, ...policy }).onConflictDoUpdate({ target: schoolSettings.id, set: { schoolName: input.schoolName.trim(), timezone: input.timezone, canonicalOrigin: origin, ...policy, updatedAt: new Date() } }).returning();
    if (!settings) throw new MatmsError("INTERNAL_ERROR", "Settings are unavailable.").toORPCError();
    await writeAuditEntry(tx, { actorId: actor.id, action: "admin.settings_changed", targetType: "school_settings", targetId: "1", before: { schoolName: before.schoolName, timezone: before.timezone, canonicalOrigin: before.canonicalOrigin, sessionIdleMinutes: before.sessionIdleMinutes, sessionMaxHours: before.sessionMaxHours }, after: { schoolName: settings.schoolName, timezone: settings.timezone, canonicalOrigin: settings.canonicalOrigin, sessionIdleMinutes: settings.sessionIdleMinutes, sessionMaxHours: settings.sessionMaxHours, redirectPlan: origin !== before.canonicalOrigin ? input.redirectPlan!.trim() : null }, correlationId: input.correlationId });
    return settings;
  });
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(authorization|cookie|password|secret|session|token)/i.test(key)).map(([key, item]) => [key, sanitize(item)]));
}

/** Audit history is a system-wide capability, not an operational-history capability. */
export async function listAudit(db: Database, actor: ArchiveActor, input: { filters: AuditFilters; page: number; pageSize: number }) {
  if (actor.role !== "admin") throw new MatmsError("FORBIDDEN", "This action is unavailable.").toORPCError();
  const { filters, page, pageSize } = input;
  const where = and(
    filters.action ? eq(auditLogs.action, filters.action) : undefined,
    filters.targetType ? eq(auditLogs.targetType, filters.targetType) : undefined,
    filters.actorId ? eq(auditLogs.actorId, filters.actorId) : undefined,
    filters.from ? gte(auditLogs.createdAt, new Date(`${filters.from}T00:00:00+08:00`)) : undefined,
    filters.to ? lt(auditLogs.createdAt, sql`(${`${filters.to}T00:00:00+08:00`}::timestamptz + interval '1 day')`) : undefined,
  );
  const rows = await db.select({ id: auditLogs.id, actorId: auditLogs.actorId, actorName: user.name, action: auditLogs.action, targetType: auditLogs.targetType, targetId: auditLogs.targetId, before: auditLogs.before, after: auditLogs.after, correlationId: auditLogs.correlationId, createdAt: auditLogs.createdAt })
    .from(auditLogs).leftJoin(user, eq(user.id, auditLogs.actorId)).where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize).map((row) => ({ ...row, before: sanitize(row.before), after: sanitize(row.after) })), hasMore: rows.length > pageSize };
}

/** Administrator-only explanation of the selected account's restricted ancestry. */
export async function previewAccess(db: Database, actor: ArchiveActor, input: { userId: string; targetType: "box" | "folder" | "document"; targetId: string }) {
  if (actor.role !== "admin") throw new MatmsError("FORBIDDEN", "This action is unavailable.").toORPCError();
  return db.transaction(async (tx) => {
    const [account] = await tx.select({ name: user.name, active: userProfiles.active, role: userProfiles.role }).from(user).innerJoin(userProfiles, eq(user.id, userProfiles.userId)).where(eq(user.id, input.userId));
    if (!account) throw new MatmsError("NOT_FOUND", "The account or record is unavailable.").toORPCError();
    const path: Array<{ id: string; type: "box" | "folder" | "document"; code: string; confidentiality: "internal" | "restricted"; granted: boolean }> = [];
    let boxId = input.targetId;
    let folderId: string | undefined = input.targetType === "folder" ? input.targetId : undefined;
    if (input.targetType === "document") {
      const [document] = await tx.select().from(documents).where(eq(documents.id, input.targetId));
      if (!document) throw new MatmsError("NOT_FOUND", "The account or record is unavailable.").toORPCError();
      folderId = document.folderId;
      path.unshift({ id: document.id, type: "document", code: document.code, confidentiality: document.confidentiality, granted: false });
    }
    if (folderId) {
      const [folder] = await tx.select().from(folders).where(eq(folders.id, folderId));
      if (!folder) throw new MatmsError("NOT_FOUND", "The account or record is unavailable.").toORPCError();
      boxId = folder.boxId;
      path.unshift({ id: folder.id, type: "folder", code: folder.code, confidentiality: folder.confidentiality, granted: false });
    }
    const [box] = await tx.select().from(boxes).where(eq(boxes.id, boxId));
    if (!box) throw new MatmsError("NOT_FOUND", "The account or record is unavailable.").toORPCError();
    path.unshift({ id: box.id, type: "box", code: box.code, confidentiality: box.confidentiality, granted: false });
    const grants = await tx.select().from(accessGrants).where(and(eq(accessGrants.userId, input.userId), eq(accessGrants.active, true)));
    for (const level of path) level.granted = grants.some((grant) => (level.type === "box" ? grant.boxId : level.type === "folder" ? grant.folderId : grant.documentId) === level.id);
    const missing = path.filter((level) => level.confidentiality === "restricted" && !level.granted && account.role !== "admin");
    return { account, path, effectiveNow: account.active && missing.length === 0, effectiveAfterTargetGrant: account.active && missing.every((level) => level.type === input.targetType && level.id === input.targetId), missing };
  });
}

export async function auditFilterChoices(db: Database, actor: ArchiveActor) {
  if (actor.role !== "admin") throw new MatmsError("FORBIDDEN", "This action is unavailable.").toORPCError();
  const actions = await db.selectDistinct({ value: auditLogs.action }).from(auditLogs).orderBy(auditLogs.action).limit(500);
  const targetTypes = await db.selectDistinct({ value: auditLogs.targetType }).from(auditLogs).orderBy(auditLogs.targetType).limit(500);
  return { actions: actions.map((row) => row.value), targetTypes: targetTypes.map((row) => row.value) };
}
