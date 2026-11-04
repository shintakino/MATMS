import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { inspectIsolatedInventoryWorkbook } from "./custodial-import-isolation";

const worker = fileURLToPath(new URL("../../../apps/server/src/custodial-import-worker.ts", import.meta.url).href);
const hangingWorker = fileURLToPath(new URL("../../../tests/fixtures/import-hang.ts", import.meta.url).href);
const builtWorker = fileURLToPath(new URL("../../../apps/server/dist/custodial-import-worker.mjs", import.meta.url).href);
function stockCard(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const rows: unknown[][] = Array.from({ length: 12 }, () => []);
  rows[3] = ["STOCK CARD"];
  rows[10] = ["Date", "Reference", "Receipt", "Issue", null, "Balance", "No. of Days to Consume"];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "SC");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
function stockCardWithContinuations(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Author: "MATMS" };
  const rows: unknown[][] = Array.from({ length: 12 }, () => []);
  rows[3] = ["STOCK CARD"];
  rows[10] = ["Date", "Reference", "Receipt", "Issue", null, "Balance", "No. of Days to Consume"];
  rows.push([1, "First part ", 10, null, "Office ", 10], [null, "second ", null, null, "continued"], [null, "Balance brought forward", null, null, null, 10], [null, "third", null, null, null]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "SC");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("isolated workbook inspection", () => {
  test("inspects a supported file and rejects malformed or excessive input", async () => {
    const valid = await inspectIsolatedInventoryWorkbook(stockCard(), "fictional.xlsx", worker);
    expect(valid.family).toBe("stock_card");
    expect(valid.sheets[0]!.rows).toHaveLength(0);
    await expect(inspectIsolatedInventoryWorkbook(new Uint8Array([80, 75, 3, 4]), "broken.xlsx", worker)).rejects.toThrow();
    await expect(inspectIsolatedInventoryWorkbook(new Uint8Array(8 * 1024 * 1024 + 1), "large.xlsx", worker)).rejects.toThrow();
    await expect(inspectIsolatedInventoryWorkbook(stockCard(), "../escape.xlsx", worker)).rejects.toThrow();
  }, 30000);
  test("limits concurrent parser processes", async () => {
    const bytes = stockCard();
    const first = inspectIsolatedInventoryWorkbook(bytes, "one.xlsx", worker);
    const second = inspectIsolatedInventoryWorkbook(bytes, "two.xlsx", worker);
    await expect(inspectIsolatedInventoryWorkbook(bytes, "three.xlsx", worker)).rejects.toThrow("busy");
    const results = await Promise.all([first, second]);
    expect(results.map((entry) => entry.family)).toEqual(["stock_card", "stock_card"]);
  }, 30000);
  test("terminates an unresponsive parser and releases its slot", async () => {
    const started = performance.now();
    await expect(inspectIsolatedInventoryWorkbook(stockCard(), "fictional.xlsx", hangingWorker, undefined, 300)).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(5000);
    expect((await inspectIsolatedInventoryWorkbook(stockCard(), "fictional.xlsx", worker)).family).toBe("stock_card");
  }, 30000);
  test.skipIf(!existsSync(builtWorker))("runs the bundled server worker", async () => {
    expect((await inspectIsolatedInventoryWorkbook(stockCard(), "fictional.xlsx", builtWorker)).family).toBe("stock_card");
    const inspected = await inspectIsolatedInventoryWorkbook(stockCardWithContinuations(), "fictional.xlsx", builtWorker);
    expect(inspected.sheets[0]!.rows).toHaveLength(1);
    expect(inspected.sheets[0]!.rows[0]!.warnings).toContain("CONTINUATION_ROWS_REQUIRE_REVIEW");
    expect(inspected.warnings.some((warning) => warning.startsWith("STOCK_CARD_CARRY_FORWARD_IGNORED:"))).toBe(true);
  }, 30000);
  const sources = ["Appendix 58 - SC.xls", "RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx", "RPCPPE 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL (1).xlsx"];
  test.skipIf(!sources.every(existsSync))("inspects all supplied formats within the process limit", async () => {
    for (const [index, name] of sources.entries()) {
      const file = readFileSync(name);
      const result = await inspectIsolatedInventoryWorkbook(new Uint8Array(file.buffer, file.byteOffset, file.byteLength), name, worker);
      expect(result.family).toBe((["stock_card", "rpcsp", "rpcppe"] as const)[index]!);
    }
  }, 30000);
});
