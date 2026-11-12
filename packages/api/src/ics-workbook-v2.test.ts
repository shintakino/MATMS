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
for(const version of ["ics-v2","ics-v3"] as const)for(const count of [1,32,100,2000])test(`ICS ${version} renders ${count} items as dynamic long-bond print data without fixed row limits`,async()=>{
  const book=new ExcelJS.Workbook();const data=fixture(count);
  data.version=version;
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
test("ICS v3 reserves complete line boxes for cost headers, metadata and every signature label",async()=>{
  const data=fixture(1);data.version="ics-v3";
  data.details.fromOffice="Administrative Officer II / Property Custodian";
  data.details.toOffice="Teacher I / School Clinic";
  const book=new ExcelJS.Workbook();await book.xlsx.load(await renderIcs(data) as unknown as ExcelJS.Buffer);
  const sheet=book.worksheets[0]!;
  expect(sheet.getCell("C10").value).toBe("Unit Cost");
  expect(sheet.getRow(10).height!+sheet.getRow(11).height!).toBeGreaterThanOrEqual(36);
  for(const row of [7,9,44,47,49,51])expect(sheet.getRow(row).height!).toBeGreaterThanOrEqual(18);
  for(const address of ["A7","C10","D10","A44","F44","A47","F47","A49","F49","A51","F51"]){
    const cell=sheet.getCell(address);
    expect(cell.alignment.vertical).toBe("middle");expect(cell.alignment.wrapText).toBe(true);
    expect(cell.font.name).toBe("Times New Roman");
  }
  expect(sheet.getCell("C10").font.size).toBe(12);
  expect(sheet.getCell("A47").font.size).toBe(11);
  expect(sheet.model.merges).toContain("A44:E44");
  expect(sheet.model.merges).toContain("F44:H44");
  const old=new ExcelJS.Workbook();data.version="ics-v2";
  await old.xlsx.load(await renderIcs(data) as unknown as ExcelJS.Buffer);
  expect(old.worksheets[0]!.getRow(47).height).toBe(11.55);
  expect(old.worksheets[0]!.getRow(10).height!+old.worksheets[0]!.getRow(11).height!).toBe(24.6);
});
test("ICS v3 keeps long signature offices and descriptions complete with bounded continuation rows",async()=>{
  const data=fixture(1,"wide equipment description 漢字 ".repeat(220));data.version="ics-v3";
  data.details.fromName="Fictional Property Custodian With A Long Printed Name";
  data.details.toOffice="Senior Teacher / Department of Science / School Clinic and Emergency Response Office";
  const book=new ExcelJS.Workbook();await book.xlsx.load(await renderIcs(data) as unknown as ExcelJS.Buffer);
  const sheet=book.worksheets[0]!;
  let description="",footer=0;
  sheet.eachRow(row=>{
    const cell=row.getCell(5);
    if(row.number>=12&&cell.address===cell.master.address&&typeof cell.value==="string")description+=cell.value;
    if(row.getCell(1).value==="Received  from:")footer=row.number;
    expect(row.height??0).toBeLessThan(409);
  });
  expect(description).toBe(data.lines[0]!.description);
  expect(sheet.getCell(footer+4,6).value).toBe(data.details.toOffice);
  expect(sheet.getRow(footer+4).height).toBeGreaterThan(22);
  for(const offset of [0,3,5,7])expect(sheet.getRow(footer+offset).height).toBeGreaterThanOrEqual(18);
});
test("ICS v4 prints both dates as MM-DD-YYYY while preserving ISO snapshots and older print versions",async()=>{
  const data=fixture(1);data.version="ics-v4";
  data.details.fromDate="2024-02-29";data.details.toDate="2026-11-12";
  const original=structuredClone(data),book=new ExcelJS.Workbook();
  await book.xlsx.load(await renderIcs(data) as unknown as ExcelJS.Buffer);
  const sheet=book.worksheets[0]!;
  expect(sheet.getCell(`A${sheet.rowCount-1}`).value).toBe("02-29-2024");
  expect(sheet.getCell(`F${sheet.rowCount-1}`).value).toBe("11-12-2026");
  expect(sheet.getRow(10).height!+sheet.getRow(11).height!).toBeGreaterThanOrEqual(36);
  expect(sheet.getCell(`A${sheet.rowCount-1}`).font.size).toBe(11);
  expect(sheet.pageSetup.paperSize).toBe(14 as ExcelJS.PaperSize);
  expect(data).toEqual(original);
  const older=new ExcelJS.Workbook();
  await older.xlsx.load(await renderIcs({...data,version:"ics-v3"}) as unknown as ExcelJS.Buffer);
  expect(older.worksheets[0]!.getCell(`A${older.worksheets[0]!.rowCount-1}`).value).toBe("2024-02-29");
  expect(older.worksheets[0]!.getCell(`F${older.worksheets[0]!.rowCount-1}`).value).toBe("2026-11-12");
});
