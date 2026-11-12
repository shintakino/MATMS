import ExcelJS from "exceljs";
import { z } from "zod";
import template from "./ics-template";

const label = z.string().trim().min(1).max(240);
export const icsDetails = z.object({
  number: label, entity: label, fromName: label, fromOffice: label,
  toName: label, toOffice: label, fromDate: z.iso.date(), toDate: z.iso.date(),
  lines: z.array(z.object({ transactionId: z.uuid(), usefulLife: label })).min(1).max(2000),
}).strict();
export const icsPayload = z.object({
  version: z.literal("ics-v1"), sourceHash: z.literal(template.sourceHash),
  details: icsDetails, fundCluster: label,
  lines: z.array(z.object({ transactionId: z.uuid(), quantity: z.number().int().positive(), unit: label, description: z.string().max(10000), itemNumber: label, unitCost: z.string().regex(/^\d+\.\d{2}$/), totalCost: z.string().regex(/^\d+\.\d{2}$/), usefulLife: label })).min(1).max(2000),
});
export type IcsPayload = z.infer<typeof icsPayload>;
export function icsCost(value: string, quantity: number) {
  if (!/^\d+\.\d{2}$/.test(value) || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Invalid ICS valuation.");
  const cents = BigInt(value.replace(".", "")) * BigInt(quantity);
  if (cents > 999999999999999n) throw new Error("ICS value exceeds Excel precision.");
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
export async function renderIcs(input: unknown) {
  const data = icsPayload.parse(input);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("ICS");
  sheet.columns = template.widths.map((width) => ({ width }));
  const rows = data.lines.flatMap(line => {
    const chunks = line.description.match(/[\s\S]{1,180}/g) ?? [""];
    return chunks.map((description, index) => ({line, description, first: index === 0}));
  });
  const extra = Math.max(0, rows.length - 32);
  const shift = (row: number) => row >= 44 ? row + extra : row;
  const styles = template.cells as Record<string, {value: string | number | null; font: Partial<ExcelJS.Font>; alignment: Partial<ExcelJS.Alignment>; border: Partial<ExcelJS.Borders>}>;
  for (const [address, source] of Object.entries(styles)) {
    const cell = sheet.getCell(address), row = shift(Number(address.match(/\d+/)![0]));
    const target = sheet.getCell(row, Number(cell.col));
    target.value = source.value;
    target.font = source.font; target.alignment = source.alignment; target.border = source.border;
  }
  template.heights.forEach((height, index) => { sheet.getRow(shift(index + 1)).height = height; });
  for (const range of template.merges) {
    sheet.mergeCells(range.replace(/\d+/g, (row) => String(shift(Number(row)))));
  }
  // Merging in ExcelJS shares the master's style and drops the source edge cells.
  // Restore each physical cell's border after merging to retain the signature frame.
  for (const [address, source] of Object.entries(styles)) {
    const original = sheet.getCell(address);
    const target = sheet.getCell(shift(Number(address.match(/\d+/)![0])), Number(original.col));
    target.style = { ...target.style, border: structuredClone(source.border) };
  }
  const bottomBorders = Array.from({length: 8}, (_, index) => structuredClone(sheet.getCell(43, index + 1).border));
  if (extra) for (let col = 1; col <= 8; col++) sheet.getCell(43, col).style = structuredClone(sheet.getCell(12, col).style);
  for (let index = 0; index < Math.max(32, rows.length); index++) {
    const row = 12 + index;
    if (index >= 32) {
      for (let col = 1; col <= 8; col++) sheet.getCell(row, col).style = structuredClone(sheet.getCell(12, col).style);
      sheet.mergeCells(row, 5, row, 6);
    }
    const entry = rows[index];
    if (!entry) continue;
    const {line, description, first} = entry;
    if (icsCost(line.unitCost, line.quantity) !== line.totalCost) throw new Error("ICS total does not reconcile.");
    for (const [column, value] of [[1,line.quantity],[2,line.unit],[3,Number(line.unitCost)],[4,Number(line.totalCost)],[5,description],[7,line.itemNumber],[8,line.usefulLife]] as const) {
      const cell = sheet.getCell(row,column); cell.value = first || column === 5 ? value : null;
      cell.alignment = { ...cell.alignment, wrapText: true, vertical: "middle" };
      if (column === 3 || column === 4) cell.numFmt = '#,##0.00';
    }
    sheet.getRow(row).height = Math.max(12.75, Math.ceil(Math.max(description.length / 30, line.itemNumber.length / 12, line.usefulLife.length / 13, line.unit.length / 6)) * 15);
  }
  if (extra) bottomBorders.forEach((border, index) => { sheet.getCell(43 + extra, index + 1).border = border; });
  sheet.getCell("A6").value = `Entity Name: ${data.details.entity}`;
  sheet.getCell("A7").value = `Fund Cluster : ${data.fundCluster}`;
  sheet.getCell("G7").value = `ICS No : ${data.details.number}`;
  for (const [col, name, office, date] of [["A", data.details.fromName, data.details.fromOffice, data.details.fromDate], ["F", data.details.toName, data.details.toOffice, data.details.toDate]] as const) {
    sheet.getCell(`${col}${shift(46)}`).value = name;
    sheet.getCell(`${col}${shift(48)}`).value = office;
    sheet.getCell(`${col}${shift(50)}`).value = date;
  }
  sheet.pageSetup = { paperSize: 1 as ExcelJS.PaperSize, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:H${shift(51)}`, printTitlesRow: "1:11", margins: { left: 1.25, right: 1, top: 0.79, bottom: 0.5, header: 0, footer: 0.25 } };
  // ExcelJS inserts a break after the selected row. Keep both Received labels
  // and all signature rows together on a separate page for growing forms.
  const contentHeight = Array.from({length: shift(51)}, (_, index) => sheet.getRow(index + 1).height ?? 15).reduce((total, height) => total + height, 0);
  if (extra || contentHeight > 650) sheet.getRow(shift(44) - 1).addPageBreak();

  sheet.headerFooter.oddFooter = "Page &P of &N";
  return Buffer.from(await book.xlsx.writeBuffer());
}
