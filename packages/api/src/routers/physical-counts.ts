import { z } from "zod";
import { protectedProcedure } from "../index";
import { MatmsError } from "../errors";
import {
  CustodialError, amendCustodialCount, countMetadata, conditionBreakdownSchema, custodialProfileDefinition, createCustodialCount, createCustodialFormProfile, createCustodialSection, updateCustodialSection,
  finalizeCustodialCount, getCustodialCount, getCustodialCountConfiguration, previewCustodialCountRefresh,
  listCustodialCounts, listCustodialCountAssignees,
  refreshCustodialCount, resolveCustodialCountLine, reviewCustodialCountLine,
  saveCustodialCountLine, setCustodialCountAssignment,
} from "../custodial-service";

const uuid = z.string().uuid();
const version = z.number().int().nonnegative().max(2147483647);
const note = z.string().trim().min(1).max(1000);
const operation = { operationId: uuid };
const sectionFields = { name: z.string().trim().min(1).max(240), sheetName: z.string().trim().min(1).max(31), displayOrder: version, active: z.boolean(), effectiveFrom: z.iso.date().nullable(), effectiveUntil: z.iso.date().nullable(), reason: note, ...operation };

async function safely<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof CustodialError) {
      throw new MatmsError(error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code, error.message).toORPCError();
    }
    throw error;
  }
}

export const physicalCountsRouter = {
  configuration: protectedProcedure.handler(({ context }) =>
    safely(() => getCustodialCountConfiguration(context.db, { id: context.session.user.id }))),
  assignees: protectedProcedure.handler(({ context }) =>
    safely(() => listCustodialCountAssignees(context.db, { id: context.session.user.id }))),
  createProfile: protectedProcedure.input(z.object({ family: z.enum(["stock_card", "rpcsp", "rpcppe"]), effectiveFrom: z.iso.date(), sourceHash: z.string().regex(/^[0-9a-f]{64}$/), versionNote: note, visualApproval: note, definition: custodialProfileDefinition, ...operation })).handler(({ context, input }) =>
    safely(() => createCustodialFormProfile(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  createSection: protectedProcedure.input(z.object({ code: z.string().trim().min(1).max(64), family: z.enum(["rpcsp", "rpcppe"]), ...sectionFields })).handler(({ context, input }) =>
    safely(() => createCustodialSection(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  updateSection: protectedProcedure.input(z.object({ sectionId: uuid, expectedVersion: version, ...sectionFields })).handler(({ context, input }) =>
    safely(() => updateCustodialSection(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  list: protectedProcedure.input(z.object({ page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(100).default(25) })).handler(({ context, input }) =>
    safely(() => listCustodialCounts(context.db, { id: context.session.user.id }, input))),
  get: protectedProcedure.input(z.object({ countId: uuid })).handler(({ context, input }) =>
    safely(() => getCustodialCount(context.db, { id: context.session.user.id }, input.countId))),
  create: protectedProcedure.input(z.object({ code: note, family: z.enum(["rpcsp", "rpcppe"]), profileId: uuid, asOfDate: z.iso.date(), fundCluster: note, office: note.nullable().optional(), sectionIds: z.array(uuid).max(100).optional(), metadata: countMetadata, ...operation })).handler(({ context, input }) =>
    safely(() => createCustodialCount(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  previewRefresh: protectedProcedure.input(z.object({ countId: uuid })).handler(({ context, input }) =>
    safely(() => previewCustodialCountRefresh(context.db, { id: context.session.user.id }, input.countId))),
  refresh: protectedProcedure.input(z.object({ countId: uuid, expectedVersion: version, planHash: z.string().regex(/^[0-9a-f]{64}$/), includeLotIds: z.array(uuid).max(10000), excludeLots: z.array(z.object({ lotId: uuid, reason: note }).strict()).max(10000).optional(), ...operation })).handler(({ context, input }) =>
    safely(() => refreshCustodialCount(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  assign: protectedProcedure.input(z.object({ countId: uuid, lineId: uuid.nullable().optional(), userId: z.string().min(1).max(256), active: z.boolean(), ...operation })).handler(({ context, input }) =>
    safely(() => setCustodialCountAssignment(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  save: protectedProcedure.input(z.object({ countId: uuid, lineId: uuid, expectedVersion: version, physicalQuantity: version, condition: z.enum(["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved", "mixed"]), conditionBreakdown: conditionBreakdownSchema.nullable().optional(), remarks: z.string().max(4000).nullable().optional(), reviewerNote: z.string().max(4000).nullable().optional(), ...operation })).handler(({ context, input }) =>
    safely(() => saveCustodialCountLine(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  review: protectedProcedure.input(z.object({ countId: uuid, lineId: uuid, expectedVersion: version, note, ...operation })).handler(({ context, input }) =>
    safely(() => reviewCustodialCountLine(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  resolve: protectedProcedure.input(z.object({ countId: uuid, lineId: uuid, expectedVersion: version, status: z.enum(["excluded", "unavailable"]), reason: note, ...operation })).handler(({ context, input }) =>
    safely(() => resolveCustodialCountLine(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  finalize: protectedProcedure.input(z.object({ countId: uuid, expectedVersion: version, reviewedSheets: z.array(z.string().min(1).max(31)).max(3), ...operation })).handler(({ context, input }) =>
    safely(() => finalizeCustodialCount(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
  amend: protectedProcedure.input(z.object({ countId: uuid, code: note, reason: note, ...operation })).handler(({ context, input }) =>
    safely(() => amendCustodialCount(context.db, { id: context.session.user.id }, { ...input, correlationId: context.correlationId }))),
};
