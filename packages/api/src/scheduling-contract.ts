import { z } from "zod";

export const scheduleDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2100-12-31";
}, "Enter a real date between 2000 and 2100.");
export const scheduleRange = z.object({ startDate: scheduleDate, endDate: scheduleDate }).refine((value) => value.endDate >= value.startDate && daysBetween(value.startDate, value.endDate) < 366, "Choose an inclusive range of 1–366 days.");
export const categorySchema = z.enum(["shs", "jhs", "personnel"]);
export const historicCategorySchema = z.enum(["teacher", "shs", "jhs", "personnel"]);
export const guestCategorySchema = z.enum(["teacher", "personnel", "student", "other"]);
export const personInput = z.object({ id: z.string().uuid().optional(), expectedVersion: z.number().int().min(0).optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/), name: z.string().trim().min(1).max(160), category: categorySchema, userId: z.string().min(1).max(128).nullable(), active: z.boolean() }).refine(v => v.category === "personnel" || v.userId === null, "Teachers do not need a login account.");
export const peopleInput = pageInputForPeople();
function pageInputForPeople() { return z.object({ page: z.number().int().min(1).max(100000).default(1), search: z.string().trim().max(120).default(""), includeInactive: z.boolean().default(false), teachersOnly: z.boolean().default(false) }); }
export const invitationInput = z.object({ kind: z.enum(["leave", "resource"]), personId: z.string().uuid().optional(), expiresInHours: z.number().int().min(1).max(168) }).refine(v => v.kind === "leave" ? !!v.personId : !v.personId, "Choose one teacher for a leave link.");
export const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This request link is unavailable.");
export const policyInput = z.object({ leaveEnabled: z.boolean(), publicLeave: z.boolean(), teacherLimit: z.number().int().min(0).max(10000).nullable(), personnelLimit: z.number().int().min(0).max(10000).nullable(), shsLimit: z.number().int().min(0).max(10000).nullable(), jhsLimit: z.number().int().min(0).max(10000).nullable(), expectedVersion: z.number().int().min(0) });
export const resourceInput = z.object({ id: z.string().uuid().optional(), expectedVersion: z.number().int().min(0).optional(), name: z.string().trim().min(1).max(120), kind: z.enum(["equipment", "facility"]), lotId: z.string().uuid().nullable(), publicDescription: z.string().trim().max(500), active: z.boolean(), published: z.boolean() }).refine((v) => (v.kind === "equipment") === (v.lotId !== null), "Equipment requires an inventory lot; facilities must have no lot.");
export const leaveInput = scheduleRange.safeExtend({ personId: z.string().uuid().optional(), reason: z.string().trim().min(1).max(2000), operationId: z.string().uuid() });
export const reservationInput = scheduleRange.safeExtend({ personId: z.string().uuid().optional(), beneficiaryName: z.string().trim().min(1).max(160).optional(), beneficiaryCategory: guestCategorySchema.optional(), resourceId: z.string().uuid(), purpose: z.string().trim().min(1).max(2000), operationId: z.string().uuid() });
const editFields = { id: z.string().uuid(), expectedVersion: z.number().int().min(0), changeReason: z.string().trim().min(1).max(1000) };
export const editLeaveInput = scheduleRange.safeExtend({ reason: z.string().trim().min(1).max(2000), operationId: z.string().uuid(), ...editFields });
export const editReservationInput = scheduleRange.safeExtend({ resourceId: z.string().uuid(), purpose: z.string().trim().min(1).max(2000), operationId: z.string().uuid(), ...editFields });
export const decisionInput = z.object({ kind: z.enum(["leave", "resource"]), id: z.string().uuid(), expectedVersion: z.number().int().min(0), status: z.enum(["approved", "rejected", "cancelled"]), note: z.string().trim().min(1).max(1000) });
export const availabilityInput = scheduleRange.safeExtend({ resourceId: z.string().uuid().optional() }).refine((v) => daysBetween(v.startDate, v.endDate) < 31, "Availability covers at most 31 days.");
export const pageInput = z.object({ page: z.number().int().min(1).max(100000).default(1), search: z.string().trim().max(120).default("") });
export function daysBetween(start: string, end: string) { return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000; }
export function dateDays(start: string, end: string) {
  const days: string[] = [];
  for (let day = Date.parse(`${start}T00:00:00Z`); day <= Date.parse(`${end}T00:00:00Z`); day += 86400000) days.push(new Date(day).toISOString().slice(0, 10));
  return days;
}
export function manilaToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

export const publicSubmissionInput = scheduleRange.safeExtend({ token: invitationToken, operationId: z.string().uuid(), detail: z.string().trim().min(1).max(2000), resourceId: z.string().uuid().optional(), beneficiaryName: z.string().trim().min(1).max(160).optional(), beneficiaryCategory: guestCategorySchema.optional() }).strict();
export const invitationAvailabilityInput = availabilityInput.safeExtend({ token: invitationToken });
export const categoryLabels = { shs: "SHS (Senior High School)", jhs: "JHS (Junior High School)", personnel: "Personnel", teacher: "Teacher (legacy, classify before new leave)", student: "Student", other: "Other" } as const;
