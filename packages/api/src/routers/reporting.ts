import { z } from "zod";

import { dashboard, exportReport, queryReport, reportKinds } from "../reporting-service";
import { protectedProcedure } from "../index";

const filters = z.object({
  query: z.string().trim().max(200).optional(),
  kind: z.enum(["box", "folder", "document", "inventory", "template"]).optional(),
  categoryId: z.string().uuid().optional(),
  shelfId: z.string().uuid().optional(),
  lifecycle: z.enum(["active", "archived", "retired"]).optional(),
  recordLifecycle: z.enum(["active", "archived", "retired"]).optional(),
  folderLifecycle: z.enum(["active", "archived", "retired"]).optional(),
  confidentiality: z.enum(["internal", "restricted"]).optional(),
  stockStatus: z.enum(["out", "low", "in"]).optional(),
  revisionStatus: z.enum(["active", "superseded", "retired"]).optional(),
  requestStatus: z.enum(["draft", "submitted", "approved", "rejected", "cancelled", "in_progress", "completed"]).optional(),
  loanStatus: z.enum(["active", "overdue", "closed"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "The end date must not precede the start date." });
const paging = { page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(100).default(25) };

export const reportingRouter = {
  dashboard: protectedProcedure.handler(({ context }) => dashboard(context.db, { id: context.session!.user.id, role: context.session!.profile.role })),
  search: protectedProcedure.input(z.object({ filters: filters.default({}), ...paging })).handler(({ context, input }) =>
    queryReport(context.db, { id: context.session!.user.id, role: context.session!.profile.role }, "search", input.filters, input.page, input.pageSize)),
  report: protectedProcedure.input(z.object({ kind: z.enum(reportKinds), filters: filters.default({}), ...paging })).handler(({ context, input }) =>
    queryReport(context.db, { id: context.session!.user.id, role: context.session!.profile.role }, input.kind, input.filters, input.page, input.pageSize)),
  exportCsv: protectedProcedure.input(z.object({ kind: z.enum(reportKinds), filters: filters.default({}) })).handler(({ context, input }) =>
    exportReport(context.db, { id: context.session!.user.id, role: context.session!.profile.role }, input.kind, input.filters, context.correlationId)),
};
