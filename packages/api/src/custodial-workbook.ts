import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { z } from "zod";
import { custodialProfileDefinition } from "./custodial-service";
import { calculatePhysicalCountVariance } from "./physical-count-calculation";
import { formatProfileAsOf, splitReportText } from "./inventory-profile-templates";

const text = z.string().max(10000);
const snapshotSchema = z.object({ article: text, description: text, propertyNumber: text.nullable(), unit: text, unitValue: z.string().nullable(), supplier: text.nullable().optional(), yearLabel: text.nullable().optional(), acquiredOn: text.nullable().optional(), cardQuantity: z.number().int().nonnegative() }).passthrough();
const reportSchema = z.object({
  family: z.enum(["rpcsp", "rpcppe"]), asOfDate: z.iso.date(), fundCluster: text,
  sectionScope: z.array(z.object({ id: z.uuid(), name: text, sheetName: text, version: z.number().int().nonnegative() })).optional(),
  metadata: z.object({ entity: text, accountableOfficer: text, accountableDesignation: text, accountabilityAssumedDate: z.iso.date(), custodian: text, custodianDesignation: text, committeeChair: text, committeeChairDesignation: text, committeeMember: text, committeeMemberDesignation: text, schoolHead: text, schoolHeadDesignation: text }),
  totals: z.object({ shortageValue: z.string(), overageValue: z.string() }),
  profile: z.object({ family: z.enum(["rpcsp", "rpcppe"]), definition: custodialProfileDefinition }),
  lines: z.array(z.object({ lotId: z.uuid(), snapshot: snapshotSchema, section: z.object({ name: text, sheetName: text, order: z.number().int() }), status: z.enum(["counted", "excluded", "unavailable"]), physicalQuantity: z.number().int().nonnegative().optional(), condition: text.optional(), conditionBreakdown: z.array(z.object({ condition: text, quantity: z.number().int().positive() })).nullable().optional(), remarks: text.nullable().optional(), resolution: text.nullable().optional(), variance: z.object({ quantity: z.number().int(), value: z.string().nullable(), status: z.enum(["matched", "shortage", "overage"]) }).nullable() })),
});

type Report = z.infer<typeof reportSchema>;
type CountProfileSheet = z.infer<typeof custodialProfileDefinition>["sheets"][number];
function countLineText(line: Report["lines"][number], profile: CountProfileSheet) {
  const remarks = [line.remarks, line.conditionBreakdown?.map((part) => `${part.condition.replaceAll("_", " ")}: ${part.quantity}`).join(", ")].filter(Boolean).join("; ");
  const descriptions = splitReportText(line.snapshot.description, profile.columns[1]!.width, profile.fontSize, profile.continuationRows ?? false);
  const comments = splitReportText(remarks, profile.columns[profile.columns.length - 1]!.width, profile.fontSize, profile.continuationRows ?? false);
  const count = Math.max(descriptions.length, comments.length);
  return Array.from({ length: count }, (_, index) => ({ description: descriptions[index] ?? "", remarks: comments[index] ?? "" }));
}
const names = { rpcsp: ["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"], rpcppe: ["RPCPPE_LAND", "RPCPPE_BLDG", "RPCPPE_OTHERBLDG"] } as const;
const thinBorder: Partial<ExcelJS.Borders> = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };

