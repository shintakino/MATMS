import { afterAll, beforeAll, expect, test } from "bun:test";
import { count, eq, inArray } from "drizzle-orm";
import { createDb } from "@matms/db";
import { provisionAccount } from "@matms/auth/provisioning";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { auditLogs } from "@matms/db/schema/audit";
import { custodialItems, custodialLots, custodialTransactions } from "@matms/db/schema/custodial-inventory";
import { bookableResources, employmentAssignments, leaveBookings, leaveClosures, resourceBookings, schedulingEditReplays, schedulingPolicy } from "@matms/db/schema/scheduling";
import { availabilityInput, dateDays, leaveInput, manilaToday, scheduleDate } from "./scheduling-contract";
import * as service from "./scheduling-service";
import { updateCustodialItem, updateCustodialLot } from "./custodial-service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Scheduling tests require an isolated _test database.");
const db = createDb({ DATABASE_URL: url });
const correlation = crypto.randomUUID();
const suffix = correlation.slice(0, 8);
const actors: Array<{ id: string; role: "admin" | "staff" | "property_custodian" | "viewer" }> = [];
const resources: string[] = [];
let itemId = "", lotId = "";
let original: typeof schedulingPolicy.$inferSelect | undefined;
function day(offset: number) { return new Date(Date.parse(`${manilaToday()}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
const request = (offset: number, end = offset) => ({ startDate: day(offset), endDate: day(end), reason: "Private fixture reason", operationId: crypto.randomUUID() });
const range = { startDate: day(10), endDate: day(30) };
async function policy(values: Partial<{ publicLeave: boolean; leaveEnabled: boolean; teacherLimit: number | null; personnelLimit: number | null }> = {}) {
  const config = (await service.getSchedulingSetup(db, actors[0]!)).policy;
  await service.saveSchedulingPolicy(db, actors[0]!, { leaveEnabled: true, publicLeave: false, teacherLimit: 1, personnelLimit: 1, ...values, expectedVersion: config.version }, correlation);
}
async function resource(published = true, kind: "facility" | "equipment" = "facility") {
  const saved = await service.saveBookableResource(db, actors[0]!, { name: `${kind} ${crypto.randomUUID()}`, kind, lotId: kind === "equipment" ? lotId : null, publicDescription: "Public fixture description", active: true, published }, correlation);
  resources.push(saved.id); return saved.id;
}
beforeAll(async () => {
  original = (await db.select().from(schedulingPolicy))[0];
  for (const [i, role] of (["admin", "staff", "staff", "staff", "property_custodian", "viewer"] as const).entries()) {
    const saved = await provisionAccount(db, { name: `Booking person ${i} ${suffix}`, email: `schedule-${i}-${correlation}@example.test`, password: "fictional scheduling password", role, actorId: null, correlationId: correlation, mustChangePassword: false });
    actors.push({ id: saved.id, role });
  }
  for (const i of [1, 2, 3]) await service.saveEmployment(db, actors[0]!, { userId: actors[i]!.id, category: i === 3 ? "personnel" : "teacher", active: true }, correlation);
  const [item] = await db.insert(custodialItems).values({ code: `SCHEDULE-${suffix}`, normalizedCode: `SCHEDULE-${suffix}`.toUpperCase(), article: "Fictional projector", description: "Fixture", unit: "unit" }).returning(); itemId = item!.id;
  const [lot] = await db.insert(custodialLots).values({ itemId, reportingClass: "ppe", fundCluster: "Fixture fund", office: "Fixture office" }).returning(); lotId = lot!.id;
});
afterAll(async () => {
  const ids = actors.map((a) => a.id);
  await db.delete(schedulingEditReplays).where(inArray(schedulingEditReplays.actorId, ids));
  await db.delete(resourceBookings).where(inArray(resourceBookings.requesterId, ids));
  await db.delete(leaveBookings).where(inArray(leaveBookings.requesterId, ids));
  if (resources.length) await db.delete(bookableResources).where(inArray(bookableResources.id, resources));
  await db.delete(leaveClosures).where(inArray(leaveClosures.day, [day(25), day(26), day(44)]));
  await db.delete(employmentAssignments).where(inArray(employmentAssignments.userId, ids));
  await db.delete(schedulingPolicy);
  if (original) await db.insert(schedulingPolicy).values(original);
  if (lotId) await db.delete(custodialLots).where(eq(custodialLots.id, lotId));
  if (itemId) await db.delete(custodialItems).where(eq(custodialItems.id, itemId));
  await db.delete(auditLogs).where(eq(auditLogs.correlationId, correlation));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, ids));
  await db.delete(user).where(inArray(user.id, ids));
  await db.$client.end();
});

test("real dates, leap dates, inclusive ranges and public bounds are validated", () => {
  expect(scheduleDate.safeParse("2028-02-29").success).toBe(true);
  for (const date of ["2027-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-1-1", "not-a-date"]) expect(scheduleDate.safeParse(date).success).toBe(false);
  expect(dateDays("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  expect(leaveInput.safeParse({ ...request(12), endDate: day(11) }).success).toBe(false);
  expect(availabilityInput.safeParse({ startDate: day(0), endDate: day(31) }).success).toBe(false);
});

test("leave capacity, replay, permissions, publication and cancellation are atomic", async () => {
  await policy({ leaveEnabled: false });
  await expect(service.createLeaveBooking(db, actors[1]!, request(10), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await service.leaveAvailability(db, null, range)).approved).toEqual([]);
  await policy();
  const payload = request(10, 11);
  const first = await service.createLeaveBooking(db, actors[1]!, payload, correlation);
  expect(await service.createLeaveBooking(db, actors[1]!, payload, correlation)).toEqual(first);
  await expect(service.createLeaveBooking(db, actors[1]!, { ...payload, reason: "Changed intent" }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.createLeaveBooking(db, actors[2]!, request(9, 10), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await db.select().from(leaveBookings).where(eq(leaveBookings.operationId, payload.operationId))).length).toBe(1);
  expect((await db.select().from(auditLogs).where(eq(auditLogs.targetId, first.id))).length).toBe(1);
  await service.createLeaveBooking(db, actors[3]!, request(10), correlation); // separate personnel capacity
  await expect(service.listScheduleRequests(db, actors[2]!, { kind: "leave", scope: "all", page: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await service.listScheduleRequests(db, actors[2]!, { kind: "leave", scope: "mine", page: 1 })).items).toHaveLength(0);
  await expect(service.decideBooking(db, actors[2]!, { kind: "leave", id: first.id, status: "approved", note: "Unauthorized", expectedVersion: 0 }, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.decideBooking(db, actors[4]!, { kind: "leave", id: first.id, status: "approved", note: "Custodian cannot approve leave", expectedVersion: 0 }, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await service.decideBooking(db, actors[0]!, { kind: "leave", id: first.id, status: "approved", note: "Approved privately", expectedVersion: 0 }, correlation);
  expect((await service.leaveAvailability(db, null, range)).published).toBe(false);
  await policy({ publicLeave: true });
  const published = await service.leaveAvailability(db, null, range);
  expect(published.approved).toHaveLength(1);
  expect(published.approved[0]!.name).toContain("Booking person 1");
  expect(Object.keys(published.approved[0]!).sort()).toEqual(["category", "endDate", "name", "startDate"]);
  const serialized = JSON.stringify(published);
  for (const secret of [payload.reason, "Approved privately", first.id, actors[1]!.id, "@example.test", "Booking person 3"]) expect(serialized).not.toContain(secret);
  expect(published.days.find((d) => d.day === day(10))!.teacher.status).toBe("full");
  await expect(service.decideBooking(db, actors[0]!, { kind: "leave", id: first.id, status: "cancelled", note: "Stale", expectedVersion: 0 }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.decideBooking(db, actors[1]!, { kind: "leave", id: first.id, status: "cancelled", note: "Changed plans", expectedVersion: 1 }, correlation);
  expect((await service.leaveAvailability(db, null, range)).approved).toHaveLength(0);
  await service.createLeaveBooking(db, actors[2]!, request(10), correlation);
  await expect(service.createLeaveBooking(db, actors[5]!, request(12), correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("concurrent last leave slot and partial range conflicts never overbook", async () => {
  const results = await Promise.allSettled([service.createLeaveBooking(db, actors[1]!, request(13), correlation), service.createLeaveBooking(db, actors[2]!, request(13), correlation)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rows = await db.select().from(leaveBookings).where(eq(leaveBookings.startDate, day(13)));
  expect(rows).toHaveLength(1);
  await expect(service.saveLeaveClosure(db, actors[0]!, { day: day(13), label: "Closed", closed: true }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.saveLeaveClosure(db, actors[0]!, { day: day(25), label: "Private event", closed: true }, correlation);
  await expect(service.createLeaveBooking(db, actors[1]!, request(24, 26), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(JSON.stringify(await service.leaveAvailability(db, null, { startDate: day(24), endDate: day(26) }))).not.toContain("Private event");
  await service.saveLeaveClosure(db, actors[0]!, { day: day(25), label: "Reopened", closed: false }, correlation);
});

test("whole-day equipment/facility reservations serialize, remain private and never post stock", async () => {
  const [before] = await db.select({ value: count() }).from(custodialTransactions);
  const facility = await resource();
  const equipment = await resource(true, "equipment");
  const hidden = await resource(false);
  const publicList = await service.listBookableResources(db, null, { page: 1, search: "" });
  expect(publicList.items.some((r) => r.id === hidden)).toBe(false);
  expect(publicList.items.some((r) => r.id === equipment)).toBe(true);
  expect(Object.keys(publicList.items[0]!).sort()).toEqual(["description", "id", "kind", "name"]);
  await expect(service.resourceAvailability(db, null, { ...range, resourceId: hidden })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const payload = { startDate: day(15), endDate: day(16), resourceId: facility, purpose: "Private purpose", operationId: crypto.randomUUID() };
  const results = await Promise.allSettled([service.createResourceBooking(db, actors[1]!, payload, correlation), service.createResourceBooking(db, actors[2]!, { ...payload, operationId: crypto.randomUUID() }, correlation)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winning = results[0]!.status === "fulfilled" ? actors[1]! : actors[2]!;
  const [row] = await db.select().from(resourceBookings).where(eq(resourceBookings.resourceId, facility));
  expect(row).toBeDefined();
  const replayPayload = { ...payload, operationId: row!.operationId };
  expect(await service.createResourceBooking(db, winning, replayPayload, correlation)).toEqual({ id: row!.id });
  await expect(service.createResourceBooking(db, winning, { ...replayPayload, purpose: "Different" }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.createResourceBooking(db, actors[1]!, { ...payload, startDate: day(17), endDate: day(17), operationId: crypto.randomUUID() }, correlation);
  const available = await service.resourceAvailability(db, null, { ...range, resourceId: facility });
  expect(available.days.find((d) => d.day === day(14))!.status).toBe("available");
  expect(available.days.find((d) => d.day === day(15))!.status).toBe("reserved");
  expect(available.days.find((d) => d.day === day(16))!.status).toBe("reserved");
  for (const secret of [payload.purpose, row!.id, winning.id, "@example.test"]) expect(JSON.stringify(available)).not.toContain(secret);
  await service.decideBooking(db, actors[4]!, { kind: "resource", id: row!.id, status: "approved", note: "Approved", expectedVersion: 0 }, correlation);
  await service.decideBooking(db, winning, { kind: "resource", id: row!.id, status: "cancelled", note: "Cancelled", expectedVersion: 1 }, correlation);
  expect((await service.resourceAvailability(db, null, { ...range, resourceId: facility })).days.find((d) => d.day === day(15))!.status).toBe("available");
  const [r] = await db.select().from(bookableResources).where(eq(bookableResources.id, facility));
  await expect(service.saveBookableResource(db, actors[0]!, { id: facility, expectedVersion: r!.version, name: r!.name, kind: "facility", lotId: null, active: false, published: true, publicDescription: "" }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.saveBookableResource(db, actors[1]!, { name: "Denied", kind: "facility", lotId: null, active: true, published: true, publicDescription: "" }, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const [after] = await db.select({ value: count() }).from(custodialTransactions);
  expect(after?.value).toBe(before?.value);
});

test("audit failure rolls back requests and deactivated accounts cannot replay", async () => {
  const payload = request(28);
  await expect(service.createLeaveBooking(db, actors[1]!, payload, undefined as unknown as string)).rejects.toThrow();
  expect(await db.select().from(leaveBookings).where(eq(leaveBookings.operationId, payload.operationId))).toHaveLength(0);
  const saved = await service.createLeaveBooking(db, actors[1]!, payload, correlation);
  await db.update(userProfiles).set({ active: false }).where(eq(userProfiles.userId, actors[1]!.id));
  await expect(service.createLeaveBooking(db, actors[1]!, payload, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.update(userProfiles).set({ active: true }).where(eq(userProfiles.userId, actors[1]!.id));
  expect(saved.id).toBeTruthy();
});

test("database exclusions and inventory retirement guard preserve booked units", async () => {
  const id = await resource(true, "equipment");
  const payload = { resourceId: id, startDate: day(29), endDate: day(30), purpose: "Constraint fixture", operationId: crypto.randomUUID() };
  await service.createResourceBooking(db, actors[1]!, payload, correlation);
  await expect(db.insert(resourceBookings).values({ ...payload, requesterId: actors[2]!.id, fingerprint: "a".repeat(64), operationId: crypto.randomUUID() }).execute()).rejects.toThrow();
  const [item] = await db.select().from(custodialItems).where(eq(custodialItems.id, itemId));
  await expect(updateCustodialItem(db, actors[0]!, { itemId, expectedVersion: item!.version, code: item!.code, article: item!.article, description: item!.description, unit: item!.unit, reorderPoint: null, defaultSectionId: null, notes: null, active: false, reason: "Retire fixture", operationId: crypto.randomUUID(), correlationId: correlation })).rejects.toThrow("bookable equipment");
  const [lot] = await db.select().from(custodialLots).where(eq(custodialLots.id, lotId));
  await expect(updateCustodialLot(db, actors[0]!, { lotId, expectedVersion: lot!.version, propertyNumber: null, propertyExceptionId: null, unitValue: null, supplier: null, acquiredOn: null, yearLabel: null, fundCluster: lot!.fundCluster, office: lot!.office, accountableOfficer: null, condition: null, remarks: null, active: false, reason: "Retire fixture", operationId: crypto.randomUUID(), correlationId: correlation })).rejects.toThrow("bookable equipment");
  const p = (await service.getSchedulingSetup(db, actors[0]!)).policy;
  await expect(service.saveSchedulingPolicy(db, actors[0]!, { ...p, expectedVersion: p.version - 1 }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await policy({ teacherLimit: 0 });
  await expect(service.createLeaveBooking(db, actors[2]!, request(26), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await policy({ teacherLimit: null });
  await service.createLeaveBooking(db, actors[2]!, request(26), correlation);
  expect((await service.leaveAvailability(db, actors[1]!, { startDate: day(26), endDate: day(26) })).days[0]!.teacher.remaining).toBeNull();
});

test("leave edits revalidate holds, clear approval, retain history and replay without overwriting decisions", async () => {
  await policy({ publicLeave: true });
  const initial = request(40, 41);
  const saved = await service.createLeaveBooking(db, actors[1]!, initial, correlation);
  await service.decideBooking(db, actors[0]!, { kind: "leave", id: saved.id, status: "approved", expectedVersion: 0, note: "Original approval" }, correlation);
  const input = { ...initial, id: saved.id, expectedVersion: 1, operationId: crypto.randomUUID(), reason: "Updated private reason", changeReason: "Correct the reason" };
  const edited = await service.editLeaveBooking(db, actors[1]!, input, correlation);
  expect(edited).toEqual({ id: saved.id, version: 2 }); // own full-capacity dates do not conflict
  let row = (await db.select().from(leaveBookings).where(eq(leaveBookings.id, saved.id)))[0]!;
  expect(row).toMatchObject({ status: "pending", decidedAt: null, decidedBy: null, decisionNote: null, reason: input.reason, fingerprint: expect.any(String), operationId: initial.operationId });
  const projection = await service.leaveAvailability(db, null, { startDate: day(40), endDate: day(41) });
  expect(projection.approved).toHaveLength(0);
  expect(projection.days[0]!.teacher.status).toBe("full");
  expect(JSON.stringify(projection)).not.toContain(input.reason);
  expect(await service.createLeaveBooking(db, actors[1]!, initial, correlation)).toEqual(saved);
  const [event] = await db.select().from(auditLogs).where(eq(auditLogs.action, "scheduling.leave.updated"));
  expect(event?.before).toMatchObject({ status: "approved", detail: initial.reason, version: 1, decisionNote: "Original approval" });
  expect(event?.after).toMatchObject({ status: "pending", detail: input.reason, version: 2, changeReason: input.changeReason });
  await service.decideBooking(db, actors[0]!, { kind: "leave", id: saved.id, status: "approved", expectedVersion: 2, note: "Reviewed update" }, correlation);
  expect(await service.editLeaveBooking(db, actors[1]!, input, correlation)).toEqual(edited);
  row = (await db.select().from(leaveBookings).where(eq(leaveBookings.id, saved.id)))[0]!;
  expect(row).toMatchObject({ status: "approved", version: 3, decisionNote: "Reviewed update" });
  expect((await service.leaveAvailability(db, null, { startDate: day(40), endDate: day(41) })).approved).toHaveLength(1);
  await expect(service.editLeaveBooking(db, actors[1]!, { ...input, reason: "Mismatched retry" }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.editLeaveBooking(db, actors[2]!, { ...input, operationId: crypto.randomUUID() }, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.editLeaveBooking(db, actors[4]!, input, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.editLeaveBooking(db, actors[5]!, input, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(service.editLeaveBooking(db, actors[1]!, { ...input, operationId: crypto.randomUUID(), reason: "Stale" }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.editLeaveBooking(db, actors[1]!, { ...input, expectedVersion: 3, operationId: crypto.randomUUID() }, correlation)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const failed = { ...input, expectedVersion: 3, operationId: crypto.randomUUID(), startDate: day(42), endDate: day(42) };
  await expect(service.editLeaveBooking(db, actors[1]!, failed, undefined as unknown as string)).rejects.toThrow();
  expect(await db.select().from(schedulingEditReplays).where(eq(schedulingEditReplays.operationId, failed.operationId))).toHaveLength(0);
  expect((await db.select().from(leaveBookings).where(eq(leaveBookings.id, saved.id)))[0]).toMatchObject({ startDate: day(40), status: "approved", version: 3 });
  await service.createLeaveBooking(db, actors[2]!, request(43), correlation);
  await expect(service.editLeaveBooking(db, actors[1]!, { ...failed, endDate: day(43) }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.saveLeaveClosure(db, actors[0]!, { day: day(44), label: "Edit closure", closed: true }, correlation);
  await expect(service.editLeaveBooking(db, actors[1]!, { ...failed, startDate: day(44), endDate: day(44) }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  const ownOther = await service.createLeaveBooking(db, actors[1]!, request(45), correlation);
  await expect(service.editLeaveBooking(db, actors[1]!, { ...failed, startDate: day(45), endDate: day(45) }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.saveEmployment(db, actors[0]!, { userId: actors[1]!.id, category: "teacher", active: false }, correlation);
  await expect(service.editLeaveBooking(db, actors[1]!, input, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await service.saveEmployment(db, actors[0]!, { userId: actors[1]!.id, category: "personnel", active: true }, correlation);
  await expect(service.editLeaveBooking(db, actors[1]!, failed, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.saveEmployment(db, actors[0]!, { userId: actors[1]!.id, category: "teacher", active: true }, correlation);
  await db.update(userProfiles).set({ active: false }).where(eq(userProfiles.userId, actors[1]!.id));
  await expect(service.editLeaveBooking(db, actors[1]!, input, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.update(userProfiles).set({ active: true }).where(eq(userProfiles.userId, actors[1]!.id));
  await db.update(leaveBookings).set({ startDate: day(-2), endDate: day(-1) }).where(eq(leaveBookings.id, saved.id));
  await expect(service.editLeaveBooking(db, actors[0]!, failed, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await db.update(leaveBookings).set({ startDate: day(40), endDate: day(41) }).where(eq(leaveBookings.id, saved.id));
  await service.decideBooking(db, actors[1]!, { kind: "leave", id: saved.id, expectedVersion: 3, status: "cancelled", note: "Keep the history" }, correlation);
  await expect(service.editLeaveBooking(db, actors[1]!, { ...failed, expectedVersion: 4 }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await service.editLeaveBooking(db, actors[1]!, input, correlation)).toEqual(edited);
  expect((await db.select().from(leaveBookings).where(eq(leaveBookings.id, saved.id)))[0]!.status).toBe("cancelled");
  expect((await service.editLeaveBooking(db, actors[0]!, { ...request(45), id: ownOther.id, expectedVersion: 0, reason: "Admin correction for teacher", changeReason: "Manager edit" }, correlation)).version).toBe(1);
});

test("reservation edits atomically swap resources and managers cannot replay after losing authority", async () => {
  const a = await resource(), b = await resource(), equipment = await resource(true, "equipment");
  const original = { startDate: day(50), endDate: day(51), resourceId: a, purpose: "Original reservation", operationId: crypto.randomUUID() };
  const saved = await service.createResourceBooking(db, actors[1]!, original, correlation);
  await service.decideBooking(db, actors[4]!, { kind: "resource", id: saved.id, expectedVersion: 0, status: "approved", note: "Original review" }, correlation);
  const edit = { ...original, resourceId: b, id: saved.id, expectedVersion: 1, operationId: crypto.randomUUID(), startDate: day(52), endDate: day(53), purpose: "Changed purpose", changeReason: "Move venue" };
  expect(await service.editResourceBooking(db, actors[1]!, edit, correlation)).toEqual({ id: saved.id, version: 2 });
  expect((await service.resourceAvailability(db, null, { startDate: day(50), endDate: day(53), resourceId: a })).days.every((d) => d.status === "available")).toBe(true);
  expect((await service.resourceAvailability(db, null, { startDate: day(52), endDate: day(53), resourceId: b })).days.every((d) => d.status === "reserved")).toBe(true);
  expect(await service.createResourceBooking(db, actors[1]!, original, correlation)).toEqual(saved);
  await service.decideBooking(db, actors[4]!, { kind: "resource", id: saved.id, expectedVersion: 2, status: "approved", note: "Reviewed move" }, correlation);
  const managerEdit = { ...edit, expectedVersion: 3, operationId: crypto.randomUUID(), purpose: "Manager correction" };
  const receipt = await service.editResourceBooking(db, actors[4]!, managerEdit, correlation);
  expect(receipt.version).toBe(4);
  await expect(service.editResourceBooking(db, actors[2]!, managerEdit, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await db.update(userProfiles).set({ role: "staff" }).where(eq(userProfiles.userId, actors[4]!.id));
  await expect(service.editResourceBooking(db, { ...actors[4]!, role: "staff" }, managerEdit, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await db.update(userProfiles).set({ role: "property_custodian" }).where(eq(userProfiles.userId, actors[4]!.id));
  expect(await service.editResourceBooking(db, actors[4]!, managerEdit, correlation)).toEqual(receipt);
  const retryChangedResource = { ...managerEdit, resourceId: equipment };
  await expect(service.editResourceBooking(db, actors[4]!, retryChangedResource, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.createResourceBooking(db, actors[2]!, { ...original, resourceId: equipment, startDate: day(54), endDate: day(54), operationId: crypto.randomUUID() }, correlation);
  const conflict = { ...managerEdit, operationId: crypto.randomUUID(), expectedVersion: 4, resourceId: equipment, startDate: day(54), endDate: day(54) };
  await expect(service.editResourceBooking(db, actors[1]!, conflict, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  const auditFail = { ...conflict, operationId: crypto.randomUUID(), startDate: day(55), endDate: day(55) };
  await expect(service.editResourceBooking(db, actors[0]!, auditFail, undefined as unknown as string)).rejects.toThrow();
  expect(await db.select().from(schedulingEditReplays).where(eq(schedulingEditReplays.operationId, auditFail.operationId))).toHaveLength(0);
  expect((await db.select().from(resourceBookings).where(eq(resourceBookings.id, saved.id)))[0]).toMatchObject({ resourceId: b, startDate: day(52), version: 4, purpose: "Manager correction" });
  const first = await service.createResourceBooking(db, actors[1]!, { ...original, resourceId: a, startDate: day(56), endDate: day(56), operationId: crypto.randomUUID() }, correlation);
  const second = await service.createResourceBooking(db, actors[2]!, { ...original, resourceId: b, startDate: day(56), endDate: day(56), operationId: crypto.randomUUID() }, correlation);
  const competing = { startDate: day(57), endDate: day(57), resourceId: equipment, purpose: "Competing request", expectedVersion: 0, changeReason: "Same unit" };
  const outcomes = await Promise.allSettled([service.editResourceBooking(db, actors[1]!, { ...competing, id: first.id, operationId: crypto.randomUUID() }, correlation), service.editResourceBooking(db, actors[2]!, { ...competing, id: second.id, operationId: crypto.randomUUID() }, correlation)]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const rows = await db.select().from(resourceBookings).where(inArray(resourceBookings.id, [first.id, second.id]));
  expect(rows.filter((r) => r.resourceId === equipment && r.startDate === day(57))).toHaveLength(1);
  expect(rows.filter((r) => r.startDate === day(56))).toHaveLength(1);
});

test("concurrent leave edits and edit-versus-approval serialize on expected versions", async () => {
  await policy();
  const first = await service.createLeaveBooking(db, actors[1]!, request(70), correlation);
  const second = await service.createLeaveBooking(db, actors[2]!, request(71), correlation);
  const move = { startDate: day(72), endDate: day(72), reason: "Move to one slot", expectedVersion: 0, changeReason: "New date" };
  const outcomes = await Promise.allSettled([service.editLeaveBooking(db, actors[1]!, { ...move, id: first.id, operationId: crypto.randomUUID() }, correlation), service.editLeaveBooking(db, actors[2]!, { ...move, id: second.id, operationId: crypto.randomUUID() }, correlation)]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const rows = await db.select().from(leaveBookings).where(inArray(leaveBookings.id, [first.id, second.id]));
  expect(rows.filter((r) => r.startDate === day(72))).toHaveLength(1);
  expect(rows.filter((r) => r.startDate === day(70) || r.startDate === day(71))).toHaveLength(1);
  const raced = await service.createLeaveBooking(db, actors[1]!, request(74), correlation);
  const result = await Promise.allSettled([service.editLeaveBooking(db, actors[1]!, { ...move, id: raced.id, startDate: day(75), endDate: day(75), operationId: crypto.randomUUID() }, correlation), service.decideBooking(db, actors[0]!, { kind: "leave", id: raced.id, expectedVersion: 0, status: "approved", note: "Concurrent decision" }, correlation)]);
  expect(result.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const [row] = await db.select().from(leaveBookings).where(eq(leaveBookings.id, raced.id));
  expect(row!.version).toBe(1);
  expect(row!.status === "approved" ? row!.startDate === day(74) : row!.startDate === day(75)).toBe(true);
});
