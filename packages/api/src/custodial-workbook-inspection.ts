import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { calculatePhysicalCountVariance } from "./physical-count-calculation";

type CellEvidence = { address: string; value: string | number | boolean | null; formula: string | null; kind: "number" | "text" | "boolean" | "missing" | "other" };
type InspectionRow = { sheet: string; row: number; section: string | null; fields: Record<string, CellEvidence>; warnings: string[]; variance: { quantity: number; value: string | null } | null };
export type WorkbookInspection = { family: "stock_card" | "rpcsp" | "rpcppe"; sourceHash: string; sheets: Array<{ name: string; rows: InspectionRow[]; metadata: Record<string, CellEvidence>; signatures: CellEvidence[] }>; warnings: string[] };

const expectedSheets = { stock_card: ["SC"], rpcsp: ["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"], rpcppe: ["RPCPPE_LAND", "RPCPPE_BLDG", "RPCPPE_OTHERBLDG"] } as const;
const standard = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
function evidence(sheet: XLSX.WorkSheet, address: string): CellEvidence {
  const cell = sheet[address] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return { address, value: null, formula: cell?.f ?? null, kind: "missing" };
  const kind = typeof cell.v === "number" ? "number" : typeof cell.v === "string" ? "text" : typeof cell.v === "boolean" ? "boolean" : "other";
  return { address, value: kind === "other" ? String(cell.v) : cell.v as string | number | boolean, formula: cell.f ?? null, kind };
}
function nonnegativeInteger(cell: CellEvidence): number | null {
  return cell.kind === "number" && typeof cell.value === "number" && Number.isSafeInteger(cell.value) && cell.value >= 0 && cell.value <= 2147483647 ? cell.value : null;
}
function decimal(cell: CellEvidence): string | null {
  if (cell.kind !== "number" || typeof cell.value !== "number" || !Number.isFinite(cell.value) || cell.value < 0 || cell.value > 9999999999999.99) return null;
  const cents = Math.round(cell.value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cell.value * 100 - cents) > 0.000001) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
