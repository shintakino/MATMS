import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { createDb, type Database } from "@matms/db";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { custodialBalances, custodialIcsDocuments, custodialIcsVersions, custodialIcsExports, custodialItems, custodialLots, custodialTransactions, custodialOperations } from "@matms/db/schema/custodial-inventory";
import { createCustodialItem, createCustodialLot, createCustodialBalance, postCustodialOperation, previewCustodialOperation, updateCustodialItem } from "./custodial-service";
import { downloadIcs, generateIcs, getIcs, updateIcs, listIcs, listIcsIssues, previewIcs } from "./ics-service";
import { icsPayload, renderIcs } from "./ics-workbook";
import { createHash } from "node:crypto";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("ICS tests require an isolated _test database.");
const db = createDb({ DATABASE_URL: url });
afterAll(() => db.$client.end());
const rollback = new Error("Rollback fictional ICS fixtures");

test("ICS ranges continue across returns, backdated issues and lots while saved versions remain frozen",async()=>{
  try { await db.transaction(async tx=>{
    const local=tx as unknown as Database,id=crypto.randomUUID();
    await tx.insert(user).values({id,name:"Fictional batch custodian",email:`${id}@example.test`,emailVerified:true});
    await tx.insert(userProfiles).values({userId:id,role:"property_custodian",active:true,mustChangePassword:false});
    const actor={id},op=()=>({operationId:crypto.randomUUID(),correlationId:crypto.randomUUID()});
    const item=await createCustodialItem(local,actor,{code:`TXVE10-${crypto.randomUUID()}`,article:"Book",description:"Batch fixture",unit:"copy",reorderPoint:null,...op()});
    const lot=await createCustodialLot(local,actor,{itemId:item.id,reportingClass:"semi_expendable",propertyNumber:null,unitValue:"250.00",fundCluster:"TEST",office:"Library",...op()});
    const balance=await createCustodialBalance(local,actor,{itemId:item.id,lotId:lot.id,fundCluster:"TEST",office:"Library",...op()});
    const posting={balanceId:balance.id,transactionDate:"2026-01-01",reference:"Batch fixture",reason:"Test batch",counterparty:"Teacher A"};
    await postCustodialOperation(local,actor,{...posting,type:"opening",quantity:100,...op()});
    const first=await postCustodialOperation(local,actor,{...posting,transactionDate:"2026-01-03",type:"issue",quantity:90,...op()});
    async function transactionId(operationId:string){return (await tx.select({id:custodialTransactions.id}).from(custodialTransactions).innerJoin(custodialOperations,eq(custodialTransactions.operationId,custodialOperations.id)).where(eq(custodialOperations.operationId,operationId)))[0]!.id;}
    const firstId=await transactionId(first.operationId);
    const details={entity:"Fictional School",fromName:"Custodian",fromOffice:"Library",toName:"Teacher A",toOffice:"Classroom",fromDate:"2026-01-03",toDate:"2026-01-03",lines:[{transactionId:firstId,usefulLife:"5 years"}]};
    const preview=await previewIcs(local,id,details,crypto.randomUUID());
    expect(preview.payload.lines[0]!.itemNumber).toBe(`${item.code}-001-090`);
    const saved=await generateIcs(local,id,{details,expectedDataHash:preview.dataHash,...op()},crypto.randomUUID());
    await postCustodialOperation(local,actor,{...posting,transactionDate:"2026-01-04",type:"return",quantity:5,...op()});
    const late={...posting,transactionDate:"2026-01-02",type:"issue" as const,quantity:1,...op()};
    const lateReview=await previewCustodialOperation(local,actor,late);
    const next=await postCustodialOperation(local,actor,{...late,confirmBackdated:true,backdatedPreviewHash:lateReview.previewHash});
    const nextId=await transactionId(next.operationId);
    const nextPreview=await previewIcs(local,id,{...details,lines:[{transactionId:nextId,usefulLife:"5 years"}]},crypto.randomUUID());
    expect(nextPreview.payload.lines[0]!.itemNumber).toBe(`${item.code}-091`);
    expect((await previewIcs(local,id,details,crypto.randomUUID())).payload.lines[0]!.itemNumber).toBe(`${item.code}-001-090`);
    const secondLot=await createCustodialLot(local,actor,{itemId:item.id,reportingClass:"semi_expendable",unitValue:"250.00",fundCluster:"OTHER",office:"Store",...op()});
    const secondBalance=await createCustodialBalance(local,actor,{itemId:item.id,lotId:secondLot.id,fundCluster:"OTHER",office:"Store",...op()});
    await postCustodialOperation(local,actor,{...posting,balanceId:secondBalance.id,type:"opening",quantity:10,...op()});
    const second=await postCustodialOperation(local,actor,{...posting,balanceId:secondBalance.id,transactionDate:"2026-01-05",type:"issue",quantity:2,...op()});
    const secondId=await transactionId(second.operationId);
    expect((await previewIcs(local,id,{...details,lines:[{transactionId:secondId,usefulLife:"5 years"}]},crypto.randomUUID())).payload.lines[0]!.itemNumber).toBe(`${item.code}-092-093`);
    const ledger=await tx.select().from(custodialTransactions);
    await updateCustodialItem(local,actor,{itemId:item.id,expectedVersion:0,code:`RENAMED-${crypto.randomUUID()}`,article:item.article,description:item.description,unit:item.unit,reorderPoint:null,defaultSectionId:null,notes:null,active:true,reason:"Correct code",...op()});
    const editPreview=await previewIcs(local,id,details,crypto.randomUUID(),{id:saved.id,expectedVersion:1});
    expect(editPreview.payload.lines[0]!.itemNumber).toBe(`${item.code}-001-090`);
    await updateIcs(local,id,{id:saved.id,expectedVersion:1,details,reason:"Keep frozen identity",expectedDataHash:editPreview.dataHash,...op()},crypto.randomUUID());
    const oldNumber=`OLD-${crypto.randomUUID()}`;
    const old=icsPayload.parse({...preview.payload,version:"ics-v4",details:{...preview.payload.details,number:oldNumber},lines:preview.payload.lines.map(line=>({...line,itemNumber:"OLD-PROPERTY-001"}))});
    const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,canonical(value)])):v;
    const bytes=await renderIcs(old),oldId=crypto.randomUUID();
    await tx.insert(custodialIcsExports).values({id:oldId,operationId:crypto.randomUUID(),intentHash:"a".repeat(64),number:oldNumber,payload:old,dataHash:createHash("sha256").update(JSON.stringify(canonical(old))).digest("hex"),checksum:createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),createdBy:id});
    await tx.insert(custodialIcsDocuments).values({id:oldId,number:oldNumber,currentExportId:oldId,createdBy:id});
    await tx.insert(custodialIcsVersions).values({documentId:oldId,exportId:oldId,version:1,reason:"Historical fixture"});
    await tx.update(custodialLots).set({unitValue:"999.00"}).where(eq(custodialLots.id,lot.id));
    const upgrade=await previewIcs(local,id,details,crypto.randomUUID(),{id:oldId,expectedVersion:1});
    expect(upgrade.payload.version).toBe("ics-v5");expect(upgrade.payload.lines[0]!.unitCost).toBe("250.00");
    expect(upgrade.payload.lines[0]!.itemNumber).toEndWith("-001-090");
    await updateIcs(local,id,{id:oldId,expectedVersion:1,details,reason:"Adopt printed range",expectedDataHash:upgrade.dataHash,...op()},crypto.randomUUID());
    expect((await getIcs(local,id,oldId)).payload.version).toBe("ics-v5");
    const historic=await downloadIcs(local,id,oldId,crypto.randomUUID(),1),oldBook=new ExcelJS.Workbook();
    await oldBook.xlsx.load(Buffer.from(historic.base64,"base64") as unknown as ExcelJS.Buffer);
    expect(oldBook.worksheets[0]!.getCell("G12").value).toBe("OLD-PROPERTY-001");
    expect(await tx.select().from(custodialTransactions)).toEqual(ledger);
    throw rollback;
  }); } catch(error) { if(error!==rollback)throw error; }
},30000);

