import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { inspectTrustedInventoryWorkbook } from "./custodial-workbook-inspection";

const toBytes = (value: Buffer) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
const sourceNames = ["Appendix 58 - SC.xls", "RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx", "RPCPPE 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL (1).xlsx"];
function fictionalWorkbook() {
  const workbook = XLSX.utils.book_new();
  for (const name of ["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"]) {
    const cells: unknown[][] = Array.from({ length: 16 }, () => []);
    cells[4] = ["As of a fictional date"];
    cells[9] = ["ARTICLE", "DESCRIPTION", "Semi-expendable Property No.", "UNIT OF MEASURE", "UNIT VALUE", "Balance Per PROPERTY CARD", "On Hand Per Count"];
    cells[10] = [null, null, null, null, null, null, null, "Quantity", "Value"];
    cells[11] = ["FICTIONAL GROUP", "Test item", "000-01", "piece", 1250, 10, 8, 9, -1000, "serviceable and nonfunctional"];
    cells[12] = [null, "Second item", "000-01", "piece", "-", 5, 4, 1, null, ""];
    cells[14] = ["Certified Correct by:"];
    cells[15] = ["Fictional signatory"];
    const sheet = XLSX.utils.aoa_to_sheet(cells);
    sheet["!merges"] = [XLSX.utils.decode_range("A12:A13")];
    sheet.G12 = { t: "n", v: 8, f: "F12" };
    sheet.I12 = { t: "n", v: -1000, f: "H12+E12" };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return toBytes(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

describe("trusted workbook inspection", () => {
  test("retains evidence while recalculating and flags review cases", () => {
    const result = inspectTrustedInventoryWorkbook(fictionalWorkbook(), "fictional.xlsx", { classificationThreshold: "500.00" });
    expect(result.family).toBe("rpcsp");
    expect(result.sheets).toHaveLength(3);
    expect(result.sheets[0]!.metadata.A5?.value).toBe("As of a fictional date");
    expect(result.sheets[0]!.signatures.map((entry) => entry.value)).toContain("Fictional signatory");
    const row = result.sheets[0]!.rows[0]!;
    expect(row.section).toBe("FICTIONAL GROUP");
    expect(row.fields.propertyNumber?.value).toBe("000-01");
    expect(row.fields.physicalQuantity?.formula).toBe("F12");
    expect(row.variance).toEqual({ quantity: -2, value: "-2500.00" });
    expect(row.warnings).toContain("SOURCE_VARIANCE_MISMATCH");
    expect(row.warnings).toContain("SOURCE_VARIANCE_VALUE_MISMATCH");
    expect(row.warnings).toContain("FORMULA_DERIVED_PHYSICAL_COUNT");
    expect(row.warnings).toContain("SOURCE_VARIANCE_FORMULA_UNTRUSTED");
    expect(row.warnings).toContain("DUPLICATE_PROPERTY_NUMBER");
    expect(row.warnings).toContain("CLASSIFICATION_THRESHOLD_CONFLICT");
    expect(row.warnings).toContain("MIXED_CONDITION_REVIEW");
    expect(result.sheets[0]!.rows[1]!.fields.unitValue?.value).toBe("-");
    expect(result.sheets[0]!.rows[1]!.variance?.value).toBeNull();
  });
  test("rejects invalid format, size and threshold", () => {
    const fixture = fictionalWorkbook();
    expect(() => inspectTrustedInventoryWorkbook(fixture, "wrong.xls")).toThrow();
    expect(() => inspectTrustedInventoryWorkbook(new Uint8Array(0), "empty.xlsx")).toThrow();
    expect(() => inspectTrustedInventoryWorkbook(fixture, "fictional.xlsx", { classificationThreshold: "not-money" })).toThrow();
  });
  test.skipIf(!sourceNames.every(existsSync))("inspects all supplied source variants and known anomalies", () => {
    const stock = inspectTrustedInventoryWorkbook(toBytes(readFileSync(sourceNames[0]!)), sourceNames[0]!);
    expect(stock.sourceHash).toBe("f350dce16a51e34685bfa530c33a194b7b453248e23f07c90424265dfe166f94");
    expect(stock.sheets[0]!.rows).toHaveLength(0);
    const rpcsp = inspectTrustedInventoryWorkbook(toBytes(readFileSync(sourceNames[1]!)), sourceNames[1]!, { classificationThreshold: "50000.00" });
    expect(rpcsp.sheets.map((sheet) => sheet.name)).toEqual(["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"]);
    expect(rpcsp.sheets.reduce((sum, sheet) => sum + new Set(sheet.rows.map((row) => row.section)).size, 0)).toBe(11);
    const ff = rpcsp.sheets[1]!;
    expect(ff.rows.find((row) => row.row === 14)?.variance?.quantity).toBe(-55);
    expect(ff.rows.find((row) => row.row === 14)?.warnings).toContain("SOURCE_VARIANCE_MISMATCH");
    expect(ff.rows.find((row) => row.row === 12)?.warnings).toContain("DUPLICATE_PROPERTY_NUMBER");
    expect(rpcsp.sheets[0]!.rows.find((row) => row.row === 22)?.warnings).toContain("CLASSIFICATION_THRESHOLD_CONFLICT");
    expect(rpcsp.warnings).toContain("SOURCE_TOTAL_RANGE_INCOMPLETE:RPCSP_ OTHERSUPPLIES!E172");
    const ppe = inspectTrustedInventoryWorkbook(toBytes(readFileSync(sourceNames[2]!)), sourceNames[2]!);
    expect(ppe.sheets.map((sheet) => sheet.name)).toEqual(["RPCPPE_LAND", "RPCPPE_BLDG", "RPCPPE_OTHERBLDG"]);
    expect(ppe.sheets[0]!.rows).toHaveLength(1);
    expect(ppe.sheets[0]!.rows[0]!.fields.continuation?.address).toBe("B15");
    expect(ppe.sheets[2]!.rows.find((row) => row.row === 15)?.warnings).toContain("YEAR_LABEL_REQUIRES_REVIEW");
  });
});
