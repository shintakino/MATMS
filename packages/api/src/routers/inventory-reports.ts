import { z } from "zod";
import { protectedProcedure } from "../index";
import { MatmsError } from "../errors";
import { CustodialError, generateCustodialReport, getCustodialReportExport, listCustodialReportExports, previewCustodialCountReport, previewCustodialStockReport } from "../custodial-service";

const uuid = z.string().uuid();
const stockScope = { itemId: uuid, profileId: uuid, fundCluster: z.string().trim().min(1).max(1000), office: z.string().trim().min(1).max(1000).nullable().optional(), asOfDate: z.iso.date(), entity: z.string().trim().min(1).max(240) };
const input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), countId: uuid, operationId: uuid }),
  z.object({ kind: z.literal("stock_card"), ...stockScope, expectedDataHash: z.string().regex(/^[0-9a-f]{64}$/), operationId: uuid }),
]);
async function safely<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) { if (error instanceof CustodialError) throw new MatmsError(error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code, error.message).toORPCError(); throw error; }
}
export const inventoryReportsRouter = {
  previewCount: protectedProcedure.input(z.object({ countId: uuid })).handler(({ context, input }) => safely(() => previewCustodialCountReport(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  previewStock: protectedProcedure.input(z.object(stockScope)).handler(({ context, input }) => safely(() => previewCustodialStockReport(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  generate: protectedProcedure.input(input).handler(({ context, input }) => safely(() => generateCustodialReport(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  list: protectedProcedure.input(z.object({ page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(100).default(25) })).handler(({ context, input }) => safely(() => listCustodialReportExports(context.db, { id: context.session.user.id }, input))),
  get: protectedProcedure.input(z.object({ exportId: uuid })).handler(({ context, input }) => safely(() => getCustodialReportExport(context.db, { id: context.session.user.id }, input.exportId, context.correlationId))),
};
