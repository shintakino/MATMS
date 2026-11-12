import { z } from "zod";
import { protectedProcedure } from "../index";
import { MatmsError } from "../errors";
import { icsDraftDetails } from "../ics-workbook";
import { listIcsIssues, previewIcs, generateIcs, listIcs, downloadIcs, suggestIcsNumber, getIcs, updateIcs, setIcsDeleted } from "../ics-service";
async function safely<T>(action:()=>Promise<T>){try{return await action();}catch(error){if(error instanceof MatmsError)throw error.toORPCError();if(error instanceof z.ZodError)throw new MatmsError("VALIDATION_ERROR","Check the slip details and try again.").toORPCError();throw error;}}
const page=z.object({page:z.number().int().min(1).max(10000).default(1)});
const edit=z.object({id:z.uuid(),expectedVersion:z.number().int().positive()});
const generation={details:icsDraftDetails,operationId:z.uuid(),expectedDataHash:z.string().regex(/^[0-9a-f]{64}$/)};
const reason=z.string().trim().min(1).max(1000);
export const inventoryIcsRouter={
  issues:protectedProcedure.input(page).handler(({context,input})=>safely(()=>listIcsIssues(context.db,context.session.user.id,input.page))),
  nextNumber:protectedProcedure.handler(({context})=>safely(()=>suggestIcsNumber(context.db,context.session.user.id))),
  preview:protectedProcedure.input(icsDraftDetails).handler(({context,input})=>safely(()=>previewIcs(context.db,context.session.user.id,input,context.correlationId))),
  previewEdit:protectedProcedure.input(edit.extend({details:icsDraftDetails})).handler(({context,input})=>safely(()=>previewIcs(context.db,context.session.user.id,input.details,context.correlationId,input))),
  generate:protectedProcedure.input(z.object(generation)).handler(({context,input})=>safely(()=>generateIcs(context.db,context.session.user.id,input,context.correlationId))),
  update:protectedProcedure.input(edit.extend({...generation,reason})).handler(({context,input})=>safely(()=>updateIcs(context.db,context.session.user.id,input,context.correlationId))),
  setDeleted:protectedProcedure.input(edit.extend({deleted:z.boolean(),operationId:z.uuid(),reason})).handler(({context,input})=>safely(()=>setIcsDeleted(context.db,context.session.user.id,input,context.correlationId))),
  get:protectedProcedure.input(z.object({id:z.uuid()})).handler(({context,input})=>safely(()=>getIcs(context.db,context.session.user.id,input.id))),
  list:protectedProcedure.input(page.extend({deleted:z.boolean().default(false)})).handler(({context,input})=>safely(()=>listIcs(context.db,context.session.user.id,input.page,input.deleted))),
  download:protectedProcedure.input(z.object({id:z.uuid(),version:z.number().int().positive().optional()})).handler(({context,input})=>safely(()=>downloadIcs(context.db,context.session.user.id,input.id,context.correlationId,input.version))),
};
