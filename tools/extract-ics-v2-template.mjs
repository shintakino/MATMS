import fs from "node:fs";
import { createHash } from "node:crypto";
import ExcelJS from "../packages/api/node_modules/exceljs/excel.js";
const bytes = fs.readFileSync("ICS-2025-11-001.xlsx");
const book = new ExcelJS.Workbook();
await book.xlsx.load(bytes);
const sheet = book.worksheets[0];
const labels = new Set(["G1","A3","A9","B9","C9","C10","D10","E9","G9","H9","A44","F44","A47","F47","A49","F49","A51","F51"]);
const cells = {};
for (let row = 1; row <= 51; row++) for (let column = 1; column <= 8; column++) {
  const cell = sheet.getCell(row, column);
  cells[cell.address] = { style: cell.style, value: labels.has(cell.address) ? cell.value : null };
}
const template = { sourceHash: createHash("sha256").update(bytes).digest("hex"), widths: sheet.columns.slice(0,8).map(c => c.width), heights: Array.from({length:51},(_,i)=>sheet.getRow(i+1).height ?? sheet.properties.defaultRowHeight), merges: sheet.model.merges, margins: sheet.pageSetup.margins, cells };
fs.writeFileSync("packages/api/src/ics-template-v2.ts", "// Sanitized layout from ICS-2025-11-001.xlsx; no source inventory or signatory values.\nconst template = " + JSON.stringify(template) + ";\nexport default template;\n");
