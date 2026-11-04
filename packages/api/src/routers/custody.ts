import { z } from "zod";

import { CustodyError, cancelRequest, createRequest, decideLine, fulfillLine, getRequest, listLoans, listRequests, recordException, releaseDocument, resolveException, returnDocument, submitRequest } from "../custody-service";
import { ArchiveServiceError } from "../archive-service";
import { MatmsError } from "../errors";
import { protectedProcedure } from "../index";
import type { Context } from "../context";

const id = z.string().uuid();
const requiredText = z.string().trim().min(1).max(1000);
const optionalText = z.string().trim().max(1000).nullish();
const actor = (context: Context) => ({ id: context.session!.user.id, role: context.session!.profile.role });

async function handle<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof CustodyError || error instanceof ArchiveServiceError) {
      const code = error.code === "UNAVAILABLE" ? "NOT_FOUND" : error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code;
      throw new MatmsError(code, error.message).toORPCError();
    }
    if (error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause && error.cause.code === "23505") {
      throw new MatmsError("CONFLICT", "This request conflicts with an existing record.").toORPCError();
    }
    throw error;
  }
}

export const custodyRouter = {
  requests: {
    list: protectedProcedure.input(z.object({ page: z.number().int().min(1).max(100000).default(1) }).optional()).handler(({ context, input }) => handle(() => listRequests(context.db, actor(context), input?.page))),
    get: protectedProcedure.input(z.object({ id })).handler(({ context, input }) => handle(() => getRequest(context.db, actor(context), input.id))),
    create: protectedProcedure.input(z.object({ code: z.string().trim().min(1).max(64), requesterName: requiredText, office: optionalText, contact: optionalText, purpose: requiredText, kind: z.enum(["inspect", "borrow", "copy"]), notes: optionalText, documentIds: z.array(id).min(1).max(100) })).handler(({ context, input }) => handle(() => createRequest(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
    submit: protectedProcedure.input(z.object({ requestId: id })).handler(({ context, input }) => handle(() => submitRequest(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
    cancel: protectedProcedure.input(z.object({ requestId: id })).handler(({ context, input }) => handle(() => cancelRequest(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
    decide: protectedProcedure.input(z.object({ itemId: id, decision: z.enum(["approved", "rejected", "cancelled"]), reason: optionalText })).handler(({ context, input }) => handle(() => decideLine(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
    fulfill: protectedProcedure.input(z.object({ itemId: id })).handler(({ context, input }) => handle(() => fulfillLine(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
  },
  loans: {
    list: protectedProcedure.input(z.object({ filter: z.enum(["all", "active", "overdue", "returned", "exception"]).default("active"), page: z.number().int().min(1).max(100000).default(1) }).optional()).handler(({ context, input }) => handle(() => listLoans(context.db, actor(context), input?.filter, input?.page))),
    release: protectedProcedure.input(z.object({ itemId: id, recipient: requiredText, acknowledged: z.boolean(), dueAt: z.string().datetime({ offset: true }), operationId: id })).handler(({ context, input }) => handle(() => releaseDocument(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
    return: protectedProcedure.input(z.object({ checkoutId: id, condition: requiredText, folderId: id.nullish(), relocationReason: optionalText, operationId: id })).handler(({ context, input }) => handle(() => returnDocument(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
    recordException: protectedProcedure.input(z.object({ checkoutId: id, exception: z.enum(["lost", "damaged"]), notes: requiredText })).handler(({ context, input }) => handle(() => recordException(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
    resolveException: protectedProcedure.input(z.object({ checkoutId: id, disposition: requiredText, notes: requiredText })).handler(({ context, input }) => handle(() => resolveException(context.db, actor(context), { ...input, correlationId: context.correlationId }))),
  },
};