function sourceSection(sheet: XLSX.WorkSheet, row: number): string | null {
  const merge = (sheet["!merges"] ?? []).find((range) => range.s.c === 0 && range.e.c === 0 && range.s.r <= row - 1 && range.e.r >= row - 1);
  const sourceRow = merge ? merge.s.r + 1 : row;
  const value = evidence(sheet, `A${sourceRow}`).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function validateHeaders(sheet: XLSX.WorkSheet, family: WorkbookInspection["family"]) {
  if (family === "stock_card") return standard(sheet.A4?.v) === "STOCK CARD" && standard(sheet.A11?.v) === "DATE" && standard(sheet.B11?.v) === "REFERENCE" && standard(sheet.D11?.v) === "ISSUE" && standard(sheet.F11?.v) === "BALANCE";
  const row = family === "rpcsp" ? 10 : 11;
  return standard(sheet[`A${row}`]?.v) === "ARTICLE" && standard(sheet[`B${row}`]?.v) === "DESCRIPTION" && standard(sheet[`C${row}`]?.v).includes("PROPERTY") && standard(sheet[`D${row}`]?.v).includes("UNIT") && standard(sheet[`E${row}`]?.v).includes("VALUE") && standard(sheet[`H${family === "rpcsp" ? 11 : 13}`]?.v) === "QUANTITY" && standard(sheet[`I${family === "rpcsp" ? 11 : 13}`]?.v) === "VALUE";
}

/**
 * Inspection for trusted, local reference fixtures only. This is deliberately
 * not an upload parser: ZIP expansion, encrypted files and time/memory limits
 * must be enforced before accepting untrusted bytes in a separate worker.
 */
export function inspectTrustedInventoryWorkbook(bytes: Uint8Array, filename: string, options: { classificationThreshold?: string } = {}): WorkbookInspection {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("Reference workbook size is unsupported.");
  if (options.classificationThreshold !== undefined && !/^\d{1,13}(?:\.\d{1,2})?$/.test(options.classificationThreshold)) throw new Error("Classification threshold is invalid.");
  const lower = filename.toLowerCase();
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => bytes[index] === byte);
  if (!(zip && lower.endsWith(".xlsx")) && !(cfb && lower.endsWith(".xls"))) throw new Error("File extension and workbook format do not match.");
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(bytes, { type: "buffer", cellFormula: true, bookVBA: true, sheetRows: 5001, WTF: true }); } catch { throw new Error("Workbook is malformed, encrypted or unsupported."); }
  if (workbook.vbaraw || workbook.SheetNames.length > 3 || workbook.SheetNames.length === 0) throw new Error("Workbook contains unsupported content.");
  const family = (Object.keys(expectedSheets) as WorkbookInspection["family"][]).find((candidate) => expectedSheets[candidate].length === workbook.SheetNames.length && expectedSheets[candidate].every((name, index) => workbook.SheetNames[index] === name));
  if (!family || (family !== "stock_card" && !zip)) throw new Error("Workbook structure is unsupported.");
  const output: WorkbookInspection = { family, sourceHash: createHash("sha256").update(bytes).digest("hex"), sheets: [], warnings: [] };
  // A producer marker only proposes continuation grouping; every such grouping still requires operator review.
  const matmsProducer = workbook.Props?.Author === "MATMS";
  const seen = new Map<string, InspectionRow[]>();
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !validateHeaders(sheet, family)) throw new Error("Required workbook headers are missing.");
    if (sheet["!fullref"]) throw new Error("Workbook exceeds the supported row limit.");
    const rows: InspectionRow[] = [];
    const anchors = family === "stock_card" ? ["A6", "E6", "A8", "E8", "A9", "E9", "A10"] : family === "rpcsp" ? ["A3", "A5", "A7", "F7", "A8"] : ["A4", "A6", "A8", "G8", "A9"];
    const metadata = Object.fromEntries(anchors.map((address) => [address, evidence(sheet, address)]));
    const signatureAnchors = Object.entries(sheet).filter(([address, cell]) => /^[A-L]\d+$/.test(address) && cell && typeof cell === "object" && "v" in cell && /^(CERTIFIED CORRECT BY:?|NOTED BY:?)$/.test(standard(cell.v))).map(([address]) => XLSX.utils.decode_cell(address).r);
    if (signatureAnchors.length > 20) throw new Error("Workbook has too many signature blocks.");
    const signatures: CellEvidence[] = [];
    const signatureAddresses = new Set<string>();
    for (const anchor of [...new Set(signatureAnchors)]) for (let row = anchor; row <= Math.min(anchor + 8, 4999); row++) for (let column = 0; column < (family === "rpcppe" ? 12 : 10); column++) {
      const cell = evidence(sheet, XLSX.utils.encode_cell({ r: row, c: column }));
      if ((cell.value !== null || cell.formula) && !signatureAddresses.has(cell.address)) { signatures.push(cell); signatureAddresses.add(cell.address); }
    }
    output.sheets.push({ name, rows, metadata, signatures });
    if (family === "stock_card") {
      const end = Math.min(XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e.r + 1, 5000);
      const keys = ["date", "reference", "receiptQuantity", "issueQuantity", "office", "balanceQuantity", "daysToConsume"];
      for (let row = 13; row <= end; row++) {
        const fields = Object.fromEntries(keys.map((key, index) => [key, evidence(sheet, `${XLSX.utils.encode_col(index)}${row}`)]));
        if (Object.values(fields).every((cell) => cell.value === null && !cell.formula)) continue;
        if (standard(fields.reference!.value) === "BALANCE BROUGHT FORWARD" && ["date", "receiptQuantity", "issueQuantity", "office", "daysToConsume"].every((key) => fields[key]!.value === null && !fields[key]!.formula) && fields.balanceQuantity!.kind === "number" && !fields.balanceQuantity!.formula && !fields.reference!.formula) {
          output.warnings.push(`STOCK_CARD_CARRY_FORWARD_IGNORED:${name}!B${row}`);
          continue;
        }
        const previous = rows[rows.length - 1];
        if (matmsProducer && previous && ["date", "receiptQuantity", "issueQuantity", "balanceQuantity", "daysToConsume"].every((key) => fields[key]!.value === null && !fields[key]!.formula) && ["reference", "office"].some((key) => fields[key]!.value !== null) && ["reference", "office"].every((key) => !fields[key]!.formula)) {
          if (fields.reference!.value !== null) previous.fields[`referenceContinuation_${row}`] = fields.reference!;
          if (fields.office!.value !== null) previous.fields[`officeContinuation_${row}`] = fields.office!;
          if (!previous.warnings.includes("CONTINUATION_ROWS_REQUIRE_REVIEW")) previous.warnings.push("CONTINUATION_ROWS_REQUIRE_REVIEW");
          continue;
        }
        rows.push({ sheet: name, row, section: null, fields, warnings: ["STOCK_CARD_TRANSACTION_REQUIRES_REVIEW"], variance: null });
      }
      continue;
    }
    const first = family === "rpcsp" ? 12 : 14;
    const end = Math.min(XLSX.utils.decode_range(sheet["!ref"] ?? "A1").e.r + 1, 5000);
    const columns = family === "rpcsp" ? ["article", "description", "propertyNumber", "unit", "unitValue", "cardQuantity", "physicalQuantity", "sourceVarianceQuantity", "sourceVarianceValue", "remarks"] : ["article", "description", "propertyNumber", "unit", "unitValue", "cardQuantity", "physicalQuantity", "sourceVarianceQuantity", "sourceVarianceValue", "supplier", "yearAcquired", "remarks"];
    let priorTotal = false, continuationTarget: InspectionRow | null = null;
    for (let row = first; row <= end; row++) {
      const a = evidence(sheet, `A${row}`); const b = evidence(sheet, `B${row}`);
      if (/^(CERTIFIED CORRECT|CERTIFIED BY|NOTED BY)/.test(standard(a.value)) || /^(CERTIFIED CORRECT|CERTIFIED BY|NOTED BY)/.test(standard(b.value))) break;
      const totalAtA = /^(?:(?:GRAND|SUB)\s*)?TOTAL\b/.test(standard(a.value));
      const totalAtB = /^(?:(?:GRAND|SUB)\s*)?TOTAL\b/.test(standard(b.value));
      const noIdentity = ["C", "D"].every((column) => { const cell = evidence(sheet, `${column}${row}`); return cell.value === null && !cell.formula; });
      if (noIdentity && ((totalAtA && b.value === null && !b.formula) || (totalAtB && a.value === null && !a.formula))) {
        continuationTarget = null;
        for (const col of ["E", "F", "G", "H", "I"]) {
          const formula = evidence(sheet, `${col}${row}`).formula;
          if (!formula) continue;
          output.warnings.push(`SOURCE_TOTAL_FORMULA_UNTRUSTED:${name}!${col}${row}`);
          const range = /^SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)$/i.exec(formula);
          if (!priorTotal && range && (Number(range[1]) > first || Number(range[2]) < row - 1)) output.warnings.push(`SOURCE_TOTAL_RANGE_INCOMPLETE:${name}!${col}${row}`);
        }
        priorTotal = true;
        continue;
      }
      const fields = Object.fromEntries(columns.map((key, index) => [key, evidence(sheet, `${XLSX.utils.encode_col(index)}${row}`)]));
      if (["SHORTAGE", "OVERAGE"].includes(standard(a.value)) && columns.slice(1, 7).every((key) => fields[key]!.value === null && !fields[key]!.formula)) { output.warnings.push(`SOURCE_VARIANCE_SUMMARY_IGNORED:${name}!A${row}`); continuationTarget = null; continue; }
      const detail = columns.slice(1).some((key) => fields[key]!.value !== null || fields[key]!.formula !== null);
      if (!detail) continue;
      const remarksCell = fields.remarks!;
      if (matmsProducer && continuationTarget && a.value === null && !a.formula && columns.slice(2, -1).every((key) => fields[key]!.value === null && !fields[key]!.formula) && (b.value !== null || remarksCell.value !== null) && !b.formula && !remarksCell.formula) {
        if (b.value !== null) continuationTarget.fields[`descriptionContinuation_${row}`] = b;
        if (remarksCell.value !== null) continuationTarget.fields[`remarksContinuation_${row}`] = remarksCell;
        if (!continuationTarget.warnings.includes("CONTINUATION_ROWS_REQUIRE_REVIEW")) continuationTarget.warnings.push("CONTINUATION_ROWS_REQUIRE_REVIEW");
        continue;
      }
      if (family === "rpcppe" && name === "RPCPPE_LAND" && row === 15 && b.value !== null && columns.slice(2).every((key) => fields[key]!.value === null && !fields[key]!.formula) && rows.length) {
        const previous = rows[rows.length - 1]!;
        previous.warnings.push("DESCRIPTION_CONTINUATION");
        previous.fields.continuation = b;
        continue;
      }
      const item: InspectionRow = { sheet: name, row, section: family === "rpcsp" ? sourceSection(sheet, row) : name, fields, warnings: [], variance: null };
      continuationTarget = item;
      if (fields.physicalQuantity!.formula) item.warnings.push("FORMULA_DERIVED_PHYSICAL_COUNT");
      if (fields.cardQuantity!.formula) item.warnings.push("FORMULA_DERIVED_CARD_QUANTITY");
      for (const key of ["unitValue", "cardQuantity", "physicalQuantity"]) if (fields[key]!.value === "-") item.warnings.push(`${key.toUpperCase()}_PLACEHOLDER`);
      const card = nonnegativeInteger(fields.cardQuantity!); const physical = nonnegativeInteger(fields.physicalQuantity!); const value = decimal(fields.unitValue!);
      if (card !== null && physical !== null) {
        const calculated = calculatePhysicalCountVariance({ cardQuantity: card, physicalQuantity: physical, unitValue: value });
        item.variance = { quantity: calculated.quantity, value: calculated.value };
        const source = fields.sourceVarianceQuantity!;
        if (typeof source.value === "number" && source.value !== calculated.quantity) item.warnings.push("SOURCE_VARIANCE_MISMATCH");
        const sourceValue = fields.sourceVarianceValue!;
        if (sourceValue.formula) item.warnings.push("SOURCE_VARIANCE_FORMULA_UNTRUSTED");
        if (typeof sourceValue.value === "number" && calculated.value !== null && Math.abs(sourceValue.value - Number(calculated.value)) > 0.000001) item.warnings.push("SOURCE_VARIANCE_VALUE_MISMATCH");
      }
      if (fields.unitValue!.value === null || fields.unitValue!.value === "-") item.warnings.push("UNIT_VALUE_UNAVAILABLE");
      if (fields.unitValue!.kind === "number" && value === null) item.warnings.push("INVALID_UNIT_VALUE");
      if (card === null) item.warnings.push("CARD_QUANTITY_UNAVAILABLE");
      if (physical === null) item.warnings.push("PHYSICAL_QUANTITY_UNAVAILABLE");
      if (fields.unit!.value === null || fields.unit!.value === "-") item.warnings.push("UNIT_UNAVAILABLE");
      if (options.classificationThreshold && value !== null && family === "rpcsp") {
        const [whole, fraction = ""] = options.classificationThreshold.split(".");
        const threshold = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
        if (BigInt(value.replace(".", "")) >= threshold) item.warnings.push("CLASSIFICATION_THRESHOLD_CONFLICT");
      }
      const remarks = standard(fields.remarks!.value);
      if (/SERVICEABLE/.test(remarks) && /(NON.?FUNCTIONAL|UNSERVICEABLE|NOT FUNCTIONAL)/.test(remarks)) item.warnings.push("MIXED_CONDITION_REVIEW");
      if (family === "rpcppe" && typeof fields.yearAcquired!.value === "string" && /[,–-]/.test(fields.yearAcquired!.value)) item.warnings.push("YEAR_LABEL_REQUIRES_REVIEW");
      const number = fields.propertyNumber!.value;
      if (typeof number === "string" && number.trim()) {
        const key = number.trim().toUpperCase(); const duplicates = seen.get(key) ?? []; duplicates.push(item); seen.set(key, duplicates);
      } else item.warnings.push(typeof number === "number" ? "PROPERTY_NUMBER_NUMERIC_REVIEW" : "PROPERTY_NUMBER_UNAVAILABLE");
      rows.push(item);
    }
  }
  for (const group of seen.values()) if (group.length > 1) for (const row of group) row.warnings.push("DUPLICATE_PROPERTY_NUMBER");
  return output;
}
