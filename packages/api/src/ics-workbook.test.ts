import { test } from "bun:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { renderIcs, icsCost, icsPayload, type IcsPayload } from "./ics-workbook";
import template from "./ics-template";

function fixture(count: number): IcsPayload {
  const lines=Array.from({length:count},()=>({transactionId:randomUUID(), quantity:3, unit:"unit", description:"Fictional fan HFAN-20HYP", itemNumber:"TEST-001",unitCost:"1234.56",totalCost:"3703.68", usefulLife:"5 years"}));
  return {version:"ics-v1",sourceHash:template.sourceHash,fundCluster:"TEST",details:{number:"TEST-ICS-001",entity:"Fictional School",fromName:"Fixture issuer",fromOffice:"Property Office",toName:"Fixture recipient",toOffice:"Test Office",fromDate:"2026-11-09",toDate:"2026-11-09",lines:lines.map(line=>({transactionId:line.transactionId,usefulLife:line.usefulLife}))},lines};
}
const sourcePath = new URL("../../../Appendix 59 - ICS.xls", import.meta.url).pathname;
test.skipIf(!existsSync(decodeURIComponent(sourcePath)))("ICS private source checksum matches the extracted layout", () => {
  assert.equal(createHash("sha256").update(new Uint8Array(readFileSync(decodeURIComponent(sourcePath)))).digest("hex"),template.sourceHash);
});
test("ICS exact costs, missing and empty data guards",async()=>{
  assert.equal(icsCost("0.10",3),"0.30");
  assert.equal(icsCost("1234.56",3),"3703.68");
  assert.throws(()=>icsCost("9999999999999.99",2));
  assert.equal(icsPayload.safeParse(fixture(0)).success,false);
  const data=fixture(1);data.lines[0]!.totalCost="0.00";
  await assert.rejects(renderIcs(data),/reconcile/);
});
for(const size of [1,32,33,100,2000])test(`ICS ${size} rows preserve headers, rows, signature merges and scoped print area`,async()=>{
  const data=fixture(size),bytes=await renderIcs(data),book=new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  assert.deepEqual(book.worksheets.map(s=>s.name),["ICS"]);
  const sheet=book.worksheets[0]!,extra=Math.max(0,size-32);
  assert.equal(sheet.getCell("A3").value,"INVENTORY CUSTODIAN  SLIP");
  assert.equal(sheet.getCell("A9").value,"Quantity");
  assert.equal(sheet.getCell("C9").value,"Amount");
  assert.equal(sheet.getCell("H9").value,"Estimated Useful Life");
  assert.equal(sheet.getCell("A12").value,3);
  assert.equal(sheet.getCell("D12").value,3703.68);
  assert.equal(sheet.getCell(`E${11+size}`).value,data.lines[size-1]!.description);
  assert.equal(sheet.getCell(`A${46+extra}`).value,"Fixture issuer");
  assert.equal(sheet.getCell(`F${46+extra}`).value,"Fixture recipient");
  assert.equal(sheet.getCell(`A${51+extra}`).value,"Date");
  assert.equal(sheet.pageSetup.printArea,`A1:H${51+extra}`);
  assert.equal(sheet.pageSetup.printTitlesRow,"1:11");
  assert.ok(sheet.model.merges.includes("C9:D9"));
  assert.ok(sheet.model.merges.includes(`E${11+size}:F${11+size}`));
  assert.equal(sheet.getCell("A9").font.name,"Times New Roman");
  assert.equal(sheet.getCell("A12").border.left?.style,"medium");
  assert.equal(sheet.getCell(`H${51+extra}`).border.right?.style,"medium");
  assert.equal(sheet.getRow(45+extra).height,template.heights[44]);
  if(extra) {
    const archive = XLSX.read(bytes, { type: "buffer", bookFiles: true }) as XLSX.WorkBook & { files: Record<string, { content: Uint8Array }> };
    const xml = new TextDecoder().decode(archive.files["xl/worksheets/sheet1.xml"]!.content);
    assert.ok(xml.includes(`<brk id="${43 + extra}"`));
  }
});
test("ICS preserves formula-like text as strings and expands long descriptions without truncation",async()=>{
  const data=fixture(1);data.details.entity="=1+1";data.lines[0]!.description="=SUM(A1:A2) "+"A".repeat(1200);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await renderIcs(data) as unknown as ExcelJS.Buffer);const sheet=book.worksheets[0]!;
  let description="";for(let row=12;row<44;row++){const value=sheet.getCell(row,5).value;if(typeof value==="string")description+=value;}
  assert.equal(description,data.lines[0]!.description);
  assert.equal(sheet.getCell("E12").type,ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("A13").value,null);
});
