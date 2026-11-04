import { z } from "zod";
import { protectedProcedure } from "../index";
import { getSchoolSettings, listActiveGrants, listAudit, updateSchoolSettings, previewAccess, auditFilterChoices } from "../admin-service";

export const adminRouter = {
  previewAccess: protectedProcedure.input(z.object({ userId: z.string().min(1).max(128), targetType: z.enum(["box", "folder", "document"]), targetId: z.uuid() })).handler(({ context, input }) => previewAccess(context.db, { id: context.session!.user.id, role: context.session!.profile.role }, input)),
  auditChoices: protectedProcedure.handler(({ context }) => auditFilterChoices(context.db, { id: context.session!.user.id, role: context.session!.profile.role })),
  grants: protectedProcedure.input(z.object({ page: z.number().int().min(1).max(10000).default(1) })).handler(({ context, input }) => listActiveGrants(context.db, { id: context.session!.user.id, role: context.session!.profile.role }, input.page)),
  settings: {
    get: protectedProcedure.handler(({ context }) => getSchoolSettings(context.db)),
    update: protectedProcedure.input(z.object({ schoolName: z.string().trim().min(1).max(200), timezone: z.literal("Asia/Manila"), canonicalOrigin: z.string().trim().max(500).nullable(), redirectPlan: z.string().trim().max(2000).optional(), sessionIdleMinutes: z.number().int().min(5).max(120).optional(), sessionMaxHours: z.number().int().min(1).max(24).optional() })).handler(({ context, input }) => updateSchoolSettings(context.db, { id: context.session!.user.id, role: context.session!.profile.role }, { ...input, correlationId: context.correlationId })),
  },
  audit: protectedProcedure.input(z.object({
    filters: z.object({ action: z.string().trim().min(1).max(120).optional(), targetType: z.string().trim().min(1).max(120).optional(), actorId: z.string().trim().min(1).max(128).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }).refine((v) => !v.from || !v.to || v.from <= v.to, "The start date must not be after the end date."),
    page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(100).default(25),
  })).handler(({ context, input }) => listAudit(context.db, { id: context.session!.user.id, role: context.session!.profile.role }, input)),
};
