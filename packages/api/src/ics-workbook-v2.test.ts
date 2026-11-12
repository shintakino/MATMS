import { expect, test } from "bun:test";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { renderIcs, type IcsPayload } from "./ics-workbook";
import { wrapIcsText } from "./ics-workbook-v2";
import template from "./ics-template-v2";
const reference=fileURLToPath(new URL("../../../ICS-2025-11-001.xlsx",import.meta.url).href);
function fixture(count:number,description="Fictional fan HFAN-20HYP"):IcsPayload {
  const lines=Array.from({length:count},(_,i)=>({transactionId:crypto.randomUUID(),quantity:1,unit:"unit",description:`${description} ${i+1}`,itemNumber:`TEST-${i+1}`,unitCost:"1500.00",totalCost:"1500.00",usefulLife:"5 years"}));
  return {version:"ics-v2",sourceHash:template.sourceHash,fundCluster:"TEST",details:{number:"2026-11-001",entity:"Fictional School",fromName:"Fictional Issuer",fromOffice:"Property Office",toName:"Fictional Recipient",toOffice:"Test Classroom",fromDate:"2026-11-09",toDate:"2026-11-09",lines:lines.map(({transactionId,usefulLife})=>({transactionId,usefulLife}))},lines};
}
test.skipIf(!existsSync(reference))("ICS v2 matches the private reference fonts, sizes, column widths and fixed merges",async()=>{
  expect(createHash("sha256").update(new Uint8Array(readFileSync(reference))).digest("hex")).toBe(template.sourceHash);
  const source=new ExcelJS.Workbook();await source.xlsx.readFile(reference);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await renderIcs(fixture(1)) as unknown as ExcelJS.Buffer);
  const sheet=book.worksheets[0]!,original=source.worksheets[0]!;
  expect(sheet.columns.map(c=>c.width)).toEqual(original.columns.slice(0,8).map(c=>c.width));
  for(const address of ["G1","A3","A9","C9","C10","A12","C12","E12","H12","A45","A48","F45","F48"]){
    expect(sheet.getCell(address).font.name).toBe(original.getCell(address).font.name);
    expect(sheet.getCell(address).font.size).toBe(original.getCell(address).font.size);
  }
  for(const range of ["A5:D6","A3:H4","A12:A14","E12:F14","A45:E46","F45:H46"])expect(sheet.model.merges).toContain(range);
  expect(sheet.getCell("A45").value).toBe("Fictional Issuer");
  expect(sheet.getCell("F45").value).toBe("Fictional Recipient");
});
for(const count of [1,32,100,2000])test(`ICS v2 renders ${count} items as dynamic long-bond print data without fixed row limits`,async()=>{
  const book=new ExcelJS.Workbook();const data=fixture(count);
  await book.xlsx.load(await renderIcs(data) as unknown as ExcelJS.Buffer);
  const sheet=book.worksheets[0]!;
  expect(sheet.pageSetup.paperSize).toBe(14 as ExcelJS.PaperSize);
  expect(sheet.pageSetup.fitToWidth).toBe(1);expect(sheet.pageSetup.fitToHeight).toBe(0);
  expect(sheet.pageSetup.printTitlesRow).toBe("1:11");
  expect(sheet.getCell("A12").value).toBe(1);expect(sheet.getCell("D12").value).toBe(1500);
  let quantity=0,descriptions="";
  sheet.eachRow(row=>{if(row.number<12)return;const q=row.getCell(1);if(!q.isMerged||q.address===q.master.address){if(typeof q.value==="number")quantity+=q.value;}const cell=row.getCell(5);if(cell.address===cell.master.address&&typeof cell.value==="string")descriptions+=cell.value;});
  expect(quantity).toBe(count);
  for(const line of data.lines)expect(descriptions).toContain(line.description);
  expect(sheet.getCell(`H${sheet.rowCount}`).border.right?.style).toBe("medium");
  expect(sheet.getCell(`F${sheet.rowCount-6}`).value).toBe("Fictional Recipient");
},30000);
test("ICS v2 keeps long text intact, uses bounded rows and never turns descriptions into formulas",async()=>{
  const text="=A1+SUM(B2:B9) \nSerial αβ — "+"Long description with spaces 漢字 ".repeat(220);
  expect(wrapIcsText(text,140).join("")).toBe(text);
  const data=fixture(1,text),bytes=await renderIcs(data),book=new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);const sheet=book.worksheets[0]!;
  let reconstructed="";
  sheet.eachRow(row=>{if(row.number<12)return;const c=row.getCell(5);if(c.address===c.master.address&&typeof c.value==="string"){reconstructed+=c.value;expect(c.type).toBe(ExcelJS.ValueType.String);}expect(row.height??0).toBeLessThan(409);});
  expect(reconstructed).toBe(data.lines[0]!.description);
  const archive=XLSX.read(bytes,{type:"buffer",bookFiles:true}) as XLSX.WorkBook&{files:Record<string,{content:Uint8Array}>};
  const xml=new TextDecoder().decode(archive.files["xl/worksheets/sheet1.xml"]!.content);
  expect(xml).toContain("<rowBreaks");
  expect(sheet.getCell("E12").font.size).toBe(11);
});
