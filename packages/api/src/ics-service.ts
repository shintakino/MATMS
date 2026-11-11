import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, AuditTransaction } from "@matms/db";
import { writeAuditEntry } from "@matms/db";
import { userProfiles } from "@matms/db/schema/identity";
import { custodialIcsExports, custodialTransactions as transactions, custodialOperations as operations, custodialBalances as balances, custodialItems as items, custodialLots as lots } from "@matms/db/schema/custodial-inventory";
import { MatmsError } from "./errors";
import { icsDetails, icsCost, icsPayload, renderIcs } from "./ics-workbook";
import type { z } from "zod";

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
  return db.transaction(async (tx) => {
    await authorize(tx, actorId);
    const rows = await issueQuery(tx).where(eligible).orderBy(desc(operations.sequence), transactions.id).limit(26).offset((page-1)*25);
    return { rows: rows.slice(0,25).map(row => ({...row, quantity: -row.quantity})), hasNext: rows.length > 25 };
  });
}
async function snapshot(tx: AuditTransaction, raw: z.infer<typeof icsDetails>) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('custodial-count-source', 3))`);
  const details = icsDetails.parse(raw);
  if (new Set(details.lines.map(line=>line.transactionId)).size !== details.lines.length) throw new MatmsError("VALIDATION_ERROR", "Choose each issue only once.");
  const rows = await issueQuery(tx).where(and(eligible, inArray(transactions.id, details.lines.map(line=>line.transactionId))));
  if (rows.length !== details.lines.length) throw new MatmsError("VALIDATION_ERROR", "A selected issue is unavailable.");
  const fundCluster = rows[0]!.fundCluster;
  const recipient = rows[0]!.recipient;
  if (rows.some(row=>row.fundCluster !== fundCluster || row.recipient !== recipient)) throw new MatmsError("VALIDATION_ERROR", "Choose issues for the same fund and receiving office or recipient.");
  const lines = details.lines.map(selection=>{
    const row = rows.find(row=>row.transactionId === selection.transactionId)!;
    if (row.unitCost === null || !row.propertyNumber || row.quantity >= 0) throw new MatmsError("VALIDATION_ERROR", "Each issue needs a lot value and inventory item number. Complete acquisition details first.");
    let totalCost: string;
    try { totalCost = icsCost(row.unitCost, -row.quantity); } catch { throw new MatmsError("VALIDATION_ERROR", "An issued value exceeds supported Excel precision."); }
    return { transactionId: row.transactionId, quantity: -row.quantity, unit: row.unit, description: `${row.article}\n${row.description}`, itemNumber: row.propertyNumber, unitCost: row.unitCost, totalCost, usefulLife: selection.usefulLife };
  });
  // The source hash and renderer version are fixed independently of live inventory.
  const { default: template } = await import("./ics-template");
  return icsPayload.parse({ version: "ics-v1", sourceHash: template.sourceHash, details, fundCluster, lines });
}
export async function previewIcs(db: Database, actorId: string, details: z.infer<typeof icsDetails>, correlationId: string) {
  return db.transaction(async(tx)=>{
    await authorize(tx, actorId);
    const payload = await snapshot(tx, details);
    await writeAuditEntry(tx,{actorId, action:"custodial.ics.preview", targetType:"custodial_ics", targetId:payload.lines[0]!.transactionId, after:{rowCount:payload.lines.length}, correlationId});
    return {payload, dataHash:hash(payload)};
  });
}
export async function generateIcs(db: Database, actorId: string, input: { details: z.infer<typeof icsDetails>; operationId: string; expectedDataHash: string }, correlationId: string) {
  return db.transaction(async(tx)=>{
    await authorize(tx,actorId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`);
    const intentHash=hash({actorId, ...input});
    const [prior]=await tx.select().from(custodialIcsExports).where(eq(custodialIcsExports.operationId,input.operationId));
    if(prior){if(prior.intentHash!==intentHash)throw new MatmsError("CONFLICT","Operation was used for another slip.");return {id:prior.id,number:prior.number};}
    const payload=await snapshot(tx,input.details),dataHash=hash(payload);
    if(dataHash!==input.expectedDataHash)throw new MatmsError("CONFLICT","Inventory details changed. Preview the slip again.");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${payload.details.number}, 59))`);
    const [duplicate]=await tx.select({id:custodialIcsExports.id}).from(custodialIcsExports).where(eq(custodialIcsExports.number,payload.details.number));
    if(duplicate)throw new MatmsError("CONFLICT","This ICS number already exists. Choose a unique number.");
    const bytes=await renderLimited(payload),checksum=createHash("sha256").update(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength)).digest("hex");
    const [entry]=await tx.insert(custodialIcsExports).values({operationId:input.operationId,intentHash,number:payload.details.number,payload,dataHash,checksum,createdBy:actorId}).returning({id:custodialIcsExports.id,number:custodialIcsExports.number});
    await writeAuditEntry(tx,{actorId,action:"custodial.ics.generate",targetType:"custodial_ics",targetId:entry!.id,after:{dataHash,checksum,rowCount:payload.lines.length},correlationId});
    return entry!;
  });
}
export async function listIcs(db: Database,actorId: string,page: number){return db.transaction(async tx=>{await authorize(tx,actorId);const rows=await tx.select({id:custodialIcsExports.id,number:custodialIcsExports.number,createdAt:custodialIcsExports.createdAt}).from(custodialIcsExports).orderBy(desc(custodialIcsExports.createdAt),custodialIcsExports.id).limit(26).offset((page-1)*25);return {rows:rows.slice(0,25),hasNext:rows.length>25};});}
export async function downloadIcs(db: Database,actorId:string,id:string,correlationId:string){return db.transaction(async tx=>{
  await authorize(tx,actorId);
  const [entry]=await tx.select().from(custodialIcsExports).where(eq(custodialIcsExports.id,id));
  if(!entry)throw new MatmsError("NOT_FOUND","Slip is unavailable.");
  if(hash(entry.payload)!==entry.dataHash)throw new MatmsError("CONFLICT","Slip snapshot failed verification.");
  const bytes=await renderLimited(entry.payload);
  await writeAuditEntry(tx,{actorId,action:"custodial.ics.download",targetType:"custodial_ics",targetId:id,after:{dataHash:entry.dataHash,checksum:createHash("sha256").update(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength)).digest("hex")},correlationId});
  return {filename:`ICS-${entry.number.replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,80)}.xlsx`,base64:bytes.toString("base64")};
});}
