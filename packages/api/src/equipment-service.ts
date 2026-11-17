import { createHash } from "node:crypto";
import { and, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAuditEntry, type AuditTransaction, type Database } from "@matms/db";
import { equipmentUnits as units, equipmentEvents as events, equipmentStates, type EquipmentSnapshot } from "@matms/db/schema/equipment";
import { custodialLots as lots, custodialItems as items, custodialBalances as balances, custodialOperations as operations, custodialTransactions as transactions, custodialIcsDocuments as documents, custodialIcsVersions as versions, custodialIcsExports as exports } from "@matms/db/schema/custodial-inventory";
import { schedulingPeople as people, bookableResources } from "@matms/db/schema/scheduling";
import { authorize, beginMaster, saveMaster, lockCustodialSources, postCustodialOperation, CustodialError } from "./custodial-service";

const text = z.string().trim().min(1).max(1000);
const optional = z.string().trim().max(4000).default("");
const date = z.iso.date();
export const equipmentPage = z.object({ page: z.number().int().min(1).max(10000).default(1), search: z.string().trim().max(200).default("") });
export const equipmentListInput = equipmentPage.extend({ personId: z.uuid().optional(), state: z.enum(equipmentStates).optional() });
const metadata = z.object({ specifications: optional, accessories: optional, warrantyUntil: date.nullable().default(null), notes: optional });
export const equipmentRegisterInput = metadata.extend({
  balanceId: z.uuid(), permanentNumber: z.string().trim().min(1).max(240), brand: z.string().trim().min(1).max(160), model: z.string().trim().min(1).max(240),
  serialNumber: z.string().trim().min(1).max(240).nullable(), missingSerialReason: text.nullable(),
  mode: z.enum(["available", "adopt"]), issueTransactionId: z.uuid().optional(), personId: z.uuid().optional(),
  location: text, condition: text, effectiveDate: date, reference: text, reason: text, documentReference: text.optional(),
  confirmed: z.literal(true), operationId: z.uuid(),
}).strict().superRefine((v, ctx) => {
  if (v.serialNumber ? v.missingSerialReason !== null : !v.missingSerialReason) ctx.addIssue({ code: "custom", message: "Enter a serial number or explain why it is unavailable." });
  if (v.mode === "adopt" ? !v.personId || !v.issueTransactionId : !!v.personId || !!v.issueTransactionId) ctx.addIssue({ code: "custom", message: "Review the source issue and current recipient for adoption." });
});
export const equipmentActionInput = z.object({
  id: z.uuid(), expectedVersion: z.number().int().nonnegative(), operationId: z.uuid(),
  action: z.enum(["issue", "return", "reassign", "repair", "repaired", "lost", "recover", "dispose", "edit"]),
  personId: z.uuid().optional(), effectiveDate: date, reference: text, reason: text, location: text, condition: text,
  documentReference: text.optional(), physicalHandover: z.boolean().default(false), needsRepair: z.boolean().default(false), metadata: metadata.optional(),
}).strict();
type Actor = { id: string };
type Unit = typeof units.$inferSelect;
function fail(message: string): never { throw new CustodialError("CONFLICT", message); }
function like(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
function snapshot(unit: Unit): EquipmentSnapshot {
  const { permanentNumber, brand, model, serialNumber, missingSerialReason, specifications, accessories, warrantyUntil, notes, state, personId, personName, location, condition, version } = unit;
  return { permanentNumber, brand, model, serialNumber, missingSerialReason, specifications, accessories, warrantyUntil, notes, state, personId, personName, location, condition, version };
}
function derivedId(operationId: string, kind: string) {
  const b = createHash("sha256").update(`${operationId.toLowerCase()}:equipment:${kind}`).digest().subarray(0, 16);
  b[6] = (b[6]! & 15) | 80; b[8] = (b[8]! & 63) | 128;
  const h = b.toString("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
async function person(tx: AuditTransaction, id?: string) {
  if (!id) throw new CustodialError("VALIDATION", "Choose the receiving teacher or personnel.");
  const [p] = await tx.select({ id: people.id, name: people.name }).from(people).where(and(eq(people.id, id), eq(people.active, true))).for("share");
  if (!p) fail("The recipient is inactive or unavailable. Refresh the directory.");
  return p;
}
export async function listEquipmentPeople(db: Database, actor: Actor, raw: z.input<typeof equipmentPage>) {
  const input = equipmentPage.parse(raw);
  return db.transaction(async tx => {
    await authorize(tx, actor);
    const rows = await tx.select({ id: people.id, code: people.code, name: people.name, category: people.category }).from(people).where(and(eq(people.active, true), or(ilike(people.name, like(input.search)), ilike(people.code, like(input.search))))).orderBy(people.name, people.id).limit(26).offset((input.page - 1) * 25);
    return { rows: rows.slice(0,25), hasNext: rows.length > 25 };
  });
}
export async function listEquipment(db: Database, actor: Actor, raw: z.input<typeof equipmentListInput>) {
  const input = equipmentListInput.parse(raw);
  return db.transaction(async tx => {
    await authorize(tx, actor);
    const rows = await tx.select({ unit: units, itemCode: items.code, article: items.article, reportingClass: lots.reportingClass, fundCluster: lots.fundCluster }).from(units).innerJoin(lots, eq(lots.id, units.lotId)).innerJoin(items, eq(items.id, lots.itemId)).where(and(input.personId ? eq(units.personId, input.personId) : undefined, input.state ? eq(units.state, input.state) : undefined, or(...[units.permanentNumber, units.serialNumber, units.brand, units.model, units.location, units.personName, items.code, items.article].map(column => ilike(column, like(input.search)))))).orderBy(units.permanentNumber, units.id).limit(26).offset((input.page - 1) * 25);
    return { rows: rows.slice(0,25), hasNext: rows.length > 25 };
  });
}
export async function listEquipmentSources(db: Database, actor: Actor, raw: z.input<typeof equipmentPage>) {
  const input = equipmentPage.parse(raw);
  return db.transaction(async tx => {
    await authorize(tx, actor);
    const rows = await tx.select({ balance: balances, lot: lots, itemCode: items.code, article: items.article,
      latest: sql<{ id: string; type: string; quantity: number; date: string; recipient: string | null } | null>`(select jsonb_build_object('id', ct.id, 'type', co.operation_type, 'quantity', ct.delta, 'date', co.transaction_date, 'recipient', co.counterparty) from custodial_transactions ct join custodial_operations co on co.id=ct.operation_id join custodial_balances cb on cb.id=ct.balance_id where cb.lot_id=${lots.id} order by co.transaction_date desc, co.sequence desc, ct.id desc limit 1)`
    }).from(balances).innerJoin(lots, eq(lots.id, balances.lotId)).innerJoin(items, eq(items.id, lots.itemId)).leftJoin(units, eq(units.lotId, lots.id)).where(and(isNull(units.id), eq(lots.active,true), eq(items.active,true), ne(lots.reportingClass,"stock_card"), inArray(balances.quantity,[0,1]), or(ilike(items.code,like(input.search)),ilike(items.article,like(input.search)),ilike(lots.propertyNumber,like(input.search))))).orderBy(items.code,lots.id,balances.id).limit(26).offset((input.page-1)*25);
    return { rows: rows.slice(0,25), hasNext: rows.length>25 };
  });
}
export async function getEquipment(db: Database, actor: Actor, id: string, page = 1) {
  return db.transaction(async tx => {
    await authorize(tx, actor);
    const [record] = await tx.select({ unit:units, lot:lots, item:items, balance:balances }).from(units).innerJoin(lots,eq(lots.id,units.lotId)).innerJoin(items,eq(items.id,lots.itemId)).innerJoin(balances,eq(balances.id,units.balanceId)).where(eq(units.id,id));
    if (!record) throw new CustodialError("NOT_FOUND","Equipment is unavailable.");
    const history = await tx.select().from(events).where(eq(events.unitId,id)).orderBy(desc(events.version)).limit(26).offset((page-1)*25);
    const slips = await tx.selectDistinct({ id:documents.id, number:documents.number, version:versions.version, deletedAt:documents.deletedAt }).from(events).innerJoin(exports,sql`${exports.payload}->'lines' @> jsonb_build_array(jsonb_build_object('transactionId', ${events.transactionId}::text))`).innerJoin(versions,eq(versions.exportId,exports.id)).innerJoin(documents,eq(documents.id,versions.documentId)).where(eq(events.unitId,id)).orderBy(desc(documents.number),desc(versions.version)).limit(100);
    return {...record, history:history.slice(0,25), hasNext:history.length>25, slips};
  });
}
async function append(tx: AuditTransaction, actor: Actor, unit: Unit, kind: string, input: { effectiveDate:string; reference:string; reason:string; documentReference?:string }, transactionId: string | null, correlationId:string, before?:Unit) {
  const after=snapshot(unit);
  await tx.insert(events).values({unitId:unit.id,kind,transactionId,effectiveDate:input.effectiveDate,reference:input.reference,reason:input.reason,documentReference:input.documentReference??null,snapshot:after,version:unit.version,actorId:actor.id});
  await writeAuditEntry(tx,{actorId:actor.id,action:`custodial.equipment.${kind}`,targetType:"custodial_equipment",targetId:unit.id,before:before?snapshot(before):undefined,after:{...after,reference:input.reference,reason:input.reason,documentReference:input.documentReference??null},correlationId});
}
export async function registerEquipment(db: Database, actor: Actor, raw: z.input<typeof equipmentRegisterInput>, correlationId:string) {
  const input=equipmentRegisterInput.parse(raw);
  return db.transaction(async tx=>{
    await authorize(tx,actor); await lockCustodialSources(tx,true);
    const replay=await beginMaster(tx,actor,input.operationId,"equipment.register",input);
    if(replay.prior)return replay.prior.result as {id:string;version:number};
    const [balance]=await tx.select().from(balances).where(eq(balances.id,input.balanceId)).for("update");
    if(!balance?.lotId)fail("Choose a verified one-device acquisition lot.");
    const [item]=await tx.select().from(items).where(eq(items.id,balance.itemId)).for("update");
    const [lot]=await tx.select().from(lots).where(eq(lots.id,balance.lotId)).for("update");
    if(!item?.active||!lot?.active||lot.reportingClass==="stock_card")fail("Choose an active semi-expendable or PPE lot.");
    if(lot.propertyNumber!==input.permanentNumber)fail("Set the acquisition lot property number to the permanent device number first.");
    const [existing]=await tx.select({id:units.id}).from(units).where(eq(units.lotId,lot.id));
    if(existing)fail("This lot is already registered. Open the existing device.");
    const [bookable]=await tx.select({id:bookableResources.id}).from(bookableResources).where(and(eq(bookableResources.lotId,lot.id),eq(bookableResources.active,true)));
    if(bookable)fail("Retire the linked bookable resource before registering individual custody.");
    const allBalances=await tx.select().from(balances).where(eq(balances.lotId,lot.id));
    const history=await tx.select({id:transactions.id,balanceId:transactions.balanceId,delta:transactions.delta,type:operations.operationType,date:operations.transactionDate,sequence:operations.sequence}).from(transactions).innerJoin(operations,eq(operations.id,transactions.operationId)).innerJoin(balances,eq(balances.id,transactions.balanceId)).where(eq(balances.lotId,lot.id)).orderBy(desc(operations.transactionDate),desc(operations.sequence),desc(transactions.id));
    if(!history.length||history.some(row=>Math.abs(row.delta)>1)||allBalances.reduce((sum,b)=>sum+b.quantity,0)!==(input.mode==="available"?1:0))fail("Use a separate one-device lot with verified stock or a single outstanding issue. Batch lots cannot be converted.");
    if(input.effectiveDate<history[0]!.date||(lot.acquiredOn&&input.effectiveDate<lot.acquiredOn))fail("Registration cannot precede acquisition or the latest recorded stock movement.");
    let recipient:{id:string;name:string}|null=null,transactionId:string|null=null;
    if(input.mode==="available"){
      if(balance.quantity!==1)fail("The selected holding-office balance must contain exactly one device.");
    }else{
      const last=history[0]!;
      if(last.id!==input.issueTransactionId||last.balanceId!==balance.id||last.type!=="issue"||last.delta!==-1)fail("Adopt the latest outstanding single-unit issue from this holding office.");
      recipient=await person(tx,input.personId);transactionId=last.id;
    }
    const [unit]=await tx.insert(units).values({lotId:lot.id,balanceId:balance.id,permanentNumber:input.permanentNumber,normalizedNumber:input.permanentNumber.toUpperCase(),brand:input.brand,normalizedBrand:input.brand.toUpperCase(),model:input.model,serialNumber:input.serialNumber,normalizedSerial:input.serialNumber?.toUpperCase()??null,missingSerialReason:input.missingSerialReason,specifications:input.specifications,accessories:input.accessories,warrantyUntil:input.warrantyUntil,notes:input.notes,state:recipient?"issued":"available",personId:recipient?.id??null,personName:recipient?.name??null,location:input.location,condition:input.condition,effectiveDate:input.effectiveDate,createdBy:actor.id}).returning();
    await append(tx,actor,unit!,recipient?"adopt":"register",input,transactionId,correlationId);
    const result={id:unit!.id,version:unit!.version};
    await saveMaster(tx,actor,input.operationId,"equipment.register",replay.hash,unit!.id,result);
    return result;
  });
}
export async function actOnEquipment(db: Database, actor: Actor, raw:z.input<typeof equipmentActionInput>,correlationId:string){
  const input=equipmentActionInput.parse(raw);
  return db.transaction(async tx=>{
    const profile=await authorize(tx,actor);await lockCustodialSources(tx);
    if(input.action==="dispose"&&profile.role!=="admin")throw new CustodialError("FORBIDDEN","Only an Administrator may record approved disposal or relief.");
    const replay=await beginMaster(tx,actor,input.operationId,"equipment.action",input);
    const [unit]=await tx.select().from(units).where(eq(units.id,input.id)).for("update");
    if(!unit)throw new CustodialError("NOT_FOUND","Equipment is unavailable.");
    if(replay.prior)return replay.prior.result as {id:string;version:number};
    if(unit.version!==input.expectedVersion)fail("Equipment changed. Reopen it before saving.");
    if(unit.state==="disposed")fail("This device has an approved disposal record and cannot be issued.");
    if(input.effectiveDate<unit.effectiveDate)fail("The action cannot precede the latest custody record.");
    const [lot]=await tx.select().from(lots).where(eq(lots.id,unit.lotId));
    if(!lot?.active)fail("The acquisition lot is inactive.");
    if(["return","recover","reassign"].includes(input.action)&&!input.physicalHandover)throw new CustodialError("VALIDATION","Confirm actual physical receipt and handover before posting.");
    if(!["issue","reassign"].includes(input.action)&&input.personId)throw new CustodialError("VALIDATION","A new recipient is valid only for issue or reassignment.");
    if(input.action!=="edit"&&input.metadata)throw new CustodialError("VALIDATION","Use Edit details to change device notes or specifications.");
    if(input.needsRepair&&!["return","recover"].includes(input.action))throw new CustodialError("VALIDATION","Repair inspection applies only to physical return or recovery.");
    let change:Partial<Unit>={location:input.location,condition:input.condition,effectiveDate:input.effectiveDate,version:unit.version+1,updatedAt:new Date()},transactionId:string|null=null;
    async function post(type:"issue"|"return"|"adjustment",counterparty:string,suffix:string=type){
      const [balance]=await tx.select().from(balances).where(eq(balances.id,unit!.balanceId));
      if(!balance)fail("Holding balance is unavailable.");
      const operationId=derivedId(input.operationId,suffix);
      await postCustodialOperation(tx as unknown as Database,actor,{balanceId:balance.id,type,quantity:type==="adjustment"?0:1,expectedVersion:balance.version,operationId,transactionDate:input.effectiveDate,reference:input.reference,reason:input.reason,counterparty,correlationId},unit!.id);
      const [entry]=await tx.select({id:transactions.id}).from(transactions).innerJoin(operations,eq(operations.id,transactions.operationId)).where(eq(operations.operationId,operationId));
      return entry!.id;
    }
    switch(input.action){
      case "issue": case "reassign":{
        if(input.action==="issue"?unit.state!=="available"||unit.personId!==null:unit.state!=="issued"||!unit.personId)fail("Issue requires an available device; reassignment requires a device currently issued.");
        const recipient=await person(tx,input.personId);
        if(recipient.id===unit.personId)fail("Choose a different receiving person.");
        if(input.action==="reassign")await post("return",unit.personName!,"handover-return");
        transactionId=await post("issue",recipient.name);
        change={...change,state:"issued",personId:recipient.id,personName:recipient.name};break;
      }
      case "return": case "recover":{
        if(input.action==="recover"?unit.state!=="lost":!unit.personId||unit.state==="lost")fail("Choose Return for issued property or Recover for a lost device physically received.");
        transactionId=await post("return",unit.personName??"Recovered by holding office");
        change={...change,state:input.needsRepair?"under_repair":"available",personId:null,personName:null};break;
      }
      case "repair":
        if(!["available","issued"].includes(unit.state))fail("Only available or issued equipment can enter repair.");
        change.state="under_repair";break;
      case "repaired":
        if(unit.state!=="under_repair")fail("The device is not recorded under repair.");
        change.state=unit.personId?"issued":"available";break;
      case "lost":
        if(unit.state==="lost")fail("The device is already recorded as lost.");
        if(!unit.personId)await post("adjustment","Holding office");
        change.state="lost";break;
      case "dispose":
        if(!input.documentReference)throw new CustodialError("VALIDATION","An external disposal or accountability-relief approval reference is required.");
        if(!unit.personId&&unit.state!=="lost")await post("adjustment","Holding office");
        change={...change,state:"disposed",personId:null,personName:null};break;
      case "edit":
        if(!input.metadata)throw new CustodialError("VALIDATION","Device details are required.");
        change={...change,...input.metadata};break;
    }
    const [updated]=await tx.update(units).set(change).where(eq(units.id,unit.id)).returning();
    await append(tx,actor,updated!,input.action,input,transactionId,correlationId,unit);
    const result={id:unit.id,version:updated!.version};
    await saveMaster(tx,actor,input.operationId,"equipment.action",replay.hash,unit.id,result);
    return result;
  });
}
