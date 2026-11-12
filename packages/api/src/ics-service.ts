import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import type { Database, AuditTransaction } from "@matms/db";
import { writeAuditEntry } from "@matms/db";
import { userProfiles } from "@matms/db/schema/identity";
import { custodialIcsExports as exports, custodialIcsDocuments as documents, custodialIcsVersions as versions, custodialIcsCounters as counters, custodialMasterReplays as replays, custodialTransactions as transactions, custodialOperations as operations, custodialBalances as balances, custodialItems as items, custodialLots as lots } from "@matms/db/schema/custodial-inventory";
import { MatmsError } from "./errors";
import { icsDraftDetails, icsCost, icsPayload, renderIcs, type IcsPayload, type IcsDraftDetails } from "./ics-workbook";
import template from "./ics-template-v2";

let activeRenders = 0;
async function renderLimited(payload: unknown) {
  if (activeRenders >= 2) throw new MatmsError("RATE_LIMITED", "ICS generation is busy. Try again shortly.");
  activeRenders++;
  try {
    const bytes = await renderIcs(payload);
    if (bytes.length > 16 * 1024 * 1024) throw new MatmsError("VALIDATION_ERROR", "The generated slip is too large. Select fewer issues.");
    return bytes;
  } finally { activeRenders--; }
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])) : value;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const checksum = (bytes:Buffer) => createHash("sha256").update(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength)).digest("hex");
async function authorize(tx: AuditTransaction, actorId: string) {
  const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, actorId)).for("share");
  if (!profile?.active || profile.mustChangePassword || !["admin", "property_custodian"].includes(profile.role)) throw new MatmsError("FORBIDDEN", "This action is unavailable.");
}
function issueQuery(tx: AuditTransaction) {
  return tx.select({ transactionId: transactions.id, quantity: transactions.delta, date: operations.transactionDate, reference: operations.reference, recipient: operations.counterparty, fundCluster: balances.fundCluster, office: balances.office, code: items.code, article: items.article, description: items.description, unit: items.unit, propertyNumber: lots.propertyNumber, unitCost: lots.unitValue })
    .from(transactions).innerJoin(operations, eq(transactions.operationId, operations.id)).innerJoin(balances, eq(transactions.balanceId, balances.id)).innerJoin(items, eq(balances.itemId, items.id)).innerJoin(lots, eq(balances.lotId, lots.id));
}
const eligible = and(eq(operations.operationType, "issue"), eq(lots.reportingClass, "semi_expendable"));
export async function listIcsIssues(db: Database, actorId: string, page: number) {
  return db.transaction(async tx => {
    await authorize(tx, actorId);
    const rows = await issueQuery(tx).where(eligible).orderBy(desc(operations.sequence), transactions.id).limit(26).offset((page-1)*25);
    return { rows: rows.slice(0,25).map(row => ({...row, quantity: -row.quantity})), hasNext: rows.length > 25 };
  });
}
function currentPeriod(now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit"}).formatToParts(now);
  return `${parts.find(part=>part.type==="year")!.value}-${parts.find(part=>part.type==="month")!.value}`;
}
async function nextSequence(tx:AuditTransaction,period:string) {
  const [counter]=await tx.select().from(counters).where(eq(counters.period,period));
  const [existing]=await tx.select({highest:sql<number>`coalesce(max(split_part(regexp_replace(upper(${documents.number}), '^ICS-', ''), '-', 3)::integer), 0)`}).from(documents).where(sql`upper(${documents.number}) ~ ${`^(ICS-)?${period}-[0-9]{1,9}$`}`);
  const next=Math.max(counter?.lastValue??0,Number(existing?.highest??0))+1;
  if(next>2147483647)throw new MatmsError("CONFLICT","The monthly ICS numbering range is exhausted.");
  return next;
}
export async function suggestIcsNumber(db:Database,actorId:string) {
  return db.transaction(async tx=>{await authorize(tx,actorId);const period=currentPeriod();return {period,number:`${period}-${String(await nextSequence(tx,period)).padStart(3,"0")}`};});
}
async function allocateNumber(tx:AuditTransaction) {
  const period=currentPeriod();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ics-number:${period}`}, 59))`);
  const next=await nextSequence(tx,period);
  await tx.insert(counters).values({period,lastValue:next}).onConflictDoUpdate({target:counters.period,set:{lastValue:next}});
  return `${period}-${String(next).padStart(3,"0")}`;
}
async function document(tx:AuditTransaction,id:string,lock=false) {
  const query=tx.select().from(documents).where(eq(documents.id,id));
  const [entry]=await(lock?query.for("update"):query.for("share"));
  if(!entry)throw new MatmsError("NOT_FOUND","Slip is unavailable.");
  return entry;
}
async function exportPayload(tx:AuditTransaction,id:string) {
  const [entry]=await tx.select().from(exports).where(eq(exports.id,id));
  if(!entry||hash(entry.payload)!==entry.dataHash)throw new MatmsError("CONFLICT","Slip snapshot failed verification.");
  return {entry,payload:icsPayload.parse(entry.payload)};
}
function requireCurrent(doc:typeof documents.$inferSelect,expectedVersion:number) {
  if(doc.deletedAt)throw new MatmsError("NOT_FOUND","Slip is deleted. Restore it from Deleted slips first.");
  if(doc.version!==expectedVersion)throw new MatmsError("CONFLICT","This slip changed. Reopen it before saving.");
}
async function snapshot(tx:AuditTransaction,raw:IcsDraftDetails,number:string,base?:IcsPayload) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('custodial-count-source', 3))`);
  const details=icsDraftDetails.parse(raw);
  if(new Set(details.lines.map(line=>line.transactionId)).size!==details.lines.length)throw new MatmsError("VALIDATION_ERROR","Choose each issue only once.");
  const rows=await issueQuery(tx).where(and(eligible,inArray(transactions.id,details.lines.map(line=>line.transactionId))));
  if(rows.length!==details.lines.length)throw new MatmsError("VALIDATION_ERROR","A selected issue is unavailable.");
  const fundCluster=rows[0]!.fundCluster,recipient=rows[0]!.recipient;
  if(rows.some(row=>row.fundCluster!==fundCluster||row.recipient!==recipient))throw new MatmsError("VALIDATION_ERROR","Choose issues for the same fund and receiving office or recipient.");
  const lines=details.lines.map(selection=>{
    const frozen=base?.lines.find(line=>line.transactionId===selection.transactionId);
    if(frozen)return {...frozen,usefulLife:selection.usefulLife,description:selection.description??frozen.description};
    const row=rows.find(row=>row.transactionId===selection.transactionId)!;
    if(row.unitCost===null||!row.propertyNumber||row.quantity>=0)throw new MatmsError("VALIDATION_ERROR",`Complete the acquisition lot value and inventory item number for ${row.code}.`);
    let totalCost:string;
    try {totalCost=icsCost(row.unitCost,-row.quantity);} catch {throw new MatmsError("VALIDATION_ERROR","An issued value exceeds supported Excel precision.");}
    return {transactionId:row.transactionId,quantity:-row.quantity,unit:row.unit,description:selection.description??`${row.article}\n${row.description}`,itemNumber:row.propertyNumber,unitCost:row.unitCost,totalCost,usefulLife:selection.usefulLife};
  });
  return icsPayload.parse({version:"ics-v3",sourceHash:template.sourceHash,details:{...details,number},fundCluster,lines});
}
export type IcsEditScope={id:string;expectedVersion:number};
export async function previewIcs(db:Database,actorId:string,details:IcsDraftDetails,correlationId:string,edit?:IcsEditScope) {
  return db.transaction(async tx=>{
    await authorize(tx,actorId);
    const doc=edit?await document(tx,edit.id,true):undefined;
    if(doc)requireCurrent(doc,edit!.expectedVersion);
    const base=doc?(await exportPayload(tx,doc.currentExportId)).payload:undefined;
    const payload=await snapshot(tx,details,doc?.number??"Assigned on save",base);
    await writeAuditEntry(tx,{actorId,action:"custodial.ics.preview",targetType:"custodial_ics",targetId:doc?.id??payload.lines[0]!.transactionId,after:{rowCount:payload.lines.length},correlationId});
    return {payload,dataHash:hash(payload)};
  });
}
async function operation(tx:AuditTransaction,actorId:string,operationId:string,kind:string,input:unknown) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationId}, 0))`);
  const intentHash=hash({actorId,kind,input});
  const [prior]=await tx.select().from(replays).where(eq(replays.operationId,operationId));
  const [exported]=await tx.select().from(exports).where(eq(exports.operationId,operationId));
  if((prior&&(prior.actorId!==actorId||prior.kind!==kind||prior.fingerprint!==intentHash))||(exported&&!prior))throw new MatmsError("CONFLICT","Operation was used for another action.");
  return {intentHash,prior};
}
async function persist(tx:AuditTransaction,actorId:string,operationId:string,intentHash:string,payload:IcsPayload) {
  const bytes=await renderLimited(payload);
  const [entry]=await tx.insert(exports).values({operationId,intentHash,number:payload.details.number,payload,dataHash:hash(payload),checksum:checksum(bytes),createdBy:actorId}).returning();
  return entry!;
}
export async function generateIcs(db:Database,actorId:string,input:{details:IcsDraftDetails;operationId:string;expectedDataHash:string},correlationId:string) {
  return db.transaction(async tx=>{
    await authorize(tx,actorId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`);
    const intentHash=hash({actorId,...input});
    const [prior]=await tx.select().from(exports).where(eq(exports.operationId,input.operationId));
    if(prior){
      const legacyIntent=hash({actorId,...input,details:{...input.details,number:prior.number}});
      if(prior.intentHash!==intentHash&&!(icsPayload.parse(prior.payload).version==="ics-v1"&&prior.intentHash===legacyIntent))throw new MatmsError("CONFLICT","Operation was used for another slip.");
      const [link]=await tx.select().from(versions).where(eq(versions.exportId,prior.id));
      if(!link)throw new MatmsError("CONFLICT","Slip history is unavailable.");
      const doc=await document(tx,link.documentId);
      if(doc.deletedAt)throw new MatmsError("NOT_FOUND","Slip is deleted. Restore it from Deleted slips.");
      return {id:doc.id,number:doc.number,version:1};
    }
    const [used]=await tx.select().from(replays).where(eq(replays.operationId,input.operationId));
    if(used)throw new MatmsError("CONFLICT","Operation was used for another action.");
    const draft=await snapshot(tx,input.details,"Assigned on save");
    if(hash(draft)!==input.expectedDataHash)throw new MatmsError("CONFLICT","Inventory details changed. Preview the slip again.");
    const number=await allocateNumber(tx);
    const payload=icsPayload.parse({...draft,details:{...draft.details,number}});
    const entry=await persist(tx,actorId,input.operationId,intentHash,payload);
    const [doc]=await tx.insert(documents).values({id:entry.id,number,currentExportId:entry.id,createdBy:actorId}).returning();
    await tx.insert(versions).values({documentId:doc!.id,exportId:entry.id,version:1,reason:"Initial generation"});
    await writeAuditEntry(tx,{actorId,action:"custodial.ics.generate",targetType:"custodial_ics",targetId:doc!.id,after:{number,dataHash:entry.dataHash,checksum:entry.checksum,rowCount:payload.lines.length},correlationId});
    return {id:doc!.id,number,version:1};
  });
}
export async function updateIcs(db:Database,actorId:string,input:IcsEditScope&{details:IcsDraftDetails;operationId:string;expectedDataHash:string;reason:string},correlationId:string) {
  return db.transaction(async tx=>{
    await authorize(tx,actorId);
    const replay=await operation(tx,actorId,input.operationId,"ics.update",input);
    if(replay.prior)return replay.prior.result as {id:string;number:string;version:number};
    const doc=await document(tx,input.id,true);requireCurrent(doc,input.expectedVersion);
    const base=(await exportPayload(tx,doc.currentExportId)).payload;
    const payload=await snapshot(tx,input.details,doc.number,base);
    if(hash(payload)!==input.expectedDataHash)throw new MatmsError("CONFLICT","Slip details changed. Review it again.");
    const entry=await persist(tx,actorId,input.operationId,replay.intentHash,payload);
    const version=doc.version+1;
    await tx.update(documents).set({currentExportId:entry.id,version,updatedAt:new Date()}).where(eq(documents.id,doc.id));
    await tx.insert(versions).values({documentId:doc.id,exportId:entry.id,version,reason:input.reason});
    const result={id:doc.id,number:doc.number,version};
    await writeAuditEntry(tx,{actorId,action:"custodial.ics.update",targetType:"custodial_ics",targetId:doc.id,before:{version:doc.version,exportId:doc.currentExportId},after:{version,exportId:entry.id,reason:input.reason,dataHash:entry.dataHash},correlationId});
    await tx.insert(replays).values({operationId:input.operationId,actorId,kind:"ics.update",fingerprint:replay.intentHash,targetId:doc.id,result});
    return result;
  });
}
export async function setIcsDeleted(db:Database,actorId:string,input:IcsEditScope&{deleted:boolean;operationId:string;reason:string},correlationId:string) {
  return db.transaction(async tx=>{
    await authorize(tx,actorId);
    const kind=input.deleted?"ics.delete":"ics.restore";
    const replay=await operation(tx,actorId,input.operationId,kind,input);
    if(replay.prior)return replay.prior.result as {id:string;version:number};
    const doc=await document(tx,input.id,true);
    if(doc.version!==input.expectedVersion||Boolean(doc.deletedAt)===input.deleted)throw new MatmsError("CONFLICT","This slip changed. Refresh saved slips before continuing.");
    const version=doc.version+1;
    await tx.update(documents).set({deletedAt:input.deleted?new Date():null,deletedBy:input.deleted?actorId:null,version,updatedAt:new Date()}).where(eq(documents.id,doc.id));
    const result={id:doc.id,version};
    await writeAuditEntry(tx,{actorId,action:`custodial.${kind}`,targetType:"custodial_ics",targetId:doc.id,before:{version:doc.version,deleted:Boolean(doc.deletedAt)},after:{version,deleted:input.deleted,reason:input.reason},correlationId});
    await tx.insert(replays).values({operationId:input.operationId,actorId,kind,fingerprint:replay.intentHash,targetId:doc.id,result});
    return result;
  });
}
export async function listIcs(db:Database,actorId:string,page:number,deleted=false) {
  return db.transaction(async tx=>{
    await authorize(tx,actorId);
    const rows=await tx.select({doc:documents,contentVersion:versions.version}).from(documents).innerJoin(versions,eq(documents.currentExportId,versions.exportId)).where(deleted?isNotNull(documents.deletedAt):isNull(documents.deletedAt)).orderBy(desc(documents.updatedAt),documents.id).limit(26).offset((page-1)*25);
    return {rows:rows.slice(0,25).map(({doc,contentVersion})=>({id:doc.id,number:doc.number,version:doc.version,contentVersion,createdAt:doc.createdAt,updatedAt:doc.updatedAt,deleted:Boolean(doc.deletedAt)})),hasNext:rows.length>25};
  });
}
export async function getIcs(db:Database,actorId:string,id:string) {
  return db.transaction(async tx=>{
    await authorize(tx,actorId);const doc=await document(tx,id);
    if(doc.deletedAt)throw new MatmsError("NOT_FOUND","Slip is deleted. Restore it first.");
    const {payload}=await exportPayload(tx,doc.currentExportId);
    const history=await tx.select({version:versions.version,reason:versions.reason,createdAt:versions.createdAt}).from(versions).where(eq(versions.documentId,id)).orderBy(desc(versions.version)).limit(100);
    return {id:doc.id,number:doc.number,version:doc.version,payload,history};
  });
}
export async function downloadIcs(db:Database,actorId:string,id:string,correlationId:string,version?:number) {
  return db.transaction(async tx=>{
    await authorize(tx,actorId);const doc=await document(tx,id);
    if(doc.deletedAt)throw new MatmsError("NOT_FOUND","Slip is deleted. Restore it first.");
    const [link]=version===undefined?[]:await tx.select().from(versions).where(and(eq(versions.documentId,id),eq(versions.version,version)));
    if(version!==undefined&&!link)throw new MatmsError("NOT_FOUND","Slip version is unavailable.");
    const {entry}=await exportPayload(tx,link?.exportId??doc.currentExportId);
    const bytes=await renderLimited(entry.payload);
    await writeAuditEntry(tx,{actorId,action:"custodial.ics.download",targetType:"custodial_ics",targetId:id,after:{dataHash:entry.dataHash,checksum:checksum(bytes),exportId:entry.id},correlationId});
    return {filename:`ICS-${doc.number.replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,80)}${version===undefined?"":`-v${version}`}.xlsx`,base64:bytes.toString("base64")};
  });
}