/** Reject values Excel cannot represent to the cent rather than silently rounding. */
function currency(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(-?)(\d{1,16})\.(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid currency in frozen report.");
  const cents = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  if (cents > 999999999999999n) throw new Error("Currency exceeds Excel's 15-digit precision.");
  return Number(`${match[1]}${match[2]}.${match[3]}`);
}
function mergeText(sheet: ExcelJS.Worksheet, range: string, value: string, size: number, bold = false) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]!);
  cell.value = value;
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.font = { name: "Arial Narrow", size, bold };
}
function applyHeadingStyle(cell: ExcelJS.Cell, style: NonNullable<NonNullable<z.infer<typeof custodialProfileDefinition>["sheets"][number]["headingStyles"]>["title"]> | undefined) {
  if (!style) return;
  cell.font = { name: style.font, size: style.size, bold: style.bold, italic: style.italic, underline: style.underline };
  cell.alignment = { ...cell.alignment, horizontal: style.alignment ?? "center" };
}
function setHeader(sheet: ExcelJS.Worksheet, column: number, first: number, last: number, label: string) {
  sheet.mergeCells(first, column, last, column);
  const cell = sheet.getCell(first, column);
  cell.value = label;
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.font = { name: "Arial Narrow", size: 9, bold: true };
}
function borderRange(sheet: ExcelJS.Worksheet, first: number, last: number, columns: number) {
  for (let row = first; row <= last; row++) for (let col = 1; col <= columns; col++) sheet.getCell(row, col).border = thinBorder;
}
function setBorderCode(cell: ExcelJS.Cell, code: string) {
  const edge = (value: string): Partial<ExcelJS.Border> | undefined => value === "n" ? undefined : { style: value === "m" ? "medium" : "thin" };
  cell.style = { ...cell.style, border: { top: edge(code[0]!), right: edge(code[1]!), bottom: edge(code[2]!), left: edge(code[3]!) } };
}
function applyProfileHeaderMerges(sheet: ExcelJS.Worksheet, ranges: string[], lastRow: number, lastColumn: number) {
  const merges = sheet.model.merges.map((range) => XLSX.utils.decode_range(range));
  for (const range of ranges) {
    const next = XLSX.utils.decode_range(range);
    if (next.s.r > next.e.r || next.s.c > next.e.c || next.e.r >= lastRow || next.e.c >= lastColumn) throw new Error("Profile header merge exceeds the fixed header area.");
    const overlap = merges.find((existing) => next.s.r <= existing.e.r && next.e.r >= existing.s.r && next.s.c <= existing.e.c && next.e.c >= existing.s.c);
    if (overlap) {
      if (overlap.s.r === next.s.r && overlap.s.c === next.s.c && overlap.e.r === next.e.r && overlap.e.c === next.e.c) continue;
      throw new Error("Profile header merges overlap existing form geometry.");
    }
    for (let row = next.s.r; row <= next.e.r; row++) for (let col = next.s.c; col <= next.e.c; col++) {
      if ((row !== next.s.r || col !== next.s.c) && sheet.getCell(row + 1, col + 1).value !== null) throw new Error("Profile header merge would overwrite content.");
    }
    sheet.mergeCells(range);
    merges.push(next);
  }
}
function signatures(sheet: ExcelJS.Worksheet, start: number, report: Report, geometry: z.infer<typeof custodialProfileDefinition>["sheets"][number]["signatures"]) {
  sheet.getCell(start, 1).value = "Certified Correct by:";
  sheet.getCell(start, 7).value = "Noted by:";
  const people = {
    custodian: [report.metadata.custodian, report.metadata.custodianDesignation],
    committee_chair: [report.metadata.committeeChair, report.metadata.committeeChairDesignation],
    committee_member: [report.metadata.committeeMember, report.metadata.committeeMemberDesignation],
    school_head: [report.metadata.schoolHead, report.metadata.schoolHeadDesignation],
  };
  for (const signature of geometry) {
    const row = start + signature.rowOffset + 1;
    const designationRow = row + (signature.designationOffset ?? 1);
    const [name, designation] = people[signature.role];
    if (signature.endColumn > sheet.columnCount || (signature.labelEndColumn ?? signature.startColumn) > sheet.columnCount) throw new Error("Signature exceeds the form width.");
    if (signature.endColumn > signature.startColumn) {
      sheet.mergeCells(row, signature.startColumn, row, signature.endColumn);
      sheet.mergeCells(designationRow, signature.startColumn, designationRow, signature.endColumn);
    }
    if (signature.signatureLabel) {
      const labelRow = row + (signature.labelOffset ?? 1);
      const labelEnd = signature.labelEndColumn ?? signature.startColumn;
      if (labelEnd > signature.startColumn) sheet.mergeCells(labelRow, signature.startColumn, labelRow, labelEnd);
      const label = sheet.getCell(labelRow, signature.startColumn);
      label.value = signature.signatureLabel;
      label.font = { name: "Arial Narrow", size: 10 };
      label.alignment = labelEnd > signature.startColumn ? { horizontal: "center", vertical: "middle" } : { vertical: "middle" };
    }
    for (const [targetRow, value, isName] of [[row, name, true], [designationRow, designation, false]] as const) {
      const cell = sheet.getCell(targetRow, signature.startColumn);
      cell.value = value;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.font = { name: "Arial Narrow", size: 10, bold: isName, underline: isName && signature.underlineName };
    }
  }
}

