import { z } from "zod";
import { protectedProcedure } from "../index";
import { MatmsError } from "../errors";
import { CustodialError, approveCustodialPropertyException, createCustodialBalance, createCustodialItem, createCustodialLot, custodialDashboard, getCustodialItem, getCustodialStockCard, listCustodialItems, postCustodialOperation, previewCustodialOperation, updateCustodialItem, updateCustodialLot } from "../custodial-service";

const uuid = z.string().uuid();
const requiredText = z.string().trim().min(1).max(1000);
const optionalText = z.string().trim().max(1000).nullable().optional();
const operationId = uuid;
const posting = z.object({ balanceId: uuid, destinationBalanceId: uuid.optional(), operationId, type: z.enum(["opening", "receipt", "issue", "return", "transfer", "adjustment"]), quantity: z.number().int().min(0).max(2147483647), expectedVersion: z.number().int().min(0).max(2147483647).optional(), transactionDate: z.iso.date(), reference: requiredText, reason: requiredText, counterparty: requiredText.optional(), daysToConsume: z.number().int().min(0).max(2147483647).optional(), confirmBackdated: z.boolean().optional(), backdatedPreviewHash: z.string().regex(/^[0-9a-f]{64}$/).optional() });

async function safely<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof CustodialError) throw new MatmsError(error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code, error.message).toORPCError();
    if (error && typeof error === "object") {
      const dbError = error as { code?: unknown; cause?: { code?: unknown } };
      if (dbError.code === "23505" || dbError.cause?.code === "23505") throw new MatmsError("CONFLICT", "An inventory record with this identity already exists.").toORPCError();
    }
    throw error;
  }
}

export const custodialInventoryRouter = {
  dashboard: protectedProcedure.handler(({ context }) => safely(() => custodialDashboard(context.db, { id: context.session.user.id }))),
  listItems: protectedProcedure.input(z.object({ page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(100).default(25), filters: z.object({ query: z.string().trim().max(200).optional(), reportingClass: z.enum(["stock_card", "semi_expendable", "ppe"]).optional(), sectionId: uuid.optional(), fundCluster: requiredText.optional(), office: requiredText.optional(), condition: requiredText.optional(), active: z.boolean().optional(), acquisitionYear: z.string().regex(/^\d{4}$/).optional(), reorder: z.boolean().optional(), outOfStock: z.boolean().optional(), conditionReview: z.boolean().optional(), dataQuality: z.boolean().optional() }).strict().default({}) })).handler(({ context, input }) =>
    safely(() => listCustodialItems(context.db, { id: context.session.user.id }, input))),
  getItem: protectedProcedure.input(z.object({ itemId: uuid })).handler(({ context, input }) =>
    safely(() => getCustodialItem(context.db, { id: context.session.user.id }, input.itemId))),
  createItem: protectedProcedure.input(z.object({ code: requiredText, article: requiredText, description: requiredText, unit: requiredText, reorderPoint: z.number().int().min(0).max(2147483647).nullable(), defaultSectionId: uuid.nullable().optional(), operationId })).handler(({ context, input }) =>
    safely(() => createCustodialItem(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  updateItem: protectedProcedure.input(z.object({ itemId: uuid, expectedVersion: z.number().int().min(0).max(2147483647), code: requiredText, article: requiredText, description: requiredText, unit: requiredText, reorderPoint: z.number().int().min(0).max(2147483647).nullable(), defaultSectionId: uuid.nullable(), notes: z.string().max(4000).nullable(), active: z.boolean(), reason: requiredText, operationId })).handler(({ context, input }) =>
    safely(() => updateCustodialItem(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  createLot: protectedProcedure.input(z.object({ itemId: uuid, reportingClass: z.enum(["stock_card", "semi_expendable", "ppe"]), propertyNumber: optionalText, propertyExceptionId: uuid.nullable().optional(), unitValue: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable(), supplier: optionalText, acquiredOn: z.iso.date().nullable().optional(), yearLabel: optionalText, fundCluster: requiredText, office: requiredText, accountableOfficer: optionalText, condition: z.enum(["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"]).nullable().optional(), remarks: optionalText, operationId })).handler(({ context, input }) =>
    safely(() => createCustodialLot(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  updateLot: protectedProcedure.input(z.object({ lotId: uuid, expectedVersion: z.number().int().min(0).max(2147483647), propertyNumber: z.string().trim().max(1000).nullable(), propertyExceptionId: uuid.nullable(), unitValue: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable(), supplier: z.string().trim().max(1000).nullable(), acquiredOn: z.iso.date().nullable(), yearLabel: z.string().trim().max(1000).nullable(), fundCluster: requiredText, office: requiredText, accountableOfficer: z.string().trim().max(1000).nullable(), condition: z.enum(["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"]).nullable(), remarks: z.string().trim().max(1000).nullable(), active: z.boolean(), reason: requiredText, operationId })).handler(({ context, input }) =>
    safely(() => updateCustodialLot(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  createBalance: protectedProcedure.input(z.object({ itemId: uuid, lotId: uuid.nullable().optional(), fundCluster: requiredText, office: requiredText, operationId })).handler(({ context, input }) =>
    safely(() => createCustodialBalance(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  approvePropertyException: protectedProcedure.input(z.object({ fundCluster: requiredText, propertyNumber: requiredText, reason: requiredText, operationId })).handler(({ context, input }) =>
    safely(() => approveCustodialPropertyException(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  stockCard: protectedProcedure.input(z.object({ itemId: uuid, fundCluster: requiredText, office: requiredText.optional(), asOfDate: z.iso.date() })).handler(({ context, input }) =>
    safely(() => getCustodialStockCard(context.db, { id: context.session.user.id }, input))),
  previewOperation: protectedProcedure.input(posting).handler(({ context, input }) =>
    safely(() => previewCustodialOperation(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  postOperation: protectedProcedure.input(posting).handler(({ context, input }) =>
    safely(() => postCustodialOperation(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
};
