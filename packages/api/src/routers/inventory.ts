import {
  InventoryServiceError,
  correctStock,
  createInventoryLine,
  createTemplate,
  issueStock,
  listInventory,
  receiveStock,
  transferStock,
} from "../inventory-service";
import { MatmsError } from "../errors";
import { protectedProcedure } from "../index";
import { templates } from "@matms/db/schema/inventory";
import { eq } from "drizzle-orm";
import { z } from "zod";

const uuid = z.string().uuid();
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();

function actor(context: { session: { user: { id: string }; profile: { role: "admin" | "staff" | "viewer" } } | null }) {
  return { id: context.session!.user.id, role: context.session!.profile.role };
}

function rethrow(error: unknown): never {
  if (error instanceof InventoryServiceError) {
    const code = error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code === "UNAVAILABLE" ? "NOT_FOUND" : error.code;
    throw new MatmsError(code, error.code === "UNAVAILABLE" ? "This inventory line is unavailable." : error.message).toORPCError();
  }
  throw error;
}

export const inventoryRouter = {
  templates: {
    list: protectedProcedure.handler(async ({ context }) => context.db.select().from(templates).orderBy(templates.name, templates.revisionLabel)),
    get: protectedProcedure.input(z.object({ id: uuid })).handler(async ({ context, input }) => {
      const [template] = await context.db.select().from(templates).where(eq(templates.id, input.id)).limit(1);
      if (!template) throw new MatmsError("NOT_FOUND", "This template is unavailable.").toORPCError();
      const inventory = (await listInventory(context.db, actor(context))).filter((line) => line.templateId === template.id);
      if (context.session!.profile.role !== "admin" && inventory.length === 0) {
        throw new MatmsError("NOT_FOUND", "This template is unavailable.").toORPCError();
      }
      return { template, inventory };
    }),
    create: protectedProcedure
      .input(z.object({ code: z.string().trim().min(1).max(64), familyCode: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(240), description: z.string().trim().max(4_000).nullable().optional(), categoryId: uuid, revisionLabel: z.string().trim().min(1).max(120), revisionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), digitalUrl: z.string().url(), supersedesId: uuid.nullable().optional() }))
      .handler(async ({ context, input }) => {
        try { return await createTemplate(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
      }),
  },
  inventory: {
    list: protectedProcedure.handler(async ({ context }) => listInventory(context.db, actor(context))),
    forFolder: protectedProcedure.input(z.object({ folderId: uuid })).handler(async ({ context, input }) =>
      (await listInventory(context.db, actor(context))).filter((line) => line.folderId === input.folderId),
    ),
    createLine: protectedProcedure.input(z.object({ templateId: uuid, folderId: uuid, threshold: nonnegativeInteger.optional() })).handler(async ({ context, input }) => {
      try { return await createInventoryLine(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    receive: protectedProcedure.input(z.object({ inventoryId: uuid, quantity: positiveInteger, reason: z.string().trim().min(3).max(1_000), reference: z.string().trim().max(240).nullable().optional(), operationId: uuid })).handler(async ({ context, input }) => {
      try { return await receiveStock(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    issue: protectedProcedure.input(z.object({ inventoryId: uuid, quantity: positiveInteger, reason: z.string().trim().min(3).max(1_000), reference: z.string().trim().max(240).nullable().optional(), supersededDecision: z.string().trim().max(1_000).nullable().optional(), operationId: uuid })).handler(async ({ context, input }) => {
      try { return await issueStock(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    transfer: protectedProcedure.input(z.object({ sourceInventoryId: uuid, destinationInventoryId: uuid, quantity: positiveInteger, reason: z.string().trim().min(3).max(1_000), operationId: uuid })).handler(async ({ context, input }) => {
      try { return await transferStock(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    correct: protectedProcedure.input(z.object({ inventoryId: uuid, count: nonnegativeInteger, expectedVersion: nonnegativeInteger, reason: z.string().trim().min(3).max(1_000), operationId: uuid })).handler(async ({ context, input }) => {
      try { return await correctStock(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
  },
};
