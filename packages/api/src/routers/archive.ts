import {
  ArchiveServiceError,
  createBox,
  createCategory,
  createDocument,
  createFolder,
  createLocation,
  getBox,
  getDocument,
  getFolder,
  grantAccess,
  listBoxes,
  listDocuments,
  listFolderChoices,
  refileDocument,
  relocateBox,
  relocateFolder,
  revokeAccess,
  setBoxLifecycle,
  setFolderLifecycle,
  setDocumentLifecycle,
  setReferenceActive,
  updateCategory,
  updateLocation,
  updateBoxCode,
  updateBoxDetails,
  updateFolder,
  updateDocument,
  listMovements,
} from "../archive-service";
import { MatmsError } from "../errors";
import { protectedProcedure } from "../index";
import { z } from "zod";
import { listLabelBoxes, lookupBoxCode } from "../qr-service";

const uuid = z.string().uuid();
const code = z.string().trim().min(1).max(64);
const confidentiality = z.enum(["internal", "restricted"]);
const lifecycle = z.enum(["active", "archived", "retired"]);
const optionalText = z.string().trim().max(4_000).nullable().optional();

function actor(context: { session: { user: { id: string }; profile: { role: "admin" | "property_custodian" | "staff" | "viewer" } } | null }) {
  return { id: context.session!.user.id, role: context.session!.profile.role };
}

function rethrow(error: unknown): never {
  if (error instanceof ArchiveServiceError) {
    const code = error.code === "UNAVAILABLE" ? "NOT_FOUND" : error.code === "VALIDATION" ? "VALIDATION_ERROR" : error.code;
    const message = error.code === "UNAVAILABLE" ? "This record is unavailable." : error.message;
    throw new MatmsError(code, message).toORPCError();
  }
  if (error && typeof error === "object") {
    const databaseError = error as { code?: unknown; cause?: { code?: unknown } };
    if (databaseError.code === "23505" || databaseError.cause?.code === "23505") throw new MatmsError("CONFLICT", "A record with this code already exists.").toORPCError();
  }
  throw error;
}

