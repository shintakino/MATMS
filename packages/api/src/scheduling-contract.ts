import { z } from "zod";

export const scheduleDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2100-12-31";
}, "Enter a real date between 2000 and 2100.");
export const scheduleRange = z.object({ startDate: scheduleDate, endDate: scheduleDate }).refine((value) => value.endDate >= value.startDate && daysBetween(value.startDate, value.endDate) < 366, "Choose an inclusive range of 1–366 days.");
export const categorySchema = z.enum(["teacher", "personnel"]);
export const policyInput = z.object({ leaveEnabled: z.boolean(), publicLeave: z.boolean(), teacherLimit: z.number().int().min(0).max(10000).nullable(), personnelLimit: z.number().int().min(0).max(10000).nullable(), expectedVersion: z.number().int().min(0) });
export const resourceInput = z.object({ id: z.string().uuid().optional(), expectedVersion: z.number().int().min(0).optional(), name: z.string().trim().min(1).max(120), kind: z.enum(["equipment", "facility"]), lotId: z.string().uuid().nullable(), publicDescription: z.string().trim().max(500), active: z.boolean(), published: z.boolean() }).refine((v) => (v.kind === "equipment") === (v.lotId !== null), "Equipment requires an inventory lot; facilities must have no lot.");
export const leaveInput = scheduleRange.safeExtend({ reason: z.string().trim().min(1).max(2000), operationId: z.string().uuid() });
export const reservationInput = scheduleRange.safeExtend({ resourceId: z.string().uuid(), purpose: z.string().trim().min(1).max(2000), operationId: z.string().uuid() });
const editFields = { id: z.string().uuid(), expectedVersion: z.number().int().min(0), changeReason: z.string().trim().min(1).max(1000) };
export const editLeaveInput = leaveInput.safeExtend(editFields);
export const editReservationInput = reservationInput.safeExtend(editFields);
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
