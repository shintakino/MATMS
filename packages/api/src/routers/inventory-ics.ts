import { z } from "zod";
import { protectedProcedure } from "../index";
import { MatmsError } from "../errors";
import { icsDetails } from "../ics-workbook";
import { listIcsIssues, previewIcs, generateIcs, listIcs, downloadIcs } from "../ics-service";
async function safely<T>(action:()=>Promise<T>){try{return await action();}catch(error){if(error instanceof MatmsError)throw error.toORPCError();throw error;}}
const page=z.object({page:z.number().int().min(1).max(10000).default(1)});
export const inventoryIcsRouter={
  issues:protectedProcedure.input(page).handler(({context,input})=>safely(()=>listIcsIssues(context.db,context.session.user.id,input.page))),
  preview:protectedProcedure.input(icsDetails).handler(({context,input})=>safely(()=>previewIcs(context.db,context.session.user.id,input,context.correlationId))),
  generate:protectedProcedure.input(z.object({details:icsDetails,operationId:z.uuid(),expectedDataHash:z.string().regex(/^[0-9a-f]{64}$/)})).handler(({context,input})=>safely(()=>generateIcs(context.db,context.session.user.id,input,context.correlationId))),
  list:protectedProcedure.input(page).handler(({context,input})=>safely(()=>listIcs(context.db,context.session.user.id,input.page))),
  download:protectedProcedure.input(z.object({id:z.uuid()})).handler(({context,input})=>safely(()=>downloadIcs(context.db,context.session.user.id,input.id,context.correlationId))),
};