export const archiveRouter = {
  history: protectedProcedure.input(z.object({ kind: z.enum(["box", "folder", "document"]), id: uuid, page: z.number().int().min(1).max(10000).default(1) })).handler(async ({ context, input }) => {
    try { return await listMovements(context.db, actor(context), input); } catch (error) { return rethrow(error); }
  }),
  categories: {
    list: protectedProcedure.handler(async ({ context }) => context.db.select().from((await import("@matms/db/schema/archive")).categories)),
    setActive: protectedProcedure.input(z.object({ id: uuid, active: z.boolean() })).handler(async ({ context, input }) => { try { return await setReferenceActive(context.db, actor(context), { ...input, kind: "category", correlationId: context.correlationId }); } catch (error) { return rethrow(error); } }),
    update: protectedProcedure.input(z.object({ id: uuid, code, name: z.string().trim().min(2).max(120) })).handler(async ({ context, input }) => { try { return await updateCategory(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); } }),
    create: protectedProcedure
      .input(z.object({ code, name: z.string().trim().min(2).max(120) }))
      .handler(async ({ context, input }) => {
        try { return await createCategory(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
      }),
  },
  locations: {
    list: protectedProcedure.handler(async ({ context }) => context.db.select().from((await import("@matms/db/schema/archive")).shelfLocations)),
    setActive: protectedProcedure.input(z.object({ id: uuid, active: z.boolean() })).handler(async ({ context, input }) => { try { return await setReferenceActive(context.db, actor(context), { ...input, kind: "location", correlationId: context.correlationId }); } catch (error) { return rethrow(error); } }),
    update: protectedProcedure.input(z.object({ id: uuid, code, room: z.string().trim().min(1).max(120), shelf: z.string().trim().min(1).max(120), rack: z.string().trim().min(1).max(120), position: z.string().trim().max(120).nullable().optional(), label: z.string().trim().min(1).max(200) })).handler(async ({ context, input }) => { try { return await updateLocation(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); } }),
    create: protectedProcedure
      .input(z.object({ code, room: z.string().trim().min(1).max(120), shelf: z.string().trim().min(1).max(120), rack: z.string().trim().min(1).max(120), position: z.string().trim().max(120).nullable().optional(), label: z.string().trim().min(1).max(200) }))
      .handler(async ({ context, input }) => {
        try { return await createLocation(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
      }),
  },
  boxes: {
    list: protectedProcedure.handler(async ({ context }) => listBoxes(context.db, actor(context))),
    labels: protectedProcedure.handler(async ({ context }) => {
      try { return await listLabelBoxes(context.db, actor(context)); } catch (error) { return rethrow(error); }
    }),
    lookupCode: protectedProcedure.input(z.object({ code })).handler(async ({ context, input }) => {
      try { return await lookupBoxCode(context.db, actor(context), input.code); } catch (error) { return rethrow(error); }
    }),
    get: protectedProcedure.input(z.object({ id: uuid })).handler(async ({ context, input }) => {
      try { return await getBox(context.db, actor(context), input.id); } catch (error) { return rethrow(error); }
    }),
    create: protectedProcedure.input(z.object({ code, categoryId: uuid, shelfLocationId: uuid, confidentiality, notes: optionalText })).handler(async ({ context, input }) => {
      try { return await createBox(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    changeCode: protectedProcedure.input(z.object({ boxId: uuid, code })).handler(async ({ context, input }) => {
      try { return await updateBoxCode(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    update: protectedProcedure.input(z.object({ boxId: uuid, categoryId: uuid, confidentiality, notes: optionalText })).handler(async ({ context, input }) => {
      try { return await updateBoxDetails(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    relocate: protectedProcedure.input(z.object({ boxId: uuid, shelfLocationId: uuid, reason: z.string().trim().min(3).max(1_000) })).handler(async ({ context, input }) => {
      try { return await relocateBox(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    setLifecycle: protectedProcedure.input(z.object({ boxId: uuid, lifecycle })).handler(async ({ context, input }) => {
      try { return await setBoxLifecycle(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
  },
  folders: {
    update: protectedProcedure.input(z.object({ id: uuid, code: code.optional(), isTemplateFolder: z.boolean().optional(), name: z.string().trim().min(1).max(240), color: z.enum(["yellow", "blue", "red", "other"]), urgency: z.string().trim().max(120).nullable().optional(), notes: optionalText, confidentiality })).handler(async ({ context, input }) => {
      try { return await updateFolder(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    list: protectedProcedure.handler(({ context }) => listFolderChoices(context.db, actor(context))),
    get: protectedProcedure.input(z.object({ id: uuid, includeRetired: z.boolean().optional() })).handler(async ({ context, input }) => {
      try { return await getFolder(context.db, actor(context), input.id, input.includeRetired); } catch (error) { return rethrow(error); }
    }),
    setLifecycle: protectedProcedure.input(z.object({ folderId: uuid, lifecycle })).handler(async ({ context, input }) => {
      try { return await setFolderLifecycle(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    create: protectedProcedure.input(z.object({ boxId: uuid, code, name: z.string().trim().min(1).max(240), color: z.enum(["yellow", "blue", "red", "other"]), isTemplateFolder: z.boolean().optional(), urgency: z.string().trim().max(120).nullable().optional(), notes: optionalText, confidentiality })).handler(async ({ context, input }) => {
      try { return await createFolder(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    relocate: protectedProcedure.input(z.object({ folderId: uuid, boxId: uuid, reason: z.string().trim().min(3).max(1_000) })).handler(async ({ context, input }) => {
      try { return await relocateFolder(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
  },
  documents: {
    update: protectedProcedure.input(z.object({ id: uuid, code: code.optional(), title: z.string().trim().min(1).max(500), documentDate: z.iso.date().nullable().optional(), coveredPeriod: z.string().trim().max(240).nullable().optional(), keywords: z.string().trim().max(1000).nullable().optional(), description: optionalText, digitalUrl: z.string().url().nullable().optional(), confidentiality })).handler(async ({ context, input }) => {
      try { return await updateDocument(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    list: protectedProcedure.handler(async ({ context }) => listDocuments(context.db, actor(context))),
    get: protectedProcedure.input(z.object({ id: uuid })).handler(async ({ context, input }) => {
      try { return await getDocument(context.db, actor(context), input.id); } catch (error) { return rethrow(error); }
    }),
    setLifecycle: protectedProcedure.input(z.object({ documentId: uuid, lifecycle })).handler(async ({ context, input }) => {
      try { return await setDocumentLifecycle(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    create: protectedProcedure.input(z.object({ folderId: uuid, code, title: z.string().trim().min(1).max(500), documentDate: z.iso.date().nullable().optional(), coveredPeriod: z.string().trim().max(240).nullable().optional(), keywords: z.string().trim().max(1_000).nullable().optional(), description: optionalText, digitalUrl: z.string().url().nullable().optional(), confidentiality })).handler(async ({ context, input }) => {
      try { return await createDocument(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    refile: protectedProcedure.input(z.object({ documentId: uuid, folderId: uuid, reason: z.string().trim().min(3).max(1_000) })).handler(async ({ context, input }) => {
      try { return await refileDocument(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
  },
  access: {
    grant: protectedProcedure.input(z.object({ userId: uuid, boxId: uuid.optional(), folderId: uuid.optional(), documentId: uuid.optional() })).handler(async ({ context, input }) => {
      try { return await grantAccess(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
    revoke: protectedProcedure.input(z.object({ grantId: uuid })).handler(async ({ context, input }) => {
      try { return await revokeAccess(context.db, actor(context), { ...input, correlationId: context.correlationId }); } catch (error) { return rethrow(error); }
    }),
  },
};