/** Reopen our generated workbook and compare typed cells and cached formulas to server calculations. */
function verifyCountWorkbook(bytes: Buffer, report: Report) {
  const workbook = XLSX.read(bytes, { type: "buffer", cellFormula: true, cellStyles: true });
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(names[report.family])) throw new Error("Generated workbook sheet routing failed verification.");
  for (const profile of report.profile.definition.sheets) {
    const sheet = workbook.Sheets[profile.name];
    if (!sheet) throw new Error("Generated workbook sheet is unavailable.");
    const allowedFormulas = new Set<string>();
    const lines = report.lines.filter((line) => line.section.sheetName === profile.name && line.status === "counted").sort((a, b) => a.section.order - b.section.order || a.lotId.localeCompare(b.lotId));
    let row = report.family === "rpcsp" ? 12 : 14, section = "";
    let groupLines: typeof lines = [];
    let groupStart = row; const ranges: Array<[number, number]> = [];
    const totals = (included: typeof lines) => included.reduce((sum, line) => ({ card: sum.card + line.snapshot.cardQuantity, physical: sum.physical + line.physicalQuantity!, variance: sum.variance + line.variance!.quantity, cents: sum.cents + BigInt(line.variance!.value!.replace(".", "")), unitCents: sum.unitCents + BigInt(line.snapshot.unitValue!.replace(".", "")) }), { card: 0, physical: 0, variance: 0, cents: 0n, unitCents: 0n });
    const valueOfCents = (cents: bigint) => { const sign = cents < 0n ? "-" : ""; const magnitude = cents < 0n ? -cents : cents; return currency(`${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`); };
    const closeGroup = () => {
      const end = row - 1; ranges.push([groupStart, end]);
      if (profile.subtotalAfterSections?.includes(section)) {
        const group = totals(groupLines);
        const expected = { E: valueOfCents(group.unitCents), F: group.card, G: group.physical, H: group.variance, I: valueOfCents(group.cents) };
        for (const column of [...(profile.sumUnitValues ? ["E"] : []), "F", "G", "H", "I"]) {
          const address = `${column}${row}`; allowedFormulas.add(address);
          if (sheet[address]?.f !== `SUM(${column}${groupStart}:${column}${end})` || sheet[address]?.v !== expected[column as keyof typeof expected]) throw new Error("Generated section total failed verification.");
        }
        row++;
      }
    };
    for (const line of lines) {
      if (line.section.name !== section) { if (section) closeGroup(); section = line.section.name; groupStart = row; groupLines = []; }
      groupLines.push(line);
      const fragments = countLineText(line, profile);
      const expected = [fragments[0]!.description, line.snapshot.propertyNumber, line.snapshot.unit, currency(line.snapshot.unitValue), line.snapshot.cardQuantity, line.physicalQuantity!, line.variance!.quantity, currency(line.variance!.value)];
      for (const [index, value] of expected.entries()) {
        const address = `${String.fromCharCode(66 + index)}${row}`;
        if ((sheet[address]?.v ?? null) !== value) throw new Error("Generated workbook values failed verification.");
      }
      for (const [column, formula] of [["H", `G${row}-F${row}`], ["I", `H${row}*E${row}`]] as const) {
        const address = `${column}${row}`; allowedFormulas.add(address);
        if (sheet[address]?.f !== formula) throw new Error("Generated variance formula failed verification.");
      }
      const remarksColumn = report.family === "rpcsp" ? "J" : "L";
      for (const [offset, fragment] of fragments.entries()) {
        if ((sheet[`B${row + offset}`]?.v ?? "") !== fragment.description || (sheet[`${remarksColumn}${row + offset}`]?.v ?? "") !== fragment.remarks) throw new Error("Generated continuation text failed verification.");
        if (offset && ["C", "D", "E", "F", "G", "H", "I", ...(report.family === "rpcppe" ? ["J", "K"] : [])].some((column) => sheet[`${column}${row + offset}`]?.v != null)) throw new Error("Generated continuation contains unexpected values.");
      }
      row += fragments.length;
    }
    if (section) closeGroup();
    if (!lines.length) row++;
    if (lines.length) for (const column of [...(profile.sumUnitValues ? ["E"] : []), "F", "G", "H", "I"]) {
      const address = `${column}${row}`; allowedFormulas.add(address);
      const formula = `SUM(${ranges.map(([first, last]) => `${column}${first}:${column}${last}`).join(",")})`;
      if (sheet[address]?.f !== formula) throw new Error("Generated report total failed verification.");
    }
    const total = totals(lines);
    for (const [column, value] of [["F", total.card], ["G", total.physical], ["H", total.variance], ["I", valueOfCents(total.cents)]] as const) if (sheet[`${column}${row}`]?.v !== value) throw new Error("Generated report total failed verification.");
    if (profile.sumUnitValues && sheet[`E${row}`]?.v !== valueOfCents(total.unitCents)) throw new Error("Generated unit-value total failed verification.");
    for (const [offset, status] of [[1, "shortage"], [2, "overage"]] as const) {
      const selected = totals(lines.filter((line) => line.variance!.status === status));
      if (sheet[`H${row + offset}`]?.v !== selected.variance || sheet[`I${row + offset}`]?.v !== valueOfCents(selected.cents)) throw new Error("Generated signed totals failed verification.");
    }
    for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith("!") && cell && typeof cell === "object" && "f" in cell && typeof cell.f === "string" && !allowedFormulas.has(address)) throw new Error("Generated workbook contains an unexpected formula.");
  }
}

