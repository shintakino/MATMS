import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAuditEntry, type AuditTransaction, type Database } from "@matms/db";
import { user } from "@matms/db/schema/auth";
import { userProfiles, type ApplicationRole } from "@matms/db/schema/identity";
import { custodialItems, custodialLots } from "@matms/db/schema/custodial-inventory";
import { bookableResources, employmentAssignments, leaveBookings, leaveClosures, resourceBookings, schedulingEditReplays, schedulingPolicy } from "@matms/db/schema/scheduling";
import { availabilityInput, dateDays, decisionInput, editLeaveInput, editReservationInput, leaveInput, manilaToday, pageInput, policyInput, reservationInput, resourceInput, scheduleDate } from "./scheduling-contract";
import { MatmsError } from "./errors";

type Actor = { id: string; role: ApplicationRole };
const live = ["pending", "approved"] as const;
const defaults = { id: 1, leaveEnabled: false, publicLeave: false, teacherLimit: null, personnelLimit: null, version: 0 };
function fail(code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR", message: string): never { throw new MatmsError(code, message); }
const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

/** All scheduling writes acquire this lock first, including policy and publication. */
async function write<T>(db: Database, actor: Actor, run: (tx: AuditTransaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('matms:scheduling'))`);
    await authorize(tx, actor);
    return run(tx);
  });
}
async function authorize(db: Database | AuditTransaction, actor: Actor) {
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, actor.id));
  if (!profile?.active || profile.mustChangePassword || profile.role !== actor.role) fail("FORBIDDEN", "This action is unavailable.");
}
function admin(actor: Actor) { if (actor.role !== "admin") fail("FORBIDDEN", "Administrator access is required."); }
function manager(actor: Actor) { if (actor.role !== "admin" && actor.role !== "property_custodian") fail("FORBIDDEN", "Resource manager access is required."); }
function operator(actor: Actor) { if (actor.role === "viewer") fail("FORBIDDEN", "This account has read-only access."); }
async function audit(tx: AuditTransaction, actor: Actor, action: string, id: string, correlationId: string, after?: Record<string, string | number | boolean | null>) {
  await writeAuditEntry(tx, { actorId: actor.id, targetType: "scheduling", targetId: id, action: `scheduling.${action}`, correlationId, after });
}
async function policy(db: Database | AuditTransaction) { return (await db.select().from(schedulingPolicy).where(eq(schedulingPolicy.id, 1)))[0] ?? defaults; }
function future(start: string) { if (start < manilaToday()) fail("VALIDATION_ERROR", "New requests must start today or later (Asia/Manila)."); }
const resourceEligible = or(eq(bookableResources.kind, "facility"), and(eq(custodialLots.active, true), eq(custodialItems.active, true), ne(custodialLots.reportingClass, "stock_card")));

type DateRange = { startDate: string; endDate: string };
async function leaveCategory(tx: AuditTransaction, requesterId: string, expected?: "teacher" | "personnel") {
  const [assignment] = await tx.select().from(employmentAssignments).where(eq(employmentAssignments.userId, requesterId));
  if (!assignment?.active) fail("FORBIDDEN", "Ask an Administrator to assign an active teacher/personnel enrollment.");
  if (expected && assignment.category !== expected) fail("CONFLICT", "Employment category changed. Cancel this request and submit a new one.");
  return assignment.category;
}
async function checkLeaveRange(tx: AuditTransaction, requesterId: string, category: "teacher" | "personnel", range: DateRange, excludeId?: string) {
  future(range.startDate);
  const config = await policy(tx);
  if (!config.leaveEnabled) fail("CONFLICT", "Leave booking has not been opened by an Administrator.");
  const rows = await tx.select().from(leaveBookings).where(and(lte(leaveBookings.startDate, range.endDate), gte(leaveBookings.endDate, range.startDate), inArray(leaveBookings.status, [...live]), excludeId ? ne(leaveBookings.id, excludeId) : undefined));
  if (rows.some((r) => r.requesterId === requesterId)) fail("CONFLICT", "You already have leave requested on one or more selected dates.");
  const closures = await tx.select().from(leaveClosures).where(and(gte(leaveClosures.day, range.startDate), lte(leaveClosures.day, range.endDate)));
  if (closures.length) fail("CONFLICT", `Leave booking is closed on ${closures[0]!.day}.`);
  const limit = category === "teacher" ? config.teacherLimit : config.personnelLimit;
  for (const day of dateDays(range.startDate, range.endDate)) {
    if (limit !== null && rows.filter((r) => r.category === category && r.startDate <= day && r.endDate >= day).length >= limit) fail("CONFLICT", `No ${category} leave slots remain on ${day}. Choose another date.`);
  }
}
async function checkResourceRange(tx: AuditTransaction, input: DateRange & { resourceId: string }, excludeId?: string) {
  future(input.startDate);
  const [resource] = await tx.select({ id: bookableResources.id }).from(bookableResources).leftJoin(custodialLots, eq(custodialLots.id, bookableResources.lotId)).leftJoin(custodialItems, eq(custodialItems.id, custodialLots.itemId)).where(and(eq(bookableResources.id, input.resourceId), eq(bookableResources.active, true), resourceEligible));
  if (!resource) fail("NOT_FOUND", "This resource is unavailable.");
  const [held] = await tx.select({ id: resourceBookings.id }).from(resourceBookings).where(and(eq(resourceBookings.resourceId, input.resourceId), inArray(resourceBookings.status, [...live]), lte(resourceBookings.startDate, input.endDate), gte(resourceBookings.endDate, input.startDate), excludeId ? ne(resourceBookings.id, excludeId) : undefined)).limit(1);
  if (held) fail("CONFLICT", "This resource is already reserved on one or more selected dates.");
}

export async function getSchedulingSetup(db: Database, actor: Actor) {
  await authorize(db, actor);
  const [saved, assignment] = await Promise.all([policy(db), db.select().from(employmentAssignments).where(eq(employmentAssignments.userId, actor.id))]);
  return { policy: saved, assignment: assignment[0] ?? null, today: manilaToday() };
}
export async function saveSchedulingPolicy(db: Database, actor: Actor, raw: z.input<typeof policyInput>, correlationId: string) {
  const input = policyInput.parse(raw);
  return write(db, actor, async (tx) => {
    admin(actor);
    const current = await policy(tx);
    if (current.version !== input.expectedVersion) fail("CONFLICT", "Policy changed. Refresh and review it again.");
    const { expectedVersion, ...values } = input;
    await tx.insert(schedulingPolicy).values({ ...values, id: 1, version: current.version + 1 }).onConflictDoUpdate({ target: schedulingPolicy.id, set: { ...values, version: current.version + 1 } });
    await audit(tx, actor, "policy.saved", "1", correlationId, values);
    return { saved: true };
  });
}
export async function schedulingPeople(db: Database, actor: Actor, raw: z.input<typeof pageInput>) {
  await authorize(db, actor); admin(actor);
  const input = pageInput.parse(raw);
  const rows = await db.select({ id: user.id, name: user.name, role: userProfiles.role, accountActive: userProfiles.active, category: employmentAssignments.category, enrolled: employmentAssignments.active }).from(user).innerJoin(userProfiles, eq(user.id, userProfiles.userId)).leftJoin(employmentAssignments, eq(user.id, employmentAssignments.userId))
    .where(ilike(user.name, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`)).orderBy(asc(user.name), asc(user.id)).limit(26).offset((input.page - 1) * 25);
  return { items: rows.slice(0, 25), hasMore: rows.length > 25 };
}
export async function saveEmployment(db: Database, actor: Actor, input: { userId: string; category: "teacher" | "personnel"; active: boolean }, correlationId: string) {
  return write(db, actor, async (tx) => {
    admin(actor);
    const [account] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, input.userId));
    if (!account) fail("NOT_FOUND", "This account is unavailable.");
    await tx.insert(employmentAssignments).values(input).onConflictDoUpdate({ target: employmentAssignments.userId, set: { category: input.category, active: input.active } });
    await audit(tx, actor, "employment.saved", input.userId, correlationId, { category: input.category, active: input.active });
    return { saved: true };
  });
}
export async function listBookableResources(db: Database, actor: Actor | null, raw: z.input<typeof pageInput>) {
  if (actor) await authorize(db, actor);
  const input = pageInput.parse(raw);
  const managing = actor?.role === "admin" || actor?.role === "property_custodian";
  // The public projection is intentionally distinct from the internal resource row.
  const rows = await db.select({ id: bookableResources.id, name: bookableResources.name, kind: bookableResources.kind, description: bookableResources.publicDescription, active: bookableResources.active, published: bookableResources.published, version: bookableResources.version, lotId: bookableResources.lotId }).from(bookableResources)
    .leftJoin(custodialLots, eq(custodialLots.id, bookableResources.lotId)).leftJoin(custodialItems, eq(custodialItems.id, custodialLots.itemId))
    .where(and(ilike(bookableResources.name, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`), managing ? undefined : and(eq(bookableResources.active, true), resourceEligible), actor ? undefined : eq(bookableResources.published, true)))
    .orderBy(asc(bookableResources.name), asc(bookableResources.id)).limit(26).offset((input.page - 1) * 25);
  return { items: rows.slice(0, 25).map((r) => ({ id: r.id, name: r.name, kind: r.kind, description: r.description, ...(actor ? { active: r.active, published: r.published, version: r.version, lotId: r.lotId } : {}) })), hasMore: rows.length > 25 };
}
export async function bookableLotChoices(db: Database, actor: Actor, raw: z.input<typeof pageInput>) {
  await authorize(db, actor); manager(actor);
  const input = pageInput.parse(raw);
  const rows = await db.select({ id: custodialLots.id, article: custodialItems.article, code: custodialItems.code, propertyNumber: custodialLots.propertyNumber, office: custodialLots.office }).from(custodialLots).innerJoin(custodialItems, eq(custodialLots.itemId, custodialItems.id)).where(and(eq(custodialLots.active, true), eq(custodialItems.active, true), ne(custodialLots.reportingClass, "stock_card"), or(ilike(custodialItems.article, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`), ilike(custodialItems.code, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`))))
    .orderBy(asc(custodialItems.code), asc(custodialLots.id)).limit(26).offset((input.page - 1) * 25);
  return { items: rows.slice(0, 25), hasMore: rows.length > 25 };
}
export async function saveBookableResource(db: Database, actor: Actor, raw: z.input<typeof resourceInput>, correlationId: string) {
  const input = resourceInput.parse(raw);
  return write(db, actor, async (tx) => {
    manager(actor);
    const existing = input.id ? (await tx.select().from(bookableResources).where(eq(bookableResources.id, input.id)))[0] : null;
    if (input.id && !existing) fail("NOT_FOUND", "This resource is unavailable.");
    if (existing && existing.version !== input.expectedVersion) fail("CONFLICT", "Resource changed. Refresh before saving.");
    if (input.lotId) {
      const [lot] = await tx.select({ lot: custodialLots, item: custodialItems }).from(custodialLots).innerJoin(custodialItems, eq(custodialItems.id, custodialLots.itemId)).where(eq(custodialLots.id, input.lotId)).for("share");
      if (!lot || !lot.lot.active || !lot.item.active || lot.lot.reportingClass === "stock_card") fail("VALIDATION_ERROR", "Choose an active semi-expendable or PPE lot.");
    }
    if (existing) {
      const [history] = await tx.select({ id: resourceBookings.id }).from(resourceBookings).where(eq(resourceBookings.resourceId, existing.id)).limit(1);
      if (history && (input.lotId !== existing.lotId || input.kind !== existing.kind)) fail("CONFLICT", "A resource with booking history cannot be linked to another asset.");
      if (!input.active) {
        const [open] = await tx.select({ id: resourceBookings.id }).from(resourceBookings).where(and(eq(resourceBookings.resourceId, existing.id), inArray(resourceBookings.status, [...live]), gte(resourceBookings.endDate, manilaToday()))).limit(1);
        if (open) fail("CONFLICT", "Resolve future and ongoing bookings before retiring this resource.");
      }
    }
    const values = { name: input.name, normalizedName: input.name.normalize("NFKC").toLocaleUpperCase("en-US"), kind: input.kind, lotId: input.lotId, publicDescription: input.publicDescription, published: input.published, active: input.active, version: existing ? existing.version + 1 : 0 };
    const duplicate = await tx.select({ id: bookableResources.id }).from(bookableResources).where(eq(bookableResources.normalizedName, values.normalizedName));
    if (duplicate.some((r) => r.id !== input.id)) fail("CONFLICT", "That resource name is already reserved.");
    const [saved] = existing ? await tx.update(bookableResources).set(values).where(eq(bookableResources.id, existing.id)).returning() : await tx.insert(bookableResources).values(values).returning();
    if (!saved) fail("CONFLICT", "Resource could not be saved.");
    await audit(tx, actor, "resource.saved", saved.id, correlationId, { name: saved.name, active: saved.active, published: saved.published });
    return { id: saved.id };
  });
}

export async function saveLeaveClosure(db: Database, actor: Actor, input: { day: string; label: string; closed: boolean }, correlationId: string) {
  scheduleDate.parse(input.day);
  return write(db, actor, async (tx) => {
    admin(actor); future(input.day);
    if (input.closed) {
      const [held] = await tx.select({ id: leaveBookings.id }).from(leaveBookings).where(and(lte(leaveBookings.startDate, input.day), gte(leaveBookings.endDate, input.day), inArray(leaveBookings.status, [...live]))).limit(1);
      if (held) fail("CONFLICT", "Resolve existing leave requests on this date before closing it.");
      await tx.insert(leaveClosures).values({ day: input.day, label: input.label }).onConflictDoUpdate({ target: leaveClosures.day, set: { label: input.label } });
    } else await tx.delete(leaveClosures).where(eq(leaveClosures.day, input.day));
    await audit(tx, actor, "leave_closure.saved", input.day, correlationId, { closed: input.closed });
    return { saved: true };
  });
}
export async function createLeaveBooking(db: Database, actor: Actor, raw: z.input<typeof leaveInput>, correlationId: string) {
  const input = leaveInput.parse(raw);
  return write(db, actor, async (tx) => {
    operator(actor);
    const fingerprint = hash([actor.id, input.startDate, input.endDate, input.reason]);
    const [replay] = await tx.select().from(leaveBookings).where(eq(leaveBookings.operationId, input.operationId));
    if (replay) {
      if (replay.requesterId !== actor.id || replay.fingerprint !== fingerprint) fail("CONFLICT", "This operation ID belongs to a different request.");
      return { id: replay.id };
    }
    const category = await leaveCategory(tx, actor.id);
    await checkLeaveRange(tx, actor.id, category, input);
    const [saved] = await tx.insert(leaveBookings).values({ ...input, requesterId: actor.id, category: category, fingerprint }).returning({ id: leaveBookings.id });
    if (!saved) fail("CONFLICT", "Request could not be saved.");
    await audit(tx, actor, "leave.requested", saved.id, correlationId, { startDate: input.startDate, endDate: input.endDate, category: category });
    return saved;
  });
}
export async function createResourceBooking(db: Database, actor: Actor, raw: z.input<typeof reservationInput>, correlationId: string) {
  const input = reservationInput.parse(raw);
  return write(db, actor, async (tx) => {
    operator(actor);
    const fingerprint = hash([actor.id, input.resourceId, input.startDate, input.endDate, input.purpose]);
    const [replay] = await tx.select().from(resourceBookings).where(eq(resourceBookings.operationId, input.operationId));
    if (replay) {
      if (replay.requesterId !== actor.id || replay.fingerprint !== fingerprint) fail("CONFLICT", "This operation ID belongs to a different request.");
      return { id: replay.id };
    }
    await checkResourceRange(tx, input);
    const [saved] = await tx.insert(resourceBookings).values({ ...input, requesterId: actor.id, fingerprint }).returning({ id: resourceBookings.id });
    if (!saved) fail("CONFLICT", "Reservation could not be saved.");
    await audit(tx, actor, "resource.requested", saved.id, correlationId, { resourceId: input.resourceId, startDate: input.startDate, endDate: input.endDate });
    return saved;
  });
}
type EditRequest = DateRange & {
  kind: "leave" | "resource"; id: string; expectedVersion: number; operationId: string;
  detail: string; resourceId: string | null; changeReason: string;
};
async function editRequest(db: Database, actor: Actor, input: EditRequest, correlationId: string) {
  return write(db, actor, async (tx) => {
    operator(actor);
    const [row] = input.kind === "leave"
      ? await tx.select({ id: leaveBookings.id, requesterId: leaveBookings.requesterId, startDate: leaveBookings.startDate, endDate: leaveBookings.endDate, status: leaveBookings.status, version: leaveBookings.version, detail: leaveBookings.reason, category: leaveBookings.category, resourceId: sql<string | null>`null`, decidedBy: leaveBookings.decidedBy, decidedAt: leaveBookings.decidedAt, decisionNote: leaveBookings.decisionNote }).from(leaveBookings).where(eq(leaveBookings.id, input.id))
      : await tx.select({ id: resourceBookings.id, requesterId: resourceBookings.requesterId, startDate: resourceBookings.startDate, endDate: resourceBookings.endDate, status: resourceBookings.status, version: resourceBookings.version, detail: resourceBookings.purpose, category: sql<"teacher" | "personnel" | null>`null`, resourceId: resourceBookings.resourceId, decidedBy: resourceBookings.decidedBy, decidedAt: resourceBookings.decidedAt, decisionNote: resourceBookings.decisionNote }).from(resourceBookings).where(eq(resourceBookings.id, input.id));
    const managing = input.kind === "leave" ? actor.role === "admin" : actor.role === "admin" || actor.role === "property_custodian";
    if (!row || (!managing && row.requesterId !== actor.id)) fail("NOT_FOUND", "This booking is unavailable.");
    const [requester] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, row.requesterId));
    if (!requester?.active || requester.mustChangePassword || requester.role === "viewer") fail("CONFLICT", "The requester must have an active account with write access before editing.");
    if (input.kind === "leave") await leaveCategory(tx, row.requesterId, row.category ?? undefined);
    const fingerprint = hash([input.kind, actor.id, input.id, input.expectedVersion, input.startDate, input.endDate, input.detail, input.resourceId, input.changeReason]);
    const [replay] = await tx.select().from(schedulingEditReplays).where(eq(schedulingEditReplays.operationId, input.operationId));
    if (replay) {
      if (replay.actorId !== actor.id || replay.fingerprint !== fingerprint || (input.kind === "leave" ? replay.leaveId : replay.reservationId) !== row.id) fail("CONFLICT", "This operation ID belongs to a different edit.");
      return { id: row.id, version: replay.resultingVersion };
    }
    if (row.version !== input.expectedVersion) fail("CONFLICT", "This request changed. Refresh and review the latest version before editing.");
    if ((row.status !== "pending" && row.status !== "approved") || row.startDate < manilaToday()) fail("CONFLICT", "Only pending or approved requests that have not started can be edited.");
    if (row.startDate === input.startDate && row.endDate === input.endDate && row.detail === input.detail && row.resourceId === input.resourceId) fail("VALIDATION_ERROR", "Change the dates, reason, purpose or resource before saving.");
    if (input.kind === "leave") await checkLeaveRange(tx, row.requesterId, row.category!, input, row.id);
    else {
      if (!input.resourceId) fail("VALIDATION_ERROR", "Choose a resource.");
      await checkResourceRange(tx, { ...input, resourceId: input.resourceId }, row.id);
    }
    const common = { startDate: input.startDate, endDate: input.endDate, version: row.version + 1, status: "pending" as const, decidedBy: null, decidedAt: null, decisionNote: null };
    if (input.kind === "leave") await tx.update(leaveBookings).set({ ...common, reason: input.detail }).where(eq(leaveBookings.id, row.id));
    else await tx.update(resourceBookings).set({ ...common, resourceId: input.resourceId!, purpose: input.detail }).where(eq(resourceBookings.id, row.id));
    await tx.insert(schedulingEditReplays).values({ operationId: input.operationId, actorId: actor.id, leaveId: input.kind === "leave" ? row.id : null, reservationId: input.kind === "resource" ? row.id : null, fingerprint, resultingVersion: common.version });
    await writeAuditEntry(tx, {
      actorId: actor.id, action: `scheduling.${input.kind}.updated`, targetType: "scheduling", targetId: row.id, correlationId,
      before: { requesterId: row.requesterId, category: row.category, resourceId: row.resourceId, startDate: row.startDate, endDate: row.endDate, detail: row.detail, status: row.status, version: row.version, decidedBy: row.decidedBy, decidedAt: row.decidedAt?.toISOString() ?? null, decisionNote: row.decisionNote },
      after: { requesterId: row.requesterId, category: row.category, resourceId: input.resourceId, startDate: input.startDate, endDate: input.endDate, detail: input.detail, status: common.status, version: common.version, decidedBy: null, decidedAt: null, decisionNote: null, changeReason: input.changeReason },
    });
    return { id: row.id, version: common.version };
  });
}
export async function editLeaveBooking(db: Database, actor: Actor, raw: z.input<typeof editLeaveInput>, correlationId: string) {
  const input = editLeaveInput.parse(raw);
  return editRequest(db, actor, { ...input, kind: "leave", detail: input.reason, resourceId: null }, correlationId);
}
export async function editResourceBooking(db: Database, actor: Actor, raw: z.input<typeof editReservationInput>, correlationId: string) {
  const input = editReservationInput.parse(raw);
  return editRequest(db, actor, { ...input, kind: "resource", detail: input.purpose }, correlationId);
}

export async function decideBooking(db: Database, actor: Actor, raw: z.input<typeof decisionInput>, correlationId: string) {
  const input = decisionInput.parse(raw);
  return write(db, actor, async (tx) => {
    operator(actor);
    const table = input.kind === "leave" ? leaveBookings : resourceBookings;
    const [row] = await tx.select({ id: table.id, requesterId: table.requesterId, status: table.status, version: table.version, endDate: table.endDate, decisionNote: table.decisionNote }).from(table).where(eq(table.id, input.id));
    const managing = input.kind === "leave" ? actor.role === "admin" : actor.role === "admin" || actor.role === "property_custodian";
    if (!row || (!managing && row.requesterId !== actor.id)) fail("NOT_FOUND", "This booking is unavailable.");
    if (!managing && input.status !== "cancelled") fail("FORBIDDEN", "You can only cancel your own requests.");
    if (row.version !== input.expectedVersion || !live.includes(row.status as typeof live[number]) || (input.status !== "cancelled" && row.status !== "pending")) fail("CONFLICT", "This request changed or already has a final decision. Refresh before continuing.");
    if (row.endDate < manilaToday()) fail("CONFLICT", "Past bookings are retained as history and cannot be changed.");
    await tx.update(table).set({ status: input.status, decisionNote: input.note, decidedBy: actor.id, decidedAt: new Date(), version: row.version + 1 }).where(eq(table.id, row.id));
    await audit(tx, actor, `${input.kind}.${input.status}`, row.id, correlationId, { status: input.status, note: input.note, previousStatus: row.status, previousNote: row.decisionNote });
    return { saved: true };
  });
}
export async function listScheduleRequests(db: Database, actor: Actor, input: { kind: "leave" | "resource"; page: number; scope: "mine" | "all" }) {
  await authorize(db, actor);
  const managing = input.kind === "leave" ? actor.role === "admin" : actor.role === "admin" || actor.role === "property_custodian";
  if (input.scope === "all" && !managing) fail("FORBIDDEN", "This request register is unavailable.");
  const table = input.kind === "leave" ? leaveBookings : resourceBookings;
  const rows = await db.select({ id: table.id, name: user.name, requesterId: table.requesterId, startDate: table.startDate, endDate: table.endDate, status: table.status, version: table.version, decisionNote: table.decisionNote, createdAt: table.createdAt,
    detail: input.kind === "leave" ? leaveBookings.reason : resourceBookings.purpose,
    resourceName: input.kind === "leave" ? sql<string | null>`null` : bookableResources.name,
    resourceId: input.kind === "leave" ? sql<string | null>`null` : resourceBookings.resourceId,
  }).from(table).innerJoin(user, eq(user.id, table.requesterId)).leftJoin(bookableResources, input.kind === "resource" ? eq(bookableResources.id, resourceBookings.resourceId) : sql`false`)
    .where(input.scope === "mine" ? eq(table.requesterId, actor.id) : undefined).orderBy(desc(table.createdAt), desc(table.id)).limit(26).offset((input.page - 1) * 25);
  return { items: rows.slice(0, 25), hasMore: rows.length > 25 };
}

/** Public resource response contains dates/status only; never reservation rows. */
export async function resourceAvailability(db: Database, actor: Actor | null, raw: z.input<typeof availabilityInput>) {
  const input = availabilityInput.parse(raw);
  if (actor) await authorize(db, actor);
  if (!input.resourceId) return { resource: null, days: [] };
  const [resource] = await db.select({ id: bookableResources.id, name: bookableResources.name, kind: bookableResources.kind, description: bookableResources.publicDescription }).from(bookableResources).leftJoin(custodialLots, eq(custodialLots.id, bookableResources.lotId)).leftJoin(custodialItems, eq(custodialItems.id, custodialLots.itemId))
    .where(and(eq(bookableResources.id, input.resourceId), eq(bookableResources.active, true), resourceEligible, actor ? undefined : eq(bookableResources.published, true)));
  if (!resource) fail("NOT_FOUND", "This resource is unavailable.");
  const rows = await db.select({ startDate: resourceBookings.startDate, endDate: resourceBookings.endDate }).from(resourceBookings).where(and(eq(resourceBookings.resourceId, resource.id), inArray(resourceBookings.status, [...live]), lte(resourceBookings.startDate, input.endDate), gte(resourceBookings.endDate, input.startDate)));
  const today = manilaToday();
  return { resource, days: dateDays(input.startDate, input.endDate).map((day) => ({ day, status: rows.some((r) => r.startDate <= day && r.endDate >= day) ? "reserved" as const : day < today ? "past" as const : "available" as const })) };
}
/** Only approved display names are published, following the explicit school request. */
export async function leaveAvailability(db: Database, actor: Actor | null, raw: z.input<typeof availabilityInput>) {
  const input = availabilityInput.parse(raw);
  if (actor) await authorize(db, actor);
  return db.transaction(async (tx) => {
    const config = await policy(tx);
    if (!actor && !config.publicLeave) return { published: false, enabled: false, days: [], approved: [] };
    const rows = await tx.select({ name: user.name, category: leaveBookings.category, startDate: leaveBookings.startDate, endDate: leaveBookings.endDate, status: leaveBookings.status }).from(leaveBookings).innerJoin(user, eq(user.id, leaveBookings.requesterId)).where(and(inArray(leaveBookings.status, [...live]), lte(leaveBookings.startDate, input.endDate), gte(leaveBookings.endDate, input.startDate))).orderBy(asc(user.name), asc(leaveBookings.startDate), asc(leaveBookings.id));
    const closed = await tx.select({ day: leaveClosures.day }).from(leaveClosures).where(and(gte(leaveClosures.day, input.startDate), lte(leaveClosures.day, input.endDate)));
    return { published: config.publicLeave, enabled: config.leaveEnabled, days: dateDays(input.startDate, input.endDate).map((day) => {
      const state = (category: "teacher" | "personnel", limit: number | null) => {
        const held = rows.filter((r) => r.category === category && r.startDate <= day && r.endDate >= day).length;
        const status: "past" | "closed" | "full" | "available" = day < manilaToday() ? "past" : !config.leaveEnabled || closed.some((r) => r.day === day) ? "closed" : limit !== null && held >= limit ? "full" : "available";
        return { status, remaining: limit === null ? null : Math.max(0, limit - held) };
      };
      return { day, teacher: state("teacher", config.teacherLimit), personnel: state("personnel", config.personnelLimit) };
    }), approved: config.publicLeave ? rows.filter((r) => r.status === "approved").map((r) => ({ name: r.name, category: r.category, startDate: r.startDate < input.startDate ? input.startDate : r.startDate, endDate: r.endDate > input.endDate ? input.endDate : r.endDate })) : [] };
  }, { isolationLevel: "repeatable read" });
}
