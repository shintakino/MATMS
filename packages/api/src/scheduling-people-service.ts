import { and, asc, eq, gte, ilike, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { AuditTransaction, Database } from "@matms/db";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { leaveBookings, resourceBookings, schedulingPeople as people } from "@matms/db/schema/scheduling";
import { manilaToday, pageInput, peopleInput, personInput } from "./scheduling-contract";
import { admin, audit, authorize, fail, hash, leaveOperator, live, write, type Actor } from "./scheduling-core";

export async function schedulingPeople(db: Database, actor: Actor, raw: z.input<typeof peopleInput>) {
  await authorize(db, actor); await leaveOperator(db, actor);
  const input = peopleInput.parse(raw), managing = actor.role === "admin";
  const query = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db.select({ id: people.id, code: people.code, name: people.name, category: people.category, active: people.active, version: people.version, userId: people.userId, accountActive: userProfiles.active, role: userProfiles.role })
    .from(people).leftJoin(userProfiles, eq(userProfiles.userId, people.userId))
    .where(and(or(ilike(people.name, query), ilike(people.code, query)), managing && input.includeInactive ? undefined : eq(people.active, true), input.teachersOnly ? inArray(people.category, ["shs", "jhs"]) : undefined))
    .orderBy(asc(people.name), asc(people.code), asc(people.id)).limit(26).offset((input.page - 1) * 25);
  return { items: rows.slice(0, 25).map(row => managing ? row : { ...row, userId: null, accountActive: null, role: null }), hasMore: rows.length > 25 };
}
export async function schedulingAccountChoices(db: Database, actor: Actor, raw: z.input<typeof pageInput>) {
  await authorize(db, actor); admin(actor);
  const input = pageInput.parse(raw);
  const rows = await db.select({ id: user.id, name: user.name, role: userProfiles.role }).from(user).innerJoin(userProfiles, eq(userProfiles.userId, user.id))
    .where(and(eq(userProfiles.active, true), ne(userProfiles.role, "viewer"), ilike(user.name, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`)))
    .orderBy(asc(user.name), asc(user.id)).limit(26).offset((input.page - 1) * 25);
  return { items: rows.slice(0, 25), hasMore: rows.length > 25 };
}
export async function saveSchedulingPerson(db: Database, actor: Actor, raw: z.input<typeof personInput>, correlationId: string) {
  const input = personInput.parse(raw);
  return write(db, actor, async tx => {
    admin(actor);
    const current = input.id ? (await tx.select().from(people).where(eq(people.id, input.id)))[0] : null;
    if (input.id && !current) fail("NOT_FOUND", "This directory person is unavailable.");
    if (current && current.version !== input.expectedVersion) fail("CONFLICT", "This person changed. Refresh and review the directory before saving.");
    if (current?.userId && current.userId !== input.userId) fail("CONFLICT", "An existing account link cannot be reassigned. Retire this directory entry and create the correct identity.");
    if (input.userId) {
      const [account] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, input.userId)).for("share");
      if (!account?.active || account.role === "viewer") fail("VALIDATION_ERROR", "Choose an active non-Viewer personnel or Administrator account.");
    }
    const duplicates = await tx.select({ id: people.id }).from(people).where(or(eq(people.code, input.code), input.userId ? eq(people.userId, input.userId) : undefined));
    if (duplicates.some(row => row.id !== input.id)) fail("CONFLICT", "That directory code or login account is already assigned to another person.");
    if (current && (!input.active || current.category !== input.category)) {
      const [leave] = await tx.select({ id: leaveBookings.id }).from(leaveBookings).where(and(eq(leaveBookings.personId, current.id), inArray(leaveBookings.status, [...live]), gte(leaveBookings.endDate, manilaToday()))).limit(1);
      if (leave) fail("CONFLICT", "Resolve this person's active future leave before changing category or retiring them.");
      if (!input.active) {
        const [reservation] = await tx.select({ id: resourceBookings.id }).from(resourceBookings).where(and(eq(resourceBookings.personId, current.id), inArray(resourceBookings.status, [...live]), gte(resourceBookings.endDate, manilaToday()))).limit(1);
        if (reservation) fail("CONFLICT", "Resolve this person's active future reservations before retiring them.");
      }
    }
    const values = { code: input.code, name: input.name, category: input.category, userId: input.userId, active: input.active, version: current ? current.version + 1 : 0 };
    const [saved] = current ? await tx.update(people).set(values).where(eq(people.id, current.id)).returning({ id: people.id }) : await tx.insert(people).values(values).returning({ id: people.id });
    if (!saved) fail("CONFLICT", "The directory person could not be saved.");
    await audit(tx, actor, "person.saved", saved.id, correlationId, values);
    return saved;
  });
}
export async function directoryPerson(tx: AuditTransaction, id: string) {
  const [person] = await tx.select().from(people).where(eq(people.id, id));
  if (!person?.active) fail("NOT_FOUND", "This directory person is unavailable.");
  return person;
}
/** Explicitly filing for oneself authorizes an Admin's audited personnel identity. */
export async function personForLeave(tx: AuditTransaction, actor: Actor, personId: string | undefined, correlationId: string) {
  await leaveOperator(tx, actor);
  let person;
  if (personId) person = await directoryPerson(tx, personId);
  else {
    const [existing] = await tx.select().from(people).where(eq(people.userId, actor.id));
    if (existing) {
      if (!existing.active) fail("CONFLICT", "Reactivate your directory entry before filing your own leave.");
      person = existing;
    } else {
      admin(actor);
      const [account] = await tx.select({ name: user.name }).from(user).where(eq(user.id, actor.id));
      if (!account) fail("NOT_FOUND", "This account is unavailable.");
      const [created] = await tx.insert(people).values({ code: `USER-${hash(actor.id).slice(0, 16).toUpperCase()}`, name: account.name, category: "personnel", userId: actor.id }).returning();
      if (!created) fail("CONFLICT", "Your directory entry could not be created.");
      await audit(tx, actor, "person.created_for_self", created.id, correlationId, { category: "personnel", userId: actor.id });
      person = created;
    }
  }
  if (person.category === "teacher") fail("CONFLICT", "An Administrator must classify this teacher as SHS or JHS before new leave can be filed.");
  return person;
}
export async function personForResource(tx: AuditTransaction, actor: Actor, input: { personId?: string; beneficiaryName?: string; beneficiaryCategory?: "teacher" | "personnel" | "student" | "other" }) {
  admin(actor);
  if (input.personId) {
    if (input.beneficiaryName || input.beneficiaryCategory) fail("VALIDATION_ERROR", "Choose a directory person or enter an external beneficiary, not both.");
    const person = await directoryPerson(tx, input.personId);
    return { personId: person.id, personName: person.name, beneficiaryCategory: person.category };
  }
  if (input.beneficiaryName || input.beneficiaryCategory) {
    if (!input.beneficiaryName || !input.beneficiaryCategory) fail("VALIDATION_ERROR", "Enter the beneficiary's name and category.");
    return { personId: null, personName: input.beneficiaryName, beneficiaryCategory: input.beneficiaryCategory };
  }
  const [account] = await tx.select({ name: user.name }).from(user).where(eq(user.id, actor.id));
  const [person] = await tx.select({ id: people.id }).from(people).where(and(eq(people.userId, actor.id), eq(people.active, true)));
  if (!account) fail("NOT_FOUND", "This account is unavailable.");
  return { personId: person?.id ?? null, personName: account.name, beneficiaryCategory: "personnel" as const };
}
