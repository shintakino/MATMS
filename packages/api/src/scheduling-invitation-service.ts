import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@matms/db";
import { userProfiles } from "@matms/db/schema/identity";
import { leaveBookings, resourceBookings, schedulingInvitations as invitations, schedulingPeople } from "@matms/db/schema/scheduling";
import { dateDays, invitationAvailabilityInput, invitationInput, invitationToken, pageInput, publicSubmissionInput } from "./scheduling-contract";
import { admin, audit, authorize, checkLeaveRange, checkResourceRange, closures, fail, hash, leaveDayState, leaveHolds, policy, write, type Actor, type Reader } from "./scheduling-core";
import { directoryPerson } from "./scheduling-people-service";
import { resourceAvailability } from "./scheduling-service";

const unavailable = () => fail("NOT_FOUND", "This request link is expired, revoked or unavailable. Ask an Administrator for a new link.");
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
async function invitation(db: Reader, rawToken: string, lockIssuer = false) {
  const token = invitationToken.parse(rawToken);
  const [link] = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash(token)));
  if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return unavailable();
  const query = db.select().from(userProfiles).where(eq(userProfiles.userId, link.createdBy));
  const [issuer] = await (lockIssuer ? query.for("share") : query);
  if (!issuer?.active || issuer.mustChangePassword || issuer.role !== "admin") return unavailable();
  const [person] = link.personId ? await db.select().from(schedulingPeople).where(eq(schedulingPeople.id, link.personId)) : [];
  if (link.kind === "leave" && (!person?.active || person.version !== link.personVersion || (person.category !== "shs" && person.category !== "jhs"))) return unavailable();
  return { link, person: person ?? null };
}
export async function createSchedulingInvitation(db: Database, actor: Actor, raw: z.input<typeof invitationInput>, correlationId: string) {
  const input = invitationInput.parse(raw);
  return write(db, actor, async tx => {
    admin(actor);
    const person = input.personId ? await directoryPerson(tx, input.personId) : null;
    if (input.kind === "leave" && person?.category !== "shs" && person?.category !== "jhs") fail("VALIDATION_ERROR", "Choose a teacher classified as SHS or JHS.");
    const token = randomBytes(32).toString("base64url"), createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + input.expiresInHours * 3600000);
    const [saved] = await tx.insert(invitations).values({ tokenHash: tokenHash(token), kind: input.kind, personId: person?.id ?? null, personVersion: person?.version ?? null, createdBy: actor.id, createdAt, expiresAt }).returning({ id: invitations.id });
    if (!saved) fail("CONFLICT", "The public link could not be created.");
    await audit(tx, actor, "invitation.created", saved.id, correlationId, { kind: input.kind, personId: person?.id ?? null, expiresAt: expiresAt.toISOString() });
    // The raw capability is returned once, and is never persisted or audited.
    return { id: saved.id, token, expiresAt: expiresAt.toISOString() };
  });
}
export async function listSchedulingInvitations(db: Database, actor: Actor, raw: z.input<typeof pageInput>) {
  await authorize(db, actor); admin(actor);
  const input = pageInput.parse(raw);
  const rows = await db.select({ id: invitations.id, kind: invitations.kind, name: schedulingPeople.name, personVersion: schedulingPeople.version, boundVersion: invitations.personVersion, personActive: schedulingPeople.active, issuerActive: userProfiles.active, issuerRole: userProfiles.role, issuerMustChangePassword: userProfiles.mustChangePassword, createdAt: invitations.createdAt, expiresAt: invitations.expiresAt, revokedAt: invitations.revokedAt, usedAt: invitations.usedAt, version: invitations.version })
    .from(invitations).innerJoin(userProfiles, eq(userProfiles.userId, invitations.createdBy)).leftJoin(schedulingPeople, eq(schedulingPeople.id, invitations.personId))
    .orderBy(desc(invitations.createdAt), asc(invitations.id)).limit(26).offset((input.page - 1) * 25);
  return { items: rows.slice(0, 25).map(row => ({ id: row.id, kind: row.kind, name: row.name, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), usedAt: row.usedAt?.toISOString() ?? null, version: row.version,
    state: row.revokedAt ? "revoked" : row.expiresAt.getTime() <= Date.now() ? "expired" : !row.issuerActive || row.issuerRole !== "admin" || row.issuerMustChangePassword || (row.kind === "leave" && (!row.personActive || row.personVersion !== row.boundVersion)) ? "unavailable" : row.usedAt ? "used" : "ready" })), hasMore: rows.length > 25 };
}
export async function revokeSchedulingInvitation(db: Database, actor: Actor, input: { id: string; expectedVersion: number }, correlationId: string) {
  return write(db, actor, async tx => {
    admin(actor);
    const [link] = await tx.select().from(invitations).where(eq(invitations.id, input.id));
    if (!link) fail("NOT_FOUND", "This public link is unavailable.");
    if (link.version !== input.expectedVersion) fail("CONFLICT", "This link changed. Refresh before revoking it.");
    if (!link.revokedAt) {
      await tx.update(invitations).set({ revokedAt: new Date(), version: link.version + 1 }).where(eq(invitations.id, link.id));
      await audit(tx, actor, "invitation.revoked", link.id, correlationId, { alreadySubmitted: !!link.usedAt });
    }
    return { saved: true };
  });
}
export async function previewSchedulingInvitation(db: Database, token: string) {
  const { link, person } = await invitation(db, token);
  return { serverNow: new Date().toISOString(), kind: link.kind, person: person ? { name: person.name, category: person.category } : null, expiresAt: link.expiresAt.toISOString(), state: link.usedAt ? "used" as const : "ready" as const, receiptCode: link.receiptCode };
}
export async function schedulingInvitationAvailability(db: Database, raw: z.input<typeof invitationAvailabilityInput>) {
  const input = invitationAvailabilityInput.parse(raw);
  return db.transaction(async tx => {
    const { link, person } = await invitation(tx, input.token);
    if (link.usedAt) fail("CONFLICT", "This link has already received a request. Ask an Administrator for another link.");
    if (link.kind === "resource") {
      const calendar = await resourceAvailability(tx, null, input);
      return { kind: link.kind, resource: calendar.resource, days: calendar.days.map(day => ({ ...day, remaining: null })) };
    }
    if (!person || (person.category !== "shs" && person.category !== "jhs")) return unavailable();
    const config = await policy(tx), rows = await leaveHolds(tx, input), closed = await closures(tx, input);
    return { kind: link.kind, resource: null, days: dateDays(input.startDate, input.endDate).map(day => ({ day, ...leaveDayState(config, rows, closed, day, person.category as "shs" | "jhs", person.id) })) };
  }, { isolationLevel: "repeatable read" });
}
export async function submitSchedulingInvitation(db: Database, raw: z.input<typeof publicSubmissionInput>, correlationId: string) {
  const input = publicSubmissionInput.parse(raw);
  return write(db, null, async tx => {
    const { link, person } = await invitation(tx, input.token, true);
    if (link.kind === "leave" && (input.resourceId || input.beneficiaryName || input.beneficiaryCategory)) fail("VALIDATION_ERROR", "This link is only for the named teacher's leave.");
    if (link.kind === "resource" && (!input.resourceId || !input.beneficiaryName || !input.beneficiaryCategory)) fail("VALIDATION_ERROR", "Choose a resource and enter the beneficiary's name, category and purpose.");
    const fingerprint = hash([link.id, input.startDate, input.endDate, input.detail, input.resourceId ?? null, input.beneficiaryName ?? null, input.beneficiaryCategory ?? null]);
    if (link.usedAt) {
      if (link.usedOperationId !== input.operationId || link.usedFingerprint !== fingerprint) fail("CONFLICT", "This link has already received a request. Ask an Administrator for another link.");
      return { receiptCode: link.receiptCode!, status: "submitted" as const };
    }
    const table = link.kind === "leave" ? leaveBookings : resourceBookings;
    if ((await tx.select({ id: table.id }).from(table).where(eq(table.operationId, input.operationId))).length) fail("CONFLICT", "This operation ID belongs to another request.");
    let bookingId: string;
    if (link.kind === "leave") {
      if (!person) return unavailable();
      await checkLeaveRange(tx, person.id, person.category, input);
      const [saved] = await tx.insert(leaveBookings).values({ personId: person.id, personName: person.name, category: person.category, invitationId: link.id, requesterId: null, startDate: input.startDate, endDate: input.endDate, reason: input.detail, operationId: input.operationId, fingerprint }).returning({ id: leaveBookings.id });
      if (!saved) fail("CONFLICT", "Your request could not be saved.");
      bookingId = saved.id;
    } else {
      await checkResourceRange(tx, { ...input, resourceId: input.resourceId! }, undefined, true);
      const [saved] = await tx.insert(resourceBookings).values({ resourceId: input.resourceId!, personName: input.beneficiaryName!, beneficiaryCategory: input.beneficiaryCategory!, invitationId: link.id, requesterId: null, startDate: input.startDate, endDate: input.endDate, purpose: input.detail, operationId: input.operationId, fingerprint }).returning({ id: resourceBookings.id });
      if (!saved) fail("CONFLICT", "Your request could not be saved.");
      bookingId = saved.id;
    }
    const receiptCode = randomUUID();
    const consumed = await tx.update(invitations).set({ usedAt: new Date(), usedOperationId: input.operationId, usedFingerprint: fingerprint, receiptCode, version: link.version + 1 }).where(and(eq(invitations.id, link.id), isNull(invitations.usedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, sql`clock_timestamp()`))).returning({ id: invitations.id });
    if (!consumed.length) return unavailable();
    await audit(tx, null, `${link.kind}.public_requested`, bookingId, correlationId, { invitationId: link.id, issuerId: link.createdBy, personId: person?.id ?? null, startDate: input.startDate, endDate: input.endDate, source: "public_link" });
    return { receiptCode, status: "submitted" as const };
  });
}

/** Atomic cross-instance counters are separate from business transactions/audit. */
export async function consumeSchedulingPublicAttempt(db: Database, address: string) {
  const start = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
  for (const [key, limit] of [["global", 1200], ["address:" + tokenHash(address), 120]] as const) {
    const result = await db.execute(sql`INSERT INTO scheduling_public_limits (key, window_start, attempts) VALUES (${key}, ${start}, 1)
      ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN scheduling_public_limits.window_start < ${start} THEN 1 ELSE scheduling_public_limits.attempts + 1 END, window_start = ${start}
      WHERE scheduling_public_limits.window_start < ${start} OR scheduling_public_limits.attempts < ${limit} RETURNING attempts`);
    if (Array.isArray(result) || !result.rows.length) fail("RATE_LIMITED", "Too many requests. Wait a minute before trying again.");
  }
  await db.execute(sql`DELETE FROM scheduling_public_limits WHERE key IN (SELECT key FROM scheduling_public_limits WHERE window_start < now() - interval '1 hour' LIMIT 100)`);
}
