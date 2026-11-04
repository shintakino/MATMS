import { afterAll, beforeAll, expect, test } from "bun:test";
import { count, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "@matms/db";
import { provisionAccount } from "@matms/auth/provisioning";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { auditLogs } from "@matms/db/schema/audit";
import { custodialItems, custodialLots, custodialTransactions } from "@matms/db/schema/custodial-inventory";
import { bookableResources, leaveBookings, leaveClosures, resourceBookings, schedulingEditReplays, schedulingInvitations, schedulingPeople, schedulingPolicy } from "@matms/db/schema/scheduling";
import { availabilityInput, dateDays, leaveInput, manilaToday, personInput, publicSubmissionInput, scheduleDate } from "./scheduling-contract";
import type { Actor } from "./scheduling-core";
import * as service from "./scheduling-service";
import * as people from "./scheduling-people-service";
import * as invite from "./scheduling-invitation-service";
import { updateCustodialItem, updateCustodialLot } from "./custodial-service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Scheduling tests require an isolated _test database.");
const db = createDb({ DATABASE_URL: url }), correlation = crypto.randomUUID(), suffix = correlation.slice(0, 8);
const actors: Actor[] = [], personIds: string[] = [], resources: string[] = [], closedDates: string[] = [];
let shs = "", shs2 = "", jhs = "", personnel2 = "", itemId = "", lotId = "";
let original: typeof schedulingPolicy.$inferSelect | undefined;
const admin = () => actors[0]!, staff = () => actors[1]!, other = () => actors[2]!;
function day(offset: number) { return new Date(Date.parse(`${manilaToday()}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
function request(personId: string | undefined, offset: number, end = offset) { return { personId, startDate: day(offset), endDate: day(end), reason: "Private fictional leave reason", operationId: crypto.randomUUID() }; }
function reservation(resourceId: string, offset: number, end = offset) { return { resourceId, startDate: day(offset), endDate: day(end), purpose: "Private fictional event purpose", operationId: crypto.randomUUID() }; }
async function config(values: Partial<{ leaveEnabled: boolean; publicLeave: boolean; teacherLimit: number | null; shsLimit: number | null; jhsLimit: number | null; personnelLimit: number | null }> = {}) {
  const current = (await service.getSchedulingSetup(db, admin())).policy;
  await service.saveSchedulingPolicy(db, admin(), { leaveEnabled: true, publicLeave: false, teacherLimit: null, shsLimit: 1, jhsLimit: 1, personnelLimit: 1, ...values, expectedVersion: current.version }, correlation);
}
async function person(category: "shs" | "jhs" | "personnel", userId: string | null = null) {
  const code = `FIX-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
  const saved = await people.saveSchedulingPerson(db, admin(), { code, name: `Fictional ${category} ${code}`, category, userId, active: true }, correlation);
  personIds.push(saved.id); return saved.id;
}
async function resource(published = true, kind: "facility" | "equipment" = "facility") {
  const saved = await service.saveBookableResource(db, admin(), { name: `Fictional ${kind} ${crypto.randomUUID()}`, kind, lotId: kind === "equipment" ? lotId : null, publicDescription: "Public fixture description", active: true, published }, correlation);
  resources.push(saved.id); return saved.id;
}
async function link(kind: "leave" | "resource", personId?: string, issuer = admin()) { return invite.createSchedulingInvitation(db, issuer, { kind, personId, expiresInHours: 24 }, correlation); }
function publicRequest(token: string, offset: number) { return { token, startDate: day(offset), endDate: day(offset), detail: "Private public-link fixture reason", operationId: crypto.randomUUID() }; }
beforeAll(async () => {
  original = (await db.select().from(schedulingPolicy))[0];
  for (const [index, role] of (["admin", "staff", "staff", "property_custodian", "viewer", "staff", "admin"] as const).entries()) {
    const saved = await provisionAccount(db, { name: `Fictional scheduling account ${index} ${suffix}`, email: `delegation-${index}-${correlation}@example.test`, password: "fictional scheduling password", role, actorId: null, correlationId: correlation, mustChangePassword: false });
    actors.push({ id: saved.id, role });
  }
  shs = await person("shs"); shs2 = await person("shs"); jhs = await person("jhs");
  await person("personnel", staff().id); personnel2 = await person("personnel", other().id);
  const [item] = await db.insert(custodialItems).values({ code: `DELEGATE-${suffix}`, normalizedCode: `DELEGATE-${suffix}`.toUpperCase(), article: "Fictional projector", description: "Fixture", unit: "unit" }).returning(); itemId = item!.id;
  const [lot] = await db.insert(custodialLots).values({ itemId, reportingClass: "ppe", fundCluster: "Fixture fund", office: "Fixture office" }).returning(); lotId = lot!.id;
  await config();
});
afterAll(async () => {
  const ids = actors.map(actor => actor.id);
  const linked = await db.select({ id: schedulingPeople.id }).from(schedulingPeople).where(inArray(schedulingPeople.userId, ids));
  const allPeople = [...new Set([...personIds, ...linked.map(row => row.id)])];
  await db.delete(schedulingEditReplays).where(inArray(schedulingEditReplays.actorId, ids));
  if (resources.length) await db.delete(resourceBookings).where(inArray(resourceBookings.resourceId, resources));
  if (allPeople.length) await db.delete(leaveBookings).where(inArray(leaveBookings.personId, allPeople));
  await db.delete(schedulingInvitations).where(inArray(schedulingInvitations.createdBy, ids));
  if (allPeople.length) await db.delete(schedulingPeople).where(inArray(schedulingPeople.id, allPeople));
  if (resources.length) await db.delete(bookableResources).where(inArray(bookableResources.id, resources));
  if (closedDates.length) await db.delete(leaveClosures).where(inArray(leaveClosures.day, closedDates));
  await db.delete(schedulingPolicy); if (original) await db.insert(schedulingPolicy).values(original);
  if (lotId) await db.delete(custodialLots).where(eq(custodialLots.id, lotId));
  if (itemId) await db.delete(custodialItems).where(eq(custodialItems.id, itemId));
  await db.delete(auditLogs).where(eq(auditLogs.correlationId, correlation));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, ids));
  await db.delete(user).where(inArray(user.id, ids)); await db.$client.end();
});