test("ICS migration, authorized generation, retries, audit rollback and immutable downloads", async () => {
  try {
    await db.transaction(async tx => {
      const local = tx as unknown as Database;
      const ids: Record<string,string> = {};
      for (const role of ["admin", "property_custodian", "staff", "viewer"] as const) {
        const id = crypto.randomUUID(); ids[role] = id;
        await tx.insert(user).values({ id, name: `Fictional ${role}`, email: `${id}@example.test`, emailVerified: true });
        await tx.insert(userProfiles).values({ userId: id, role, active: true, mustChangePassword: false });
      }
      const actor = { id: ids.admin! };
      const operation = () => ({ operationId: crypto.randomUUID(), correlationId: crypto.randomUUID() });
      const item = await createCustodialItem(local,actor,{code:crypto.randomUUID(),article:"Fictional fan",description:"HFAN-20HYP",unit:"unit",reorderPoint:null,...operation()});
      const lot = await createCustodialLot(local,actor,{itemId:item.id,reportingClass:"semi_expendable",propertyNumber:crypto.randomUUID(),unitValue:"1234.56",fundCluster:"ICS-TEST",office:"Stores",...operation()});
      const balance = await createCustodialBalance(local,actor,{itemId:item.id,lotId:lot.id,fundCluster:"ICS-TEST",office:"Stores",...operation()});
      await postCustodialOperation(local,actor,{balanceId:balance.id,type:"opening",quantity:10,transactionDate:"2026-01-01",reference:"Fictional opening",reason:"Test",...operation()});
      await postCustodialOperation(local,actor,{balanceId:balance.id,type:"issue",quantity:3,transactionDate:"2026-01-02",reference:"Fictional issue",reason:"Test",counterparty:"Test Office",...operation()});
      const issues = await listIcsIssues(local,ids.property_custodian!,1);
      const issue = issues.rows.find(row => row.code === item.code)!;
      expect(issue.quantity).toBe(3);
      const details = {entity:"Fictional School",fromName:"Issuer",fromOffice:"Stores",toName:"Recipient",toOffice:"Test Office",fromDate:"2026-01-02",toDate:"2026-01-02",lines:[{transactionId:issue.transactionId,usefulLife:"5 years"}]};
      const preview = await previewIcs(local,ids.property_custodian!,details,crypto.randomUUID());
      expect(preview.payload.lines[0]!.totalCost).toBe("3703.68");
      const input = {details,expectedDataHash:preview.dataHash,operationId:crypto.randomUUID()};
      const beforeLedger = await tx.select().from(custodialTransactions);
      const beforeBalance = await tx.select().from(custodialBalances).where(eq(custodialBalances.id,balance.id));
      // Null correlation must fail the audit INSERT and roll the saved slip back too.
      await expect(generateIcs(local,ids.property_custodian!,input,null as unknown as string)).rejects.toThrow();
      expect(await tx.select().from(custodialIcsExports)).toHaveLength(0);
      const saved = await generateIcs(local,ids.property_custodian!,input,crypto.randomUUID());
      expect(await generateIcs(local,ids.property_custodian!,input,crypto.randomUUID())).toEqual(saved);
      await expect(generateIcs(local,ids.property_custodian!,{...input,details:{...details,entity:"Changed"}},crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
      expect((await listIcs(local,ids.admin!,1)).rows[0]!.id).toBe(saved.id);
      expect(await tx.select().from(custodialTransactions)).toEqual(beforeLedger);
      expect(await tx.select().from(custodialBalances).where(eq(custodialBalances.id,balance.id))).toEqual(beforeBalance);
      await expect(previewIcs(local,ids.admin!,{...details,lines:[...details.lines,...details.lines]},crypto.randomUUID())).rejects.toMatchObject({code:"VALIDATION_ERROR"});
      await expect(previewIcs(local,ids.admin!,{...details,lines:[{transactionId:crypto.randomUUID(),usefulLife:"Test"}]},crypto.randomUUID())).rejects.toMatchObject({code:"VALIDATION_ERROR"});
      for (const role of ["staff","viewer"]) {
        await expect(listIcsIssues(local,ids[role]!,1)).rejects.toMatchObject({code:"FORBIDDEN"});
        await expect(listIcs(local,ids[role]!,1)).rejects.toMatchObject({code:"FORBIDDEN"});
        await expect(previewIcs(local,ids[role]!,details,crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
        await expect(generateIcs(local,ids[role]!,input,crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
        await expect(downloadIcs(local,ids[role]!,saved.id,crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
      }
      await tx.update(userProfiles).set({active:false}).where(eq(userProfiles.userId,ids.property_custodian!));
      await expect(generateIcs(local,ids.property_custodian!,input,crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
      await expect(downloadIcs(local,ids.property_custodian!,saved.id,crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
      await tx.update(custodialItems).set({description:"Later edit"}).where(eq(custodialItems.id,item.id));
      await tx.update(custodialLots).set({unitValue:"999.00"}).where(eq(custodialLots.id,lot.id));
      const file = await downloadIcs(local,ids.admin!,saved.id,crypto.randomUUID());
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(file.base64,"base64") as unknown as ExcelJS.Buffer);
      expect(workbook.worksheets[0]!.getCell("E12").value).toBe("Fictional fan\nHFAN-20HYP");
      expect(workbook.worksheets[0]!.getCell("D12").value).toBe(3703.68);
      await expect(generateIcs(local,ids.admin!,{...input,operationId:crypto.randomUUID(),details:{...details,entity:"New slip"}},crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
      await expect(tx.transaction(async nested => {await nested.execute(sql`UPDATE custodial_ics_exports SET number = 'changed' WHERE id = ${saved.id}`);})).rejects.toMatchObject({cause:{message:"ICS snapshots are immutable"}});
      await expect(tx.transaction(async nested => {await nested.execute(sql`DELETE FROM custodial_ics_exports WHERE id = ${saved.id}`);})).rejects.toMatchObject({cause:{message:"ICS snapshots are immutable"}});
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
},30000);
