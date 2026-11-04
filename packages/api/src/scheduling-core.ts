import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { writeAuditEntry, type AuditTransaction, type Database } from "@matms/db";
import { userProfiles, type ApplicationRole } from "@matms/db/schema/identity";
import { custodialItems, custodialLots } from "@matms/db/schema/custodial-inventory";
import { bookableResources, leaveBookings, leaveClosures, resourceBookings, schedulingPeople, schedulingPolicy } from "@matms/db/schema/scheduling";
import { categoryLabels, dateDays, manilaToday } from "./scheduling-contract";
import { MatmsError } from "./errors";

export type Actor = { id: string; role: ApplicationRole };
export type Reader = Database | AuditTransaction;
export type LeaveCategory = typeof leaveBookings.$inferSelect.category;
export type DateRange = { startDate: string; endDate: string };
export const live = ["pending", "approved"] as const;
export const defaults = { id: 1, leaveEnabled: false, publicLeave: false, teacherLimit: null, personnelLimit: null, shsLimit: null, jhsLimit: null, version: 0 };
export function fail(code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "RATE_LIMITED", message: string): never { throw new MatmsError(code, message); }
export const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

/** The same lock serializes policies, links, directory eligibility and capacity. */
export async function write<T>(db: Database, actor: Actor | null, run: (tx: AuditTransaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('matms:scheduling'))`);
    if (actor) await authorize(tx, actor, true);
    return run(tx);
  });
}
export async function authorize(db: Reader, actor: Actor, lock = false) {
  const query = db.select().from(userProfiles).where(eq(userProfiles.userId, actor.id));
  const [profile] = await (lock ? query.for("share") : query);
  if (!profile?.active || profile.mustChangePassword || profile.role !== actor.role) fail("FORBIDDEN", "This action is unavailable.");
}
export function admin(actor: Actor) { if (actor.role !== "admin") fail("FORBIDDEN", "Administrator access is required."); }
export const manager = admin;
export async function leaveOperator(db: Reader, actor: Actor) {
  if (actor.role === "admin") return;
  if (actor.role !== "viewer") {
    const [person] = await db.select({ id: schedulingPeople.id }).from(schedulingPeople).where(and(eq(schedulingPeople.userId, actor.id), eq(schedulingPeople.category, "personnel"), eq(schedulingPeople.active, true)));
    if (person) return;
  }
  fail("FORBIDDEN", "Only Administrators and active linked personnel can file leave requests.");
}
export async function canFileLeave(db: Reader, actor: Actor) {
  try { await leaveOperator(db, actor); return true; } catch (error) { if (error instanceof MatmsError && error.code === "FORBIDDEN") return false; throw error; }
}
export async function audit(tx: AuditTransaction, actor: Actor | null, action: string, id: string, correlationId: string, after?: Record<string, string | number | boolean | null>) {
  await writeAuditEntry(tx, { actorId: actor?.id ?? null, targetType: "scheduling", targetId: id, action: `scheduling.${action}`, correlationId, after });
}
export async function policy(db: Reader) { return (await db.select().from(schedulingPolicy).where(eq(schedulingPolicy.id, 1)))[0] ?? defaults; }
export function future(start: string) { if (start < manilaToday()) fail("VALIDATION_ERROR", "New requests must start today or later (Asia/Manila)."); }
export const resourceEligible = or(eq(bookableResources.kind, "facility"), and(eq(custodialLots.active, true), eq(custodialItems.active, true), ne(custodialLots.reportingClass, "stock_card")));

type Hold = { personId: string; category: LeaveCategory; startDate: string; endDate: string };
type Policy = Awaited<ReturnType<typeof policy>>;
function remaining(config: Policy, rows: Hold[], category: "shs" | "jhs" | "personnel") {
  const ownLimit = category === "personnel" ? config.personnelLimit : category === "shs" ? config.shsLimit : config.jhsLimit;
  const ownHeld = rows.filter(r => r.category === category || (category !== "personnel" && r.category === "teacher")).length;
  const limits: number[] = ownLimit === null ? [] : [Math.max(0, ownLimit - ownHeld)];
  if (category !== "personnel" && config.teacherLimit !== null) limits.push(Math.max(0, config.teacherLimit - rows.filter(r => r.category !== "personnel").length));
  return limits.length ? Math.min(...limits) : null;
}
export function leaveDayState(config: Policy, rows: Hold[], closed: Array<{ day: string }>, day: string, category: "shs" | "jhs" | "personnel", personId?: string) {
  const held = rows.filter(r => r.startDate <= day && r.endDate >= day);
  const slots = remaining(config, held, category);
  const status: "past" | "closed" | "reserved" | "full" | "available" = day < manilaToday() ? "past"
    : !config.leaveEnabled || closed.some(r => r.day === day) ? "closed"
      : personId && held.some(r => r.personId === personId) ? "reserved" : slots === 0 ? "full" : "available";
  return { status, remaining: slots };
}
export async function leaveHolds(db: Reader, range: DateRange, excludeId?: string) {
  return db.select({ personId: leaveBookings.personId, category: leaveBookings.category, startDate: leaveBookings.startDate, endDate: leaveBookings.endDate }).from(leaveBookings).where(and(lte(leaveBookings.startDate, range.endDate), gte(leaveBookings.endDate, range.startDate), inArray(leaveBookings.status, [...live]), excludeId ? ne(leaveBookings.id, excludeId) : undefined));
}
export async function closures(db: Reader, range: DateRange) { return db.select({ day: leaveClosures.day }).from(leaveClosures).where(and(gte(leaveClosures.day, range.startDate), lte(leaveClosures.day, range.endDate))); }
export async function checkLeaveRange(tx: AuditTransaction, personId: string, category: LeaveCategory, range: DateRange, excludeId?: string) {
  future(range.startDate);
  if (category === "teacher") fail("CONFLICT", "Classify this teacher as SHS or JHS before filing new leave.");
  const config = await policy(tx), rows = await leaveHolds(tx, range, excludeId), closed = await closures(tx, range);
  for (const day of dateDays(range.startDate, range.endDate)) {
    const state = leaveDayState(config, rows, closed, day, category, personId);
    if (state.status === "closed") fail("CONFLICT", `Leave requests are closed on ${day}. Ask an Administrator about policy or closed dates.`);
    if (state.status === "reserved") fail("CONFLICT", `This person already has leave requested on ${day}.`);
    if (state.status === "full") fail("CONFLICT", `No ${categoryLabels[category]} leave slots remain on ${day}. Choose another date.`);
  }
}
export async function checkResourceRange(tx: AuditTransaction, input: DateRange & { resourceId: string }, excludeId?: string, published = false) {
  future(input.startDate);
  const [resource] = await tx.select({ id: bookableResources.id }).from(bookableResources).leftJoin(custodialLots, eq(custodialLots.id, bookableResources.lotId)).leftJoin(custodialItems, eq(custodialItems.id, custodialLots.itemId)).where(and(eq(bookableResources.id, input.resourceId), eq(bookableResources.active, true), resourceEligible, published ? eq(bookableResources.published, true) : undefined));
  if (!resource) fail("NOT_FOUND", "This resource is unavailable.");
  const [held] = await tx.select({ id: resourceBookings.id }).from(resourceBookings).where(and(eq(resourceBookings.resourceId, input.resourceId), inArray(resourceBookings.status, [...live]), lte(resourceBookings.startDate, input.endDate), gte(resourceBookings.endDate, input.startDate), excludeId ? ne(resourceBookings.id, excludeId) : undefined)).limit(1);
  if (held) fail("CONFLICT", "This resource is already reserved on one or more selected dates.");
}