test("real inclusive dates, teacher identities and public payloads are validated", () => {
  expect(scheduleDate.safeParse("2028-02-29").success).toBe(true);
  for (const date of ["2027-02-29", "2026-04-31", "2026-13-01", "2026-1-1"]) expect(scheduleDate.safeParse(date).success).toBe(false);
  expect(dateDays("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  expect(leaveInput.safeParse({ ...request(shs, 12), endDate: day(11) }).success).toBe(false);
  expect(availabilityInput.safeParse({ startDate: day(0), endDate: day(31) }).success).toBe(false);
  expect(personInput.safeParse({ code: "SHS-1", name: "Fictional teacher", category: "shs", userId: staff().id, active: true }).success).toBe(false);
  expect(publicSubmissionInput.safeParse({ ...publicRequest("x".repeat(43), 12), personId: shs }).success).toBe(false);
});
test("directory CRUD, delegated filing and self filing enforce account/category boundaries", async () => {
  expect((await service.getSchedulingSetup(db, staff())).canFileLeave).toBe(true);
  for (const actor of [actors[3]!, actors[4]!, actors[5]!]) {
    expect((await service.getSchedulingSetup(db, actor)).canFileLeave).toBe(false);
    await expect(service.createLeaveBooking(db, actor, request(shs, 5), correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  const choices = await people.schedulingPeople(db, staff(), { page: 1, search: "" });
  expect(choices.items.some(row => row.id === shs)).toBe(true);
  expect(choices.items.every(row => row.userId === null)).toBe(true);
  await expect(people.saveSchedulingPerson(db, staff(), { code: "DENIED", name: "Denied", category: "shs", userId: null, active: true }, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const own = await service.createLeaveBooking(db, admin(), request(undefined, 5), correlation);
  const [created] = await db.select().from(leaveBookings).where(eq(leaveBookings.id, own.id));
  expect(created).toMatchObject({ requesterId: admin().id, category: "personnel" });
  expect((await service.getSchedulingSetup(db, admin())).assignment?.userId).toBe(admin().id);
  const entry = (await db.select().from(schedulingPeople).where(eq(schedulingPeople.id, shs)))[0]!;
  await expect(people.saveSchedulingPerson(db, admin(), { ...entry, expectedVersion: 9, category: "shs" }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(people.saveSchedulingPerson(db, admin(), { code: entry.code, name: "Duplicate", category: "shs", userId: null, active: true }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
});
test("directory retirement preserves history, excludes inactive choices and guards future holds", async () => {
  const id = await person("shs");
  const [entry] = await db.select().from(schedulingPeople).where(eq(schedulingPeople.id, id));
  const input = { id, code: entry!.code, name: entry!.name, category: "shs" as const, userId: null, active: false };
  await people.saveSchedulingPerson(db, admin(), { ...input, expectedVersion: 0 }, correlation);
  expect((await people.schedulingPeople(db, staff(), { search: input.code })).items).toHaveLength(0);
  expect((await people.schedulingPeople(db, admin(), { search: input.code, includeInactive: true })).items[0]).toMatchObject({ id, active: false, version: 1 });
  await expect(service.createLeaveBooking(db, staff(), request(id, 6), correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await people.saveSchedulingPerson(db, admin(), { ...input, active: true, expectedVersion: 1 }, correlation);
  const leave = await service.createLeaveBooking(db, staff(), request(id, 6), correlation);
  await expect(people.saveSchedulingPerson(db, admin(), { ...input, expectedVersion: 2 }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.decideBooking(db, admin(), { kind: "leave", id: leave.id, expectedVersion: 0, status: "cancelled", note: "Directory lifecycle fixture" }, correlation);
  const facility = await resource();
  const booking = await service.createResourceBooking(db, admin(), { ...reservation(facility, 6), personId: id }, correlation);
  await expect(people.saveSchedulingPerson(db, admin(), { ...input, expectedVersion: 2 }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.decideBooking(db, admin(), { kind: "resource", id: booking.id, expectedVersion: 0, status: "cancelled", note: "Directory lifecycle fixture" }, correlation);
  await people.saveSchedulingPerson(db, admin(), { ...input, expectedVersion: 2 }, correlation);
  expect((await db.select().from(schedulingPeople).where(eq(schedulingPeople.id, id)))[0]).toMatchObject({ active: false, version: 3 });
  expect((await db.select().from(leaveBookings).where(eq(leaveBookings.id, leave.id)))[0]).toMatchObject({ personId: id, personName: input.name, status: "cancelled" });
  expect((await db.select().from(resourceBookings).where(eq(resourceBookings.id, booking.id)))[0]).toMatchObject({ personId: id, personName: input.name, status: "cancelled" });
});
test("SHS/JHS/personnel limits, beneficiary holds, privacy and authorization remain separate", async () => {
  await config(); const payload = request(shs, 10, 11);
  const first = await service.createLeaveBooking(db, staff(), payload, correlation);
  expect(await service.createLeaveBooking(db, staff(), payload, correlation)).toEqual(first);
  await expect(service.createLeaveBooking(db, staff(), { ...payload, personId: shs2 }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.createLeaveBooking(db, other(), request(shs, 9, 10), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.createLeaveBooking(db, other(), request(shs2, 10), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await service.createLeaveBooking(db, other(), request(jhs, 10), correlation);
  await service.createLeaveBooking(db, staff(), request(personnel2, 10), correlation);
  expect((await service.listScheduleRequests(db, other(), { kind: "leave", scope: "mine", page: 1 })).items.some(row => row.personId === personnel2)).toBe(true);
  await expect(service.listScheduleRequests(db, staff(), { kind: "leave", scope: "all", page: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(service.decideBooking(db, other(), { kind: "leave", id: first.id, status: "cancelled", note: "Not mine", expectedVersion: 0 }, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.decideBooking(db, staff(), { kind: "leave", id: first.id, status: "approved", note: "Not approver", expectedVersion: 0 }, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const range = { startDate: day(10), endDate: day(11) };
  expect((await service.leaveAvailability(db, null, range)).days).toEqual([]);
  await service.decideBooking(db, admin(), { kind: "leave", id: first.id, status: "approved", note: "Private approval", expectedVersion: 0 }, correlation);
  await config({ publicLeave: true });
  const calendar = await service.leaveAvailability(db, null, range);
  expect(calendar.days[0]!.shs.status).toBe("full"); expect(calendar.days[0]!.jhs.status).toBe("full");
  expect(calendar.approved).toHaveLength(1); expect(calendar.approved[0]!.category).toBe("shs");
  for (const secret of [payload.reason, "Private approval", first.id, staff().id, "@example.test"]) expect(JSON.stringify(calendar)).not.toContain(secret);
  expect(Object.keys(calendar.approved[0]!).sort()).toEqual(["category", "endDate", "name", "startDate"]);
  const entry = (await db.select().from(schedulingPeople).where(eq(schedulingPeople.id, shs)))[0]!;
  await expect(people.saveSchedulingPerson(db, admin(), { ...entry, category: "jhs", expectedVersion: entry.version }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
});
test("concurrent last-slot requests, partial ranges, closures and combined teacher limits never overbook", async () => {
  await config();
  const results = await Promise.allSettled([service.createLeaveBooking(db, staff(), request(shs, 20), correlation), service.createLeaveBooking(db, other(), request(shs2, 20), correlation)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  await expect(service.createLeaveBooking(db, admin(), request(jhs, 19, 20), correlation)).resolves.toHaveProperty("id");
  await service.createLeaveBooking(db, staff(), request(shs, 21), correlation);
  await config({ teacherLimit: 1 });
  await expect(service.createLeaveBooking(db, admin(), request(jhs, 21), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  closedDates.push(day(25)); await service.saveLeaveClosure(db, admin(), { day: day(25), label: "Private school event", closed: true }, correlation);
  await expect(service.createLeaveBooking(db, staff(), request(shs, 24, 26), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await db.select().from(leaveBookings).where(eq(leaveBookings.startDate, day(24))))).toHaveLength(0);
  await config({ publicLeave: true });
  expect(JSON.stringify(await service.leaveAvailability(db, null, { startDate: day(25), endDate: day(25) }))).not.toContain("Private school event");
});
test("only Admin manages internal resources; reservations retain beneficiaries and never post stock", async () => {
  const [before] = await db.select({ value: count() }).from(custodialTransactions);
  const facility = await resource(), equipment = await resource(true, "equipment"), hidden = await resource(false);
  for (const actor of actors.slice(1, 6)) {
    await expect(service.createResourceBooking(db, actor, reservation(facility, 30), correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.listScheduleRequests(db, actor, { kind: "resource", scope: "mine", page: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.saveBookableResource(db, actor, { name: "Denied", kind: "facility", lotId: null, publicDescription: "", active: true, published: false }, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  await expect(service.resourceAvailability(db, staff(), { resourceId: hidden, startDate: day(30), endDate: day(30) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const payload = { ...reservation(equipment, 30, 31), personId: shs };
  const saved = await service.createResourceBooking(db, admin(), payload, correlation);
  expect(await service.createResourceBooking(db, admin(), payload, correlation)).toEqual(saved);
  const [row] = await db.select().from(resourceBookings).where(eq(resourceBookings.id, saved.id));
  expect(row).toMatchObject({ requesterId: admin().id, personId: shs, beneficiaryCategory: "shs" });
  const publicCalendar = await service.resourceAvailability(db, null, { resourceId: equipment, startDate: day(30), endDate: day(31) });
  expect(publicCalendar.days.every(day => day.status === "reserved")).toBe(true);
  for (const secret of [payload.purpose, admin().id, row!.personName, lotId]) expect(JSON.stringify(publicCalendar)).not.toContain(secret);
  const race = await Promise.allSettled([service.createResourceBooking(db, admin(), reservation(facility, 32), correlation), service.createResourceBooking(db, actors[6]!, reservation(facility, 32), correlation)]);
  expect(race.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const [lot] = await db.select().from(custodialLots).where(eq(custodialLots.id, lotId));
  const [item] = await db.select().from(custodialItems).where(eq(custodialItems.id, itemId));
  await expect(updateCustodialLot(db, { id: admin().id }, { lotId, expectedVersion: lot!.version, propertyNumber: lot!.propertyNumber, propertyExceptionId: lot!.propertyExceptionId, unitValue: lot!.unitValue, supplier: lot!.supplier, acquiredOn: lot!.acquiredOn, yearLabel: lot!.yearLabel, fundCluster: lot!.fundCluster, office: lot!.office, accountableOfficer: lot!.accountableOfficer, condition: lot!.condition, remarks: lot!.remarks, active: false, reason: "Retirement guard fixture", operationId: crypto.randomUUID(), correlationId: correlation })).rejects.toThrow("bookable");
  await expect(updateCustodialItem(db, { id: admin().id }, { itemId, expectedVersion: item!.version, code: item!.code, article: item!.article, description: item!.description, unit: item!.unit, reorderPoint: item!.reorderPoint, defaultSectionId: item!.defaultSectionId, notes: item!.notes, active: false, reason: "Retirement guard fixture", operationId: crypto.randomUUID(), correlationId: correlation })).rejects.toThrow("bookable");
  expect((await db.select({ value: count() }).from(custodialTransactions))[0]!.value).toBe(before!.value);
});
test("teacher-specific links disclose limited availability and atomically file one pending request", async () => {
  await config(); const issued = await link("leave", shs2);
  expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const [stored] = await db.select().from(schedulingInvitations).where(eq(schedulingInvitations.id, issued.id));
  expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/); expect(stored!.tokenHash).not.toBe(issued.token);
  const preview = await invite.previewSchedulingInvitation(db, issued.token);
  expect(preview).toMatchObject({ kind: "leave", state: "ready", person: { category: "shs" } });
  expect(Object.keys(preview.person!).sort()).toEqual(["category", "name"]);
  expect(Object.keys(preview).sort()).toEqual(["expiresAt", "kind", "person", "receiptCode", "serverNow", "state"]);
  expect(Date.parse(preview.expiresAt) - Date.parse(preview.serverNow)).toBeGreaterThan(0);
  const dates = await invite.schedulingInvitationAvailability(db, { token: issued.token, startDate: day(10), endDate: day(11) });
  expect(dates.days[0]!.status).toBe("full");
  await expect(invite.submitSchedulingInvitation(db, publicRequest(issued.token, 10), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await db.select().from(schedulingInvitations).where(eq(schedulingInvitations.id, issued.id)))[0]!.usedAt).toBeNull();
  const payload = publicRequest(issued.token, 35), receipt = await invite.submitSchedulingInvitation(db, payload, correlation);
  expect(receipt.status).toBe("submitted"); expect(Object.keys(receipt).sort()).toEqual(["receiptCode", "status"]);
  expect(await invite.submitSchedulingInvitation(db, payload, correlation)).toEqual(receipt);
  await expect(invite.submitSchedulingInvitation(db, { ...payload, operationId: crypto.randomUUID() }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  const [booking] = await db.select().from(leaveBookings).where(eq(leaveBookings.invitationId, issued.id));
  expect(booking).toMatchObject({ requesterId: null, personId: shs2, status: "pending" });
  await service.decideBooking(db, admin(), { kind: "leave", id: booking!.id, expectedVersion: 0, status: "approved", note: "Verified teacher claim", }, correlation);
  expect(await invite.submitSchedulingInvitation(db, payload, correlation)).toEqual(receipt);
  const audit = await db.select().from(auditLogs).where(eq(auditLogs.targetId, booking!.id));
  expect(audit.find(row => row.action === "scheduling.leave.public_requested")?.actorId).toBeNull();
  expect(JSON.stringify(audit)).toContain(issued.id); expect(JSON.stringify(audit)).not.toContain(issued.token);
  const listed = await invite.listSchedulingInvitations(db, admin(), { page: 1, search: "" });
  expect(JSON.stringify(listed)).not.toContain(stored!.tokenHash); expect(JSON.stringify(listed)).not.toContain(issued.token);
  expect((await invite.previewSchedulingInvitation(db, issued.token)).state).toBe("used");
});
test("public resource links accept students without accounts, reject hidden choices and serialize single use", async () => {
  const facility = await resource(), hidden = await resource(false), issued = await link("resource");
  const [before] = await db.select({ value: count() }).from(user);
  const payload = { ...publicRequest(issued.token, 40), resourceId: hidden, beneficiaryName: "Fictional student", beneficiaryCategory: "student" as const };
  await expect(invite.submitSchedulingInvitation(db, payload, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const receipt = await invite.submitSchedulingInvitation(db, { ...payload, resourceId: facility }, correlation);
  expect(receipt.status).toBe("submitted");
  expect((await db.select().from(resourceBookings).where(eq(resourceBookings.invitationId, issued.id)))[0]).toMatchObject({ personName: payload.beneficiaryName, beneficiaryCategory: "student", requesterId: null, status: "pending" });
  expect((await db.select({ value: count() }).from(user))[0]!.value).toBe(before!.value);
  await expect(service.createResourceBooking(db, admin(), reservation(facility, 40), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(JSON.stringify(await service.resourceAvailability(db, null, { resourceId: facility, startDate: day(40), endDate: day(40) }))).not.toContain(payload.beneficiaryName);
  const another = await link("resource");
  const results = await Promise.allSettled([41, 42].map(offset => invite.submitSchedulingInvitation(db, { ...payload, resourceId: facility, token: another.token, startDate: day(offset), endDate: day(offset), operationId: crypto.randomUUID() }, correlation)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(resourceBookings).where(eq(resourceBookings.invitationId, another.id))).toHaveLength(1);
  await expect(invite.createSchedulingInvitation(db, staff(), { kind: "resource", expiresInHours: 1 }, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("expiry, revocation, issuer permission and person changes invalidate links and replays", async () => {
  const expired = await link("leave", jhs);
  await db.update(schedulingInvitations).set({ createdAt: new Date(Date.now() - 7200000), expiresAt: new Date(Date.now() - 3600000) }).where(eq(schedulingInvitations.id, expired.id));
  await expect(invite.previewSchedulingInvitation(db, expired.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(invite.submitSchedulingInvitation(db, publicRequest(expired.token, 50), correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const revoked = await link("leave", jhs);
  await invite.revokeSchedulingInvitation(db, admin(), { id: revoked.id, expectedVersion: 0 }, correlation);
  await expect(invite.previewSchedulingInvitation(db, revoked.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const bound = await person("jhs"), changed = await link("leave", bound);
  const entry = (await db.select().from(schedulingPeople).where(eq(schedulingPeople.id, bound)))[0]!;
  await people.saveSchedulingPerson(db, admin(), { ...entry, name: "Fictional corrected teacher", category: "jhs", expectedVersion: 0 }, correlation);
  await expect(invite.previewSchedulingInvitation(db, changed.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const issuer = actors[6]!, issued = await link("leave", jhs, issuer);
  await db.update(userProfiles).set({ active: false }).where(eq(userProfiles.userId, issuer.id));
  await expect(invite.submitSchedulingInvitation(db, publicRequest(issued.token, 50), correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await db.update(userProfiles).set({ active: true, role: "staff" }).where(eq(userProfiles.userId, issuer.id));
  await expect(invite.previewSchedulingInvitation(db, issued.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await db.update(userProfiles).set({ role: "admin" }).where(eq(userProfiles.userId, issuer.id));
  const payload = publicRequest(issued.token, 50); await invite.submitSchedulingInvitation(db, payload, correlation);
  await invite.revokeSchedulingInvitation(db, admin(), { id: issued.id, expectedVersion: 1 }, correlation);
  await expect(invite.submitSchedulingInvitation(db, payload, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await db.select().from(leaveBookings).where(eq(leaveBookings.invitationId, issued.id)))[0]!.status).toBe("pending");
});
test("audit failure rolls back public link consumption, capacity and booking writes", async () => {
  const issued = await link("leave", shs), payload = publicRequest(issued.token, 55);
  const name = `delegation_audit_${suffix}`;
  await db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = '${correlation}' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`));
  await db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`));
  try {
    await expect(invite.submitSchedulingInvitation(db, payload, correlation)).rejects.toThrow();
    expect(await db.select().from(leaveBookings).where(eq(leaveBookings.invitationId, issued.id))).toHaveLength(0);
    expect((await db.select().from(schedulingInvitations).where(eq(schedulingInvitations.id, issued.id)))[0]!.usedAt).toBeNull();
    await expect(service.createLeaveBooking(db, staff(), request(jhs, 56), correlation)).rejects.toThrow();
    expect(await db.select().from(leaveBookings).where(eq(leaveBookings.startDate, day(56)))).toHaveLength(0);
  } finally { await db.execute(sql.raw(`DROP TRIGGER ${name} ON audit_logs`)); await db.execute(sql.raw(`DROP FUNCTION ${name}()`)); }
  expect((await invite.submitSchedulingInvitation(db, payload, correlation)).status).toBe("submitted");
});
test("edits revalidate ranges, reset approval and retain original creation and durable edit replays", async () => {
  await config({ publicLeave: true });
  const payload = request(jhs, 60), saved = await service.createLeaveBooking(db, staff(), payload, correlation);
  await service.decideBooking(db, admin(), { kind: "leave", id: saved.id, expectedVersion: 0, status: "approved", note: "Original approval" }, correlation);
  const edit = { id: saved.id, expectedVersion: 1, startDate: day(61), endDate: day(62), reason: "Changed private reason", changeReason: "Update teacher dates", operationId: crypto.randomUUID() };
  const updated = await service.editLeaveBooking(db, staff(), edit, correlation);
  expect(updated.version).toBe(2);
  const [row] = await db.select().from(leaveBookings).where(eq(leaveBookings.id, saved.id));
  expect(row).toMatchObject({ status: "pending", decidedBy: null, decisionNote: null });
  expect((await service.leaveAvailability(db, null, { startDate: day(60), endDate: day(62) })).approved).toHaveLength(0);
  expect(await service.createLeaveBooking(db, staff(), payload, correlation)).toEqual(saved);
  await service.decideBooking(db, admin(), { kind: "leave", id: saved.id, expectedVersion: 2, status: "approved", note: "Reapproved" }, correlation);
  expect(await service.editLeaveBooking(db, staff(), edit, correlation)).toEqual(updated);
  await expect(service.editLeaveBooking(db, other(), { ...edit, expectedVersion: 3, operationId: crypto.randomUUID(), reason: "Another person's edit" }, correlation)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.editLeaveBooking(db, staff(), { ...edit, operationId: crypto.randomUUID() }, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  const first = await resource(), second = await resource();
  const booking = await service.createResourceBooking(db, admin(), reservation(first, 65), correlation);
  await service.createResourceBooking(db, admin(), reservation(second, 66), correlation);
  const move = { ...reservation(second, 66), id: booking.id, expectedVersion: 0, changeReason: "Try occupied resource" };
  await expect(service.editResourceBooking(db, admin(), move, correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await db.select().from(resourceBookings).where(eq(resourceBookings.id, booking.id)))[0]!.resourceId).toBe(first);
  const changed = await service.editResourceBooking(db, admin(), { ...move, startDate: day(67), endDate: day(67) }, correlation);
  expect(changed.version).toBe(1);
  await expect(service.editResourceBooking(db, actors[3]!, { ...move, startDate: day(68), endDate: day(68) }, correlation)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("concurrent edits/decisions and link revocation have one consistent outcome", async () => {
  await config();
  const saved = await service.createLeaveBooking(db, staff(), request(shs, 70), correlation);
  const outcomes = await Promise.allSettled([
    service.editLeaveBooking(db, staff(), { id: saved.id, expectedVersion: 0, ...request(undefined, 71), changeReason: "Move date" }, correlation),
    service.decideBooking(db, admin(), { kind: "leave", id: saved.id, expectedVersion: 0, status: "approved", note: "Concurrent approval" }, correlation),
  ]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await db.select().from(leaveBookings).where(eq(leaveBookings.id, saved.id)))[0]!.version).toBe(1);
  const issued = await link("leave", jhs);
  await Promise.allSettled([invite.submitSchedulingInvitation(db, publicRequest(issued.token, 73), correlation), invite.revokeSchedulingInvitation(db, admin(), { id: issued.id, expectedVersion: 0 }, correlation)]);
  const [state] = await db.select().from(schedulingInvitations).where(eq(schedulingInvitations.id, issued.id));
  const bookings = await db.select().from(leaveBookings).where(eq(leaveBookings.invitationId, issued.id));
  expect(bookings.length).toBe(state!.usedAt ? 1 : 0);
  expect(!!state!.revokedAt || !!state!.usedAt).toBe(true);
});
test("database guards and conservative unclassified teacher capacity survive bypass attempts", async () => {
  await config();
  const [legacy] = await db.insert(schedulingPeople).values({ code: `LEGACY-${suffix}`.toUpperCase(), name: "Fictional unclassified teacher", category: "teacher" }).returning(); personIds.push(legacy!.id);
  await db.insert(leaveBookings).values({ requesterId: admin().id, personId: legacy!.id, personName: legacy!.name, category: "teacher", startDate: day(80), endDate: day(80), reason: "Legacy hold", operationId: crypto.randomUUID(), fingerprint: "a".repeat(64) });
  await expect(service.createLeaveBooking(db, staff(), request(shs, 80), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.createLeaveBooking(db, staff(), request(jhs, 80), correlation)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(db.insert(leaveBookings).values({ requesterId: other().id, personId: legacy!.id, personName: legacy!.name, category: "teacher", startDate: day(80), endDate: day(80), reason: "Duplicate person with different filer", operationId: crypto.randomUUID(), fingerprint: "b".repeat(64) }).execute()).rejects.toMatchObject({ cause: { code: "23P01", constraint: "leave_booking_person_no_overlap" } });
  await expect(db.delete(schedulingPeople).where(eq(schedulingPeople.id, legacy!.id)).execute()).rejects.toMatchObject({ cause: { constraint: "leave_bookings_person_id_scheduling_people_id_fkey" } });
  await expect(db.insert(schedulingPeople).values({ code: "BAD-LINK", name: "Fictional teacher", category: "shs", userId: actors[5]!.id }).execute()).rejects.toMatchObject({ cause: { constraint: "scheduling_teacher_no_account" } });
  await expect(db.insert(leaveBookings).values({ personId: shs, personName: "No origin", category: "shs", startDate: day(81), endDate: day(81), reason: "Invalid origin", operationId: crypto.randomUUID(), fingerprint: "c".repeat(64) }).execute()).rejects.toMatchObject({ cause: { constraint: "leave_booking_origin" } });
});
