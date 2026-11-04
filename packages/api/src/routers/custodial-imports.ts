import { z } from "zod";
import { protectedProcedure } from "../index";
import { MatmsError } from "../errors";
import { CustodialError, commitCustodialImportCombined, commitCustodialImportCount, commitCustodialImportLedger, commitCustodialImportOpenings, countMetadata, createCustodialClassificationPolicy, exportCustodialImportErrors, getCustodialImport, importMappingSchema, listCustodialImports, resolveCustodialImportRow } from "../custodial-service";

const uuid = z.string().uuid();
const version = z.number().int().min(0).max(2147483647);
const requiredText = z.string().trim().min(1).max(1000);
const warning = z.object({ code: z.string().min(1).max(300), reason: requiredText }).strict();
const base = { batchId: uuid, sourceHash: z.string().regex(/^[0-9a-f]{64}$/), expectedBatchVersion: version, confirmed: z.literal(true), acknowledgedExclusions: z.boolean(), operationId: uuid };
const count = { code: requiredText, profileId: uuid, asOfDate: z.iso.date(), fundCluster: requiredText, office: requiredText.nullable().optional(), metadata: countMetadata, warningResolutions: z.array(warning).max(5000) };
const commit = z.discriminatedUnion("effect", [
  z.object({ ...base, effect: z.literal("draft_count"), ...count }),
  z.object({ ...base, effect: z.literal("verified_openings"), warningResolutions: z.array(warning).max(5000) }),
  z.object({ ...base, effect: z.literal("openings_and_draft_count"), ...count }),
  z.object({ ...base, effect: z.literal("historical_ledger"), warningResolutions: z.array(warning).max(5000) }),
]);
async function safely<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) { if (error instanceof CustodialError) throw new MatmsError(error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code, error.message).toORPCError(); throw error; }
}
export const custodialImportsRouter = {
  createPolicy: protectedProcedure.input(z.object({ effectiveFrom: z.iso.date(), threshold: z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/), note: requiredText, operationId: uuid })).handler(({ context, input }) =>
    safely(() => createCustodialClassificationPolicy(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  list: protectedProcedure.input(z.object({ page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(100).default(25) })).handler(({ context, input }) =>
    safely(() => listCustodialImports(context.db, { id: context.session.user.id }, input))),
  get: protectedProcedure.input(z.object({ batchId: uuid })).handler(({ context, input }) =>
    safely(() => getCustodialImport(context.db, { id: context.session.user.id }, input.batchId))),
  resolve: protectedProcedure.input(z.object({ batchId: uuid, rowId: uuid, expectedBatchVersion: version, expectedRowVersion: version, mapping: importMappingSchema, operationId: uuid })).handler(({ context, input }) =>
    safely(() => resolveCustodialImportRow(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  errors: protectedProcedure.input(z.object({ batchId: uuid, expectedVersion: version, operationId: uuid })).handler(({ context, input }) =>
    safely(() => exportCustodialImportErrors(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  commit: protectedProcedure.input(commit).handler(({ context, input }) => safely(async () => {
    const actor = { id: context.session.user.id }; const data = { ...input, correlationId: context.correlationId };
    switch (data.effect) {
      case "draft_count": return await commitCustodialImportCount(context.db, actor, data);
      case "verified_openings": return await commitCustodialImportOpenings(context.db, actor, data);
      case "openings_and_draft_count": return await commitCustodialImportCombined(context.db, actor, data);
      case "historical_ledger": return await commitCustodialImportLedger(context.db, actor, data);
    }
  })),
};