/** Render a full, three-sheet count workbook from a frozen, server-owned report. */
export async function renderCustodialCountWorkbook(payload: unknown): Promise<Buffer> {
  const report = reportSchema.parse(payload);
  if (report.family !== report.profile.family) throw new Error("Form family does not match the frozen profile.");
  if (report.profile.definition.thresholdExample && !report.profile.definition.thresholdNote) throw new Error("A threshold example requires a threshold note.");
  const expected = names[report.family];
  if (report.profile.definition.sheets.length !== expected.length || report.profile.definition.sheets.some((sheet, i) => sheet.name !== expected[i])) throw new Error("The profile does not contain all source sheets in order.");
  const profileByName = new Map(report.profile.definition.sheets.map((sheet) => [sheet.name, sheet]));
  const ids = new Set<string>();
  let shortageCents = 0n, overageCents = 0n;
  for (const line of report.lines) {
    if (ids.has(line.lotId)) throw new Error("Duplicate lot in report.");
    ids.add(line.lotId);
    const sheet = profileByName.get(line.section.sheetName);
    if (!sheet || !sheet.sectionLabels.includes(line.section.name)) throw new Error("A report line has an invalid sheet or section.");
    if (report.sectionScope?.length && !report.sectionScope.some((section) => section.name === line.section.name && section.sheetName === line.section.sheetName)) throw new Error("A report line is outside the frozen section scope.");
    if (line.status === "counted") {
      if (line.physicalQuantity === undefined || line.variance === null || line.snapshot.unitValue === null || line.variance.value === null) throw new Error("Counted line is incomplete.");
      const computed = calculatePhysicalCountVariance({ cardQuantity: line.snapshot.cardQuantity, physicalQuantity: line.physicalQuantity, unitValue: line.snapshot.unitValue });
      if (computed.quantity !== line.variance.quantity || computed.value !== line.variance.value || computed.status !== line.variance.status) throw new Error("Frozen variance does not match source quantities.");
      const value = BigInt(computed.value!.replace(".", ""));
      if (value < 0n) shortageCents -= value; else overageCents += value;
    } else if (line.variance !== null) {
      throw new Error("Excluded lines cannot carry calculated variance.");
    }
  }
  const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
  if (money(shortageCents) !== report.totals.shortageValue || money(overageCents) !== report.totals.overageValue) throw new Error("Frozen report totals do not reconcile.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MATMS";
  for (const name of expected) {
    const profile = profileByName.get(name)!;
    const count = report.family === "rpcsp" ? 10 : 12;
    if (profile.columns.length !== count || profile.orientation !== "landscape") throw new Error("Invalid profile geometry.");
    const sheet = workbook.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { ...profile.margins, header: 0.3, footer: 0.3 }, printTitlesRow: report.family === "rpcsp" ? "1:11" : "1:13" }, headerFooter: { oddHeader: report.sectionScope?.length ? "&CPartial count: selected sections" : "", oddFooter: "Page &P of &N" } });
    profile.columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
    const lastColumn = report.family === "rpcsp" ? "J" : "L";
    if (report.family === "rpcsp") {
      mergeText(sheet, "A1:J1", profile.label, 10);
      mergeText(sheet, "A2:J2", profile.reportTitle ?? "REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY", 14, true);
      mergeText(sheet, "A3:J3", profile.title, 11, true);
      mergeText(sheet, "A4:J4", profile.typeCaption ?? "(Type of Semi-Expendable Property)", 9);
      mergeText(sheet, "A5:J5", `As of ${formatProfileAsOf(report.asOfDate, report.profile.definition.asOfDisplay)}`, 10, true);
      sheet.getCell("A7").value = `Fund Cluster: ${report.fundCluster}`;
      sheet.getCell("F7").value = `Entity Name: ${report.metadata.entity}`;
      sheet.getCell("A8").value = `For which ${report.metadata.accountableOfficer}, ${report.metadata.accountableDesignation}, is accountable as of ${report.metadata.accountabilityAssumedDate}`;
      sheet.getCell("A8").alignment = { vertical: "middle" };
      const labels = profile.columns.slice(0, 7).map((column) => column.label);
      labels.forEach((label, index) => setHeader(sheet, index + 1, 10, 11, label));
      sheet.getCell("H10").value = "SHORTAGE/COVERAGE"; sheet.getCell("H11").value = profile.columns[7]!.label; sheet.getCell("I11").value = profile.columns[8]!.label; setHeader(sheet, 10, 10, 11, profile.columns[9]!.label);
      borderRange(sheet, 10, 11, count);
    } else {
      mergeText(sheet, "I1:L1", profile.label, 10);
      mergeText(sheet, "A3:L3", profile.reportTitle ?? "REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT", 15, true);
      mergeText(sheet, "A4:L4", profile.title, 11, true);
      mergeText(sheet, "A5:L5", profile.typeCaption ?? "(Type of Property, Plant and Equipment)", 9);
      mergeText(sheet, "A6:L6", `As of ${formatProfileAsOf(report.asOfDate, report.profile.definition.asOfDisplay)}`, 10, true);
      sheet.getCell("A8").value = `Fund Cluster: ${report.fundCluster}`;
      sheet.getCell("G8").value = `Entity Name: ${report.metadata.entity}`;
      sheet.getCell("A9").value = `For which ${report.metadata.accountableOfficer}, ${report.metadata.accountableDesignation}, is accountable as of ${report.metadata.accountabilityAssumedDate}`;
      sheet.getCell("A9").alignment = { vertical: "middle" };
      profile.columns.slice(0, 5).forEach((column, index) => setHeader(sheet, index + 1, 11, 13, column.label));
      sheet.getCell("F11").value = "QUANTITY"; sheet.getCell("G11").value = "QUANTITY"; sheet.getCell("F12").value = "per"; sheet.getCell("G12").value = "per"; sheet.getCell("F13").value = profile.columns[5]!.label; sheet.getCell("G13").value = profile.columns[6]!.label;
      sheet.mergeCells("H11:I12"); sheet.getCell("H11").value = "SHORTAGE/OVERAGE"; sheet.getCell("H13").value = profile.columns[7]!.label; sheet.getCell("I13").value = profile.columns[8]!.label;
      profile.columns.slice(9, 12).forEach((column, index) => setHeader(sheet, index + 10, 11, 13, column.label));
      borderRange(sheet, 11, 13, count);
    }
    const headerFirst = report.family === "rpcsp" ? 10 : 11;
    const headerLast = report.family === "rpcsp" ? 11 : 13;
    const headingRows = report.family === "rpcsp" ? ["A1", "A2", "A3", "A4", "A5"] : ["I1", "A3", "A4", "A5", "A6"];
    const styles = profile.headingStyles;
    [styles?.label, styles?.title, styles?.type, styles?.caption, styles?.date].forEach((style, index) => applyHeadingStyle(sheet.getCell(headingRows[index]!), style));
    if (report.sectionScope?.length) {
      const scopeCell = sheet.getCell(report.family === "rpcsp" ? "A6" : "A7");
      scopeCell.value = "PARTIAL COUNT — SELECTED SECTIONS";
      scopeCell.font = { name: profile.font, size: profile.fontSize, bold: true };
    }
    if (profile.applyHeaderMerges) applyProfileHeaderMerges(sheet, profile.mergedRanges, headerLast, count);
    for (let row = headerFirst; row <= headerLast; row++) for (let col = 1; col <= count; col++) { const cell = sheet.getCell(row, col); cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.font = { name: profile.font, size: profile.fontSize, bold: true }; }
    if (report.family === "rpcsp") sheet.getCell("H10").alignment = { vertical: "middle" };
    if (profile.headerBorders) {
      if (profile.headerBorders.length !== headerLast - headerFirst + 1 || profile.headerBorders.some((row) => row.length !== count)) throw new Error("Profile header border dimensions are invalid.");
      profile.headerBorders.forEach((row, rowIndex) => row.forEach((code, columnIndex) => {
        setBorderCode(sheet.getCell(headerFirst + rowIndex, columnIndex + 1), code);
      }));
    }
    let row = headerLast + 1;
    const included = report.lines.filter((line) => line.section.sheetName === name && line.status === "counted").sort((a, b) => a.section.order - b.section.order || a.lotId.localeCompare(b.lotId));
    let currentSection = ""; let groupStart = row; let groupLines: typeof included = [];
    const groups: Array<{ start: number; end: number; lines: typeof included }> = [];
    const closeGroup = () => {
      const end = row - 1;
      if (row - groupStart > 1) sheet.mergeCells(groupStart, 1, end, 1);
      const lines = groupLines;
      groups.push({ start: groupStart, end, lines });
      if (profile.subtotalAfterSections?.includes(currentSection)) {
        const totals = lines.reduce((sum, line) => ({ card: sum.card + line.snapshot.cardQuantity, physical: sum.physical + line.physicalQuantity!, variance: sum.variance + line.variance!.quantity, cents: sum.cents + BigInt(line.variance!.value!.replace(".", "")), unitCents: sum.unitCents + BigInt(line.snapshot.unitValue!.replace(".", "")) }), { card: 0, physical: 0, variance: 0, cents: 0n, unitCents: 0n });
        if (![totals.card, totals.physical, totals.variance].every(Number.isSafeInteger)) throw new Error("Section totals exceed supported range.");
        const sign = totals.cents < 0n ? "-" : ""; const magnitude = totals.cents < 0n ? -totals.cents : totals.cents;
        sheet.getCell(row, 1).value = "SUBTOTAL";
        if (profile.sumUnitValues) { const unit = `${totals.unitCents / 100n}.${(totals.unitCents % 100n).toString().padStart(2, "0")}`; sheet.getCell(row, 5).value = { formula: `SUM(E${groupStart}:E${end})`, result: currency(unit)! }; sheet.getCell(row, 5).numFmt = report.profile.definition.currencyFormat; }
        for (const [column, result] of [[6, totals.card], [7, totals.physical], [8, totals.variance], [9, currency(`${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`)!]] as const) {
          const letter = sheet.getColumn(column).letter;
          sheet.getCell(row, column).value = { formula: `SUM(${letter}${groupStart}:${letter}${end})`, result };
        }
        sheet.getCell(row, 9).numFmt = report.profile.definition.currencyFormat;
        borderRange(sheet, row, row, count); sheet.getRow(row).font = { name: profile.font, size: profile.fontSize, bold: true }; row++;
      }
    };
    for (const line of included) {
      if (line.section.name !== currentSection) { if (currentSection) closeGroup(); currentSection = line.section.name; groupStart = row; groupLines = []; }
      groupLines.push(line);
      const fragments = countLineText(line, profile);
      for (const [offset, fragment] of fragments.entries()) {
        const first = offset === 0;
        const values = [first ? currentSection : null, fragment.description, first ? line.snapshot.propertyNumber : null, first ? line.snapshot.unit : null, first ? currency(line.snapshot.unitValue) : null, first ? line.snapshot.cardQuantity : null, first ? line.physicalQuantity! : null, first ? line.variance!.quantity : null, first ? currency(line.variance!.value) : null, ...(report.family === "rpcsp" ? [fragment.remarks] : [first ? line.snapshot.supplier ?? "" : null, first ? line.snapshot.yearLabel ?? line.snapshot.acquiredOn?.slice(0, 4) ?? "" : null, fragment.remarks])];
        values.forEach((value, index) => { const cell = sheet.getCell(row, index + 1); cell.value = value; cell.font = { name: profile.font, size: profile.fontSize }; cell.alignment = { vertical: "middle", wrapText: true }; cell.border = thinBorder; if (index === 4 || index === 8) cell.numFmt = report.profile.definition.currencyFormat; });
        if (first) {
          sheet.getCell(row, 8).value = { formula: `G${row}-F${row}`, result: line.variance!.quantity };
          sheet.getCell(row, 9).value = { formula: `H${row}*E${row}`, result: currency(line.variance!.value)! };
        }
        const widthFactor = profile.continuationRows ? Math.min(1, 11 / profile.fontSize) * 0.5 : 1;
        const linesNeeded = Math.max(Array.from(fragment.description).length / Math.max(profile.columns[1]!.width * widthFactor, 1) + (fragment.description.match(/\n/g)?.length ?? 0), Array.from(fragment.remarks).length / Math.max(profile.columns[count - 1]!.width * widthFactor, 1) + (fragment.remarks.match(/\n/g)?.length ?? 0));
        const lineHeight = profile.continuationRows ? Math.max(15, Math.ceil(profile.fontSize * 1.35)) : 15;
        sheet.getRow(row).height = Math.max(18, Math.min(profile.continuationRows ? 300 : 90, lineHeight * Math.ceil(linesNeeded)));
        row++;
      }
    }
    if (currentSection) closeGroup();
    if (profile.detailBorders || profile.detailBordersBySection) {
      if ([profile.detailBorders, ...Object.values(profile.detailBordersBySection ?? {})].some((rule) => rule && Object.values(rule).some((pattern) => pattern.length !== count))) throw new Error("Profile detail border dimensions are invalid.");
      for (const group of groups) for (let detailRow = group.start; detailRow <= group.end; detailRow++) {
        const rules = profile.detailBordersBySection?.[group.lines[0]!.section.name] ?? profile.detailBorders;
        if (!rules) continue;
        const position = group.start === group.end ? "single" : detailRow === group.start ? "first" : detailRow === group.end ? "last" : "middle";
        rules[position].forEach((code, column) => setBorderCode(sheet.getCell(detailRow, column + 1), code));
      }
    }
    for (const group of groups) {
      const article = sheet.getCell(group.start, 1);
      applyHeadingStyle(article, profile.articleStylesBySection?.[group.lines[0]!.section.name] ?? profile.articleStyle);
      if (profile.articleRotation) article.alignment = { ...article.alignment, horizontal: "center", vertical: "middle", wrapText: true, textRotation: profile.articleRotation };
    }
    if (!included.length) { borderRange(sheet, row, row, count); row++; }
    sheet.getCell(row, 1).value = report.family === "rpcppe" && name === "RPCPPE_LAND" ? "GRAND TOTAL" : "TOTAL";
    // Totals are server-owned values derived only from included detail rows.
    const totalRows = included.reduce((total, line) => ({ card: total.card + line.snapshot.cardQuantity, physical: total.physical + line.physicalQuantity!, variance: total.variance + line.variance!.quantity, cents: total.cents + BigInt(line.variance!.value!.replace(".", "")), unitCents: total.unitCents + BigInt(line.snapshot.unitValue!.replace(".", "")) }), { card: 0, physical: 0, variance: 0, cents: 0n, unitCents: 0n });
    if (![totalRows.card, totalRows.physical, totalRows.variance].every(Number.isSafeInteger)) throw new Error("Form totals exceed supported range.");
    const negative = totalRows.cents < 0n; const abs = negative ? -totalRows.cents : totalRows.cents; const totalValue = `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
    if (profile.sumUnitValues) { const unit = `${totalRows.unitCents / 100n}.${(totalRows.unitCents % 100n).toString().padStart(2, "0")}`; const ranges = groups.map((group) => `E${group.start}:E${group.end}`); sheet.getCell(row, 5).value = ranges.length ? { formula: `SUM(${ranges.join(",")})`, result: currency(unit)! } : currency(unit); sheet.getCell(row, 5).numFmt = report.profile.definition.currencyFormat; }
    for (const [column, result] of [[6, totalRows.card], [7, totalRows.physical], [8, totalRows.variance], [9, currency(totalValue)!]] as const) {
      const letter = sheet.getColumn(column).letter;
      const ranges = groups.map((group) => `${letter}${group.start}:${letter}${group.end}`);
      sheet.getCell(row, column).value = ranges.length ? { formula: `SUM(${ranges.join(",")})`, result } : result;
    }
    sheet.getCell(row, 9).numFmt = report.profile.definition.currencyFormat;
    borderRange(sheet, row, row, count); sheet.getRow(row).font = { name: profile.font, size: profile.fontSize, bold: true };
    for (const [status, label] of [["shortage", "SHORTAGE"], ["overage", "OVERAGE"]] as const) {
      row++;
      const selected = included.filter((line) => line.variance!.status === status);
      const quantity = selected.reduce((sum, line) => sum + line.variance!.quantity, 0);
      if (!Number.isSafeInteger(quantity)) throw new Error("Variance totals exceed supported range.");
      const cents = selected.reduce((sum, line) => sum + BigInt(line.variance!.value!.replace(".", "")), 0n);
      const sign = cents < 0n ? "-" : ""; const magnitude = cents < 0n ? -cents : cents;
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 8).value = quantity;
      sheet.getCell(row, 9).value = currency(`${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`);
      sheet.getCell(row, 9).numFmt = report.profile.definition.currencyFormat;
      borderRange(sheet, row, row, count); sheet.getRow(row).font = { name: profile.font, size: profile.fontSize, bold: true };
    }
    const signatureStart = row + 2;
    signatures(sheet, signatureStart, report, profile.signatures);
    for (const extra of profile.signatureExtraMerges ?? []) {
      if (extra.endColumn > count) throw new Error("Signature merge exceeds the form width.");
      const target = signatureStart + extra.rowOffset;
      for (let column = extra.startColumn; column <= extra.endColumn; column++) if (sheet.getCell(target, column).value !== null || sheet.getCell(target, column).isMerged) throw new Error("Signature merge overlaps existing form content.");
      sheet.mergeCells(target, extra.startColumn, target, extra.endColumn);
    }
    const signatureEnd = signatureStart + Math.max(0, ...profile.signatures.map((entry) => entry.rowOffset + 1 + Math.max(entry.designationOffset ?? 1, entry.signatureLabel ? entry.labelOffset ?? 1 : 0)), ...(profile.signatureExtraMerges ?? []).map((entry) => entry.rowOffset));
    let noteRow = 0;
    if (report.family === "rpcppe" && report.profile.definition.thresholdNote) {
      noteRow = profile.thresholdNotePosition ? signatureStart + profile.thresholdNotePosition.rowOffset : signatureEnd + 2;
      const cell = sheet.getCell(noteRow, profile.thresholdNotePosition?.column ?? 1);
      if (cell.value !== null || cell.isMerged) throw new Error("Threshold note overlaps existing form content.");
      cell.value = report.profile.definition.thresholdNote;
      if (profile.thresholdNoteStyle) {
        const style = profile.thresholdNoteStyle;
        cell.font = { name: style.font, size: style.size, bold: style.bold, italic: style.italic, underline: style.underline };
        if (style.alignment) cell.alignment = { horizontal: style.alignment };
      }
      if (report.profile.definition.thresholdExample) {
        const example = sheet.getCell(noteRow + 1, profile.thresholdNotePosition?.column ?? 1);
        if (example.value !== null || example.isMerged) throw new Error("Threshold example overlaps existing form content.");
        example.value = report.profile.definition.thresholdExample;
        if (profile.thresholdNoteStyle) example.font = { ...cell.font };
        noteRow++;
      }
    }
    const lastRow = Math.max(signatureEnd, noteRow) + 1;
    sheet.pageSetup.printArea = `A1:${lastColumn}${lastRow}`;
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const result = Buffer.from(bytes);
  verifyCountWorkbook(result, report);
  return result;
}

const stockCardSchema = z.object({
  entity: text, fundCluster: text, office: text.nullable(), asOfDate: z.iso.date(),
  item: z.object({ code: text, article: text, description: text, unit: text, reorderPoint: z.number().int().nonnegative().nullable() }),
  profile: z.object({ family: z.literal("stock_card"), definition: custodialProfileDefinition }),
  entries: z.array(z.object({ id: z.uuid(), effectiveDate: z.iso.date(), sequence: z.number().int().nonnegative(), reference: text, office: text, delta: z.number().int(), balanceAfter: z.number().int().nonnegative(), daysToConsume: z.number().int().nonnegative().nullable() })),
});
function stockLineText(entry: z.infer<typeof stockCardSchema>["entries"][number], profile: CountProfileSheet) {
  const references = splitReportText(entry.reference, profile.columns[1]!.width, 12, profile.continuationRows ?? false);
  const offices = splitReportText(entry.office, profile.columns[4]!.width, 12, profile.continuationRows ?? false);
  return Array.from({ length: Math.max(references.length, offices.length) }, (_, index) => ({ reference: references[index] ?? "", office: offices[index] ?? "" }));
}
function stockLineHeight(fragment: { reference: string; office: string }, profile: CountProfileSheet) {
  if (!profile.continuationRows) return 20;
  const widthFactor = Math.min(1, 11 / 12) * 0.5;
  const lines = Math.max(Array.from(fragment.reference).length / Math.max(profile.columns[1]!.width * widthFactor, 1) + (fragment.reference.match(/\n/g)?.length ?? 0), Array.from(fragment.office).length / Math.max(profile.columns[4]!.width * widthFactor, 1) + (fragment.office.match(/\n/g)?.length ?? 0));
  return Math.max(20, Math.min(300, 17 * Math.ceil(lines)));
}

/** Render a stock-card draft from an already frozen, chronological card payload. */
export async function renderCustodialStockCardWorkbook(payload: unknown): Promise<Buffer> {
  const card = stockCardSchema.parse(payload);
  if (card.profile.definition.sheets.length !== 1 || card.profile.definition.sheets[0]?.name !== "SC") throw new Error("Stock-card profile is invalid.");
  const profile = card.profile.definition.sheets[0];
  if (profile.columns.length !== 7 || profile.orientation !== "portrait") throw new Error("Stock-card profile geometry is invalid.");
  let balance = 0;
  let previous: (typeof card.entries)[number] | undefined;
  for (const entry of card.entries) {
    if (!Number.isSafeInteger(entry.delta) || entry.delta === 0 || entry.effectiveDate > card.asOfDate) throw new Error("Stock-card entry is invalid.");
    if (previous && (entry.effectiveDate < previous.effectiveDate || (entry.effectiveDate === previous.effectiveDate && (entry.sequence < previous.sequence || (entry.sequence === previous.sequence && entry.id <= previous.id))))) throw new Error("Stock-card entries are not in chronological order.");
    balance += entry.delta;
    if (!Number.isSafeInteger(balance) || balance < 0 || balance !== entry.balanceAfter) throw new Error("Stock-card running balance is invalid.");
    previous = entry;
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MATMS";
  const sheet = workbook.addWorksheet("SC", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { ...profile.margins, header: 0.3, footer: 0.3 }, printTitlesRow: "1:12" }, headerFooter: { oddFooter: "Page &P of &N" } });
  profile.columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  sheet.getCell("G1").value = profile.label; sheet.getCell("G1").font = { name: "Times New Roman", size: 16 }; sheet.getCell("G1").alignment = { horizontal: "right" };
  mergeText(sheet, "A4:G4", profile.reportTitle ?? "STOCK CARD", 14, true); sheet.getCell("A4").font = { name: "Times New Roman", size: 14, bold: true };
  sheet.getCell("A6").value = `Entity Name: ${card.entity}`; sheet.getCell("E6").value = `Fund Cluster: ${card.fundCluster}`;
  sheet.getCell("A8").value = `Item: ${card.item.article}`; sheet.getCell("E8").value = `Stock No.: ${card.item.code}`;
  sheet.getCell("A9").value = `Description: ${card.item.description}`; sheet.getCell("E9").value = `Re-order Point: ${card.item.reorderPoint === null ? "" : card.item.reorderPoint}`;
  sheet.getCell("A10").value = `Unit of Measurement: ${card.item.unit}`;
  sheet.getCell("E10").value = `Office scope: ${card.office ?? "All offices"}`;
  setHeader(sheet, 1, 11, 12, "Date"); setHeader(sheet, 2, 11, 12, "Reference");
  sheet.getCell("C11").value = "Receipt"; sheet.getCell("C12").value = "Qty.";
  sheet.mergeCells("D11:E11"); sheet.getCell("D11").value = "Issue"; sheet.getCell("D12").value = "Qty."; sheet.getCell("E12").value = "Office";
  sheet.getCell("F11").value = "Balance"; sheet.getCell("F12").value = "Qty."; setHeader(sheet, 7, 11, 12, "No. of Days to Consume");
  borderRange(sheet, 11, 12, 7);
  if (profile.applyHeaderMerges) applyProfileHeaderMerges(sheet, profile.mergedRanges, 12, 7);
  for (let row = 11; row <= 12; row++) for (let col = 1; col <= 7; col++) { const cell = sheet.getCell(row, col); cell.font = { name: "Times New Roman", size: 12, bold: true }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; }
  let row = 13; let pageRows = 0; let pageHeight = 0;
  const pageCapacity = profile.stockCardPageRows ?? 26;
  // Reserve space for repeated headers, footer and renderer differences on A4.
  const pageHeightCapacity = Math.min(400, 842 - 72 * (profile.margins.top + profile.margins.bottom) - 300);
  if (pageHeightCapacity < 40) throw new Error("Stock-card margins leave insufficient room for report rows.");
  for (const [index, entry] of card.entries.entries()) {
    for (const [offset, fragment] of stockLineText(entry, profile).entries()) {
      const height = stockLineHeight(fragment, profile);
      if (height + 20 > pageHeightCapacity) throw new Error("Stock-card row cannot fit with its carry-forward; review profile margins or column widths.");
      if (pageRows === pageCapacity || pageHeight + height > pageHeightCapacity) {
        sheet.getRow(row - 1).addPageBreak();
        const carry = [null, "Balance brought forward", null, null, null, offset ? entry.balanceAfter : card.entries[index - 1]!.balanceAfter, null];
        carry.forEach((value, column) => { const cell = sheet.getCell(row, column + 1); cell.value = value; cell.font = { name: "Times New Roman", size: 12 }; cell.border = thinBorder; cell.alignment = { vertical: "middle", wrapText: true }; });
        sheet.getRow(row).height = 20; row++; pageRows = 1; pageHeight = 20;
      }
      const first = offset === 0;
      const values = [first ? new Date(`${entry.effectiveDate}T00:00:00.000Z`) : null, fragment.reference, first && entry.delta > 0 ? entry.delta : null, first && entry.delta < 0 ? -entry.delta : null, fragment.office, first ? entry.balanceAfter : null, first ? entry.daysToConsume : null];
      values.forEach((value, column) => { const cell = sheet.getCell(row, column + 1); cell.value = value; cell.font = { name: "Times New Roman", size: 12 }; cell.border = thinBorder; cell.alignment = { vertical: "middle", wrapText: true }; });
      if (first) sheet.getCell(row, 1).numFmt = card.profile.definition.dateFormat;
      sheet.getRow(row).height = height;
      row++; pageRows++; pageHeight += height;
    }
  }
  const lastRow = card.entries.length ? row - 1 : 45;
  if (row <= lastRow) borderRange(sheet, row, lastRow, 7);
  sheet.pageSetup.printArea = `A1:G${lastRow}`;
  const result = Buffer.from(await workbook.xlsx.writeBuffer());
  const reopened = XLSX.read(result, { type: "buffer", cellDates: true, cellFormula: true });
  if (reopened.SheetNames.length !== 1 || reopened.SheetNames[0] !== "SC") throw new Error("Generated Stock Card sheet failed verification.");
  const actual = reopened.Sheets.SC!;
  let actualRow = 13, actualPageRows = 0, actualPageHeight = 0;
  for (const [index, entry] of card.entries.entries()) {
    for (const [offset, fragment] of stockLineText(entry, profile).entries()) {
      const height = stockLineHeight(fragment, profile);
      if (actualPageRows === pageCapacity || actualPageHeight + height > pageHeightCapacity) {
        const balance = offset ? entry.balanceAfter : card.entries[index - 1]!.balanceAfter;
        if (actual[`B${actualRow}`]?.v !== "Balance brought forward" || actual[`F${actualRow}`]?.v !== balance || actual[`C${actualRow}`] || actual[`D${actualRow}`]) throw new Error("Generated Stock Card carry-forward failed verification.");
        actualRow++; actualPageRows = 1; actualPageHeight = 20;
      }
      const current = actualRow++;
      actualPageRows++; actualPageHeight += height;
      const first = offset === 0;
      const date = actual[`A${current}`]?.v;
      if (first ? !(date instanceof Date) || date.toISOString().slice(0, 10) !== entry.effectiveDate : date != null) throw new Error("Generated Stock Card date failed verification.");
      for (const [column, value] of [["B", fragment.reference], ["C", first && entry.delta > 0 ? entry.delta : null], ["D", first && entry.delta < 0 ? -entry.delta : null], ["E", fragment.office], ["F", first ? entry.balanceAfter : null], ["G", first ? entry.daysToConsume : null]] as const) if ((actual[`${column}${current}`]?.v ?? (column === "B" || column === "E" ? "" : null)) !== value) throw new Error("Generated Stock Card value failed verification.");
    }
  }
  for (const [address, cell] of Object.entries(actual)) if (!address.startsWith("!") && cell && typeof cell === "object" && "f" in cell && typeof cell.f === "string") throw new Error("Generated Stock Card contains an unexpected formula.");
  return result;
}
