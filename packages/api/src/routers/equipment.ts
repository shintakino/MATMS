import { z } from "zod";
import { protectedProcedure } from "../index";
import { MatmsError } from "../errors";
import { CustodialError } from "../custodial-service";
import { actOnEquipment, equipmentActionInput, equipmentListInput, equipmentPage, equipmentRegisterInput, getEquipment, listEquipment, listEquipmentPeople, listEquipmentSources, registerEquipment } from "../equipment-service";
async function safely<T>(action:()=>Promise<T>) {
  try { return await action(); } catch(error) {
    if(error instanceof CustodialError)throw new MatmsError(error.code==="VALIDATION"?"VALIDATION_ERROR":error.code,error.message).toORPCError();
    if(error instanceof z.ZodError)throw new MatmsError("VALIDATION_ERROR","Check the device details and handover confirmation.").toORPCError();
    const code=(error as {code?:string;cause?:{code?:string}})?.cause?.code??(error as {code?:string})?.code;
    if(code==="23505")throw new MatmsError("CONFLICT","This device lot, permanent number or brand/serial number is already registered.").toORPCError();
    throw error;
  }
}
export const equipmentRouter={
  list:protectedProcedure.input(equipmentListInput).handler(({context,input})=>safely(()=>listEquipment(context.db,{id:context.session.user.id},input))),
  people:protectedProcedure.input(equipmentPage).handler(({context,input})=>safely(()=>listEquipmentPeople(context.db,{id:context.session.user.id},input))),
  sources:protectedProcedure.input(equipmentPage).handler(({context,input})=>safely(()=>listEquipmentSources(context.db,{id:context.session.user.id},input))),
  get:protectedProcedure.input(z.object({id:z.uuid(),page:z.number().int().min(1).max(10000).default(1)})).handler(({context,input})=>safely(()=>getEquipment(context.db,{id:context.session.user.id},input.id,input.page))),
  register:protectedProcedure.input(equipmentRegisterInput).handler(({context,input})=>safely(()=>registerEquipment(context.db,{id:context.session.user.id},input,context.correlationId))),
  act:protectedProcedure.input(equipmentActionInput).handler(({context,input})=>safely(()=>actOnEquipment(context.db,{id:context.session.user.id},input,context.correlationId))),
};
