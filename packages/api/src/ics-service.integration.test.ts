import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { createDb, type Database } from "@matms/db";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { custodialBalances, custodialIcsExports, custodialItems, custodialLots, custodialTransactions } from "@matms/db/schema/custodial-inventory";
import { createCustodialItem, createCustodialLot, createCustodialBalance, postCustodialOperation } from "./custodial-service";
import { downloadIcs, generateIcs, listIcs, listIcsIssues, previewIcs } from "./ics-service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("ICS tests require an isolated _test database.");
const db = createDb({ DATABASE_URL: url });
afterAll(() => db.$client.end());
const rollback = new Error("Rollback fictional ICS fixtures");

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
      const details = {number:crypto.randomUUID(),entity:"Fictional School",fromName:"Issuer",fromOffice:"Stores",toName:"Recipient",toOffice:"Test Office",fromDate:"2026-01-02",toDate:"2026-01-02",lines:[{transactionId:issue.transactionId,usefulLife:"5 years"}]};
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
      await expect(generateIcs(local,ids.property_custodian!,{...input,operationId:crypto.randomUUID()},crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
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
      await expect(generateIcs(local,ids.admin!,{...input,operationId:crypto.randomUUID(),details:{...details,number:crypto.randomUUID()}},crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
      await expect(tx.transaction(async nested => {await nested.execute(sql`UPDATE custodial_ics_exports SET number = 'changed' WHERE id = ${saved.id}`);})).rejects.toMatchObject({cause:{message:"ICS snapshots are immutable"}});
      await expect(tx.transaction(async nested => {await nested.execute(sql`DELETE FROM custodial_ics_exports WHERE id = ${saved.id}`);})).rejects.toMatchObject({cause:{message:"ICS snapshots are immutable"}});
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
},30000);
