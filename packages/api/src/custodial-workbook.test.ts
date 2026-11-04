import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { renderCustodialCountWorkbook, renderCustodialStockCardWorkbook } from "./custodial-workbook";
import { custodialProfileDefinition } from "./custodial-service";
import { formatProfileAsOf, inventoryProfileTemplate } from "./inventory-profile-templates";
import { inspectTrustedInventoryWorkbook } from "./custodial-workbook-inspection";

const stockCardReference = fileURLToPath(new URL("../../../Appendix 58 - SC.xls", import.meta.url).href);
const countReferences = {
  rpcsp: fileURLToPath(new URL("../../../RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx", import.meta.url).href),
  rpcppe: fileURLToPath(new URL("../../../RPCPPE 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL (1).xlsx", import.meta.url).href),
};
const hasCountReferences = Object.values(countReferences).every((path) => existsSync(path));

const signatures = (["custodian", "committee_chair", "committee_member", "school_head"] as const).map((role, index) => ({ role, startColumn: index < 2 ? 1 : 7, endColumn: index < 2 ? 4 : 10, rowOffset: index % 2 ? 4 : 0 }));
const metadata = { entity: "Fictional School", accountableOfficer: "Test officer", accountableDesignation: "Officer", accountabilityAssumedDate: "2026-01-01", custodian: "Test custodian", custodianDesignation: "Custodian", committeeChair: "Test chair", committeeChairDesignation: "Chair", committeeMember: "Test member", committeeMemberDesignation: "Member", schoolHead: "Test head", schoolHeadDesignation: "Head" };
function report(family: "rpcsp" | "rpcppe", count: number) {
  const names = family === "rpcsp" ? ["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"] : ["RPCPPE_LAND", "RPCPPE_BLDG", "RPCPPE_OTHERBLDG"];
  const columns = family === "rpcsp" ? 10 : 12;
  const sheets = names.map((name) => ({ name, title: "Fictional type", label: family === "rpcsp" ? "Annex A.8" : "Appendix 73", columns: Array.from({ length: columns }, (_, i) => ({ label: `Field ${i}`, width: 14 })), font: "Arial Narrow", fontSize: 10, orientation: "landscape" as const, margins: { top: 0.75, bottom: 0.75, left: 0.25, right: 0.25 }, mergedRanges: [], headerRows: { first: family === "rpcsp" ? 10 : 11, last: family === "rpcsp" ? 11 : 13 }, detailStartRow: family === "rpcsp" ? 12 : 14, sectionLabels: ["Fictional section"], signatures }));
  return { family, asOfDate: "2026-01-01", fundCluster: "TEST", metadata, totals: { shortageValue: `${count * 2500}.00`, overageValue: "0.00" }, profile: { family, definition: { sheets, dateFormat: "yyyy-mm-dd", numberFormat: "0", currencyFormat: "#,##0.00", thresholdNote: "Fictional policy note" } }, lines: Array.from({ length: count }, (_, index) => ({ lotId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, snapshot: { article: "Fictional section", description: index === 0 ? "=1+1" : `Item ${index}`, propertyNumber: `00-${index}`, unit: "piece", unitValue: "1250.00", supplier: "Test supplier", yearLabel: "2018, 2025", cardQuantity: 10 }, section: { name: "Fictional section", sheetName: names[0]!, order: 1 }, status: "counted" as const, physicalQuantity: 8, condition: "serviceable", remarks: "Test", resolution: "Reviewed", variance: { quantity: -2, value: "-2500.00", status: "shortage" as const } })) };
}

describe("custodial workbook draft renderer", () => {
  test("formats confirmed as-of dates without inferring a different day", () => {
    expect(formatProfileAsOf("2026-01-17")).toBe("2026-01-17");
    expect(formatProfileAsOf("2026-01-17", "month_year")).toBe("January 2026");
    expect(formatProfileAsOf("2026-01-17", "long_date")).toBe("January 17, 2026");
  });
  test("reference profile starting points have valid geometry and render every count sheet", async () => {
    for (const family of ["rpcsp", "rpcppe", "stock_card"] as const) {
      const template = inventoryProfileTemplate(family);
      expect(template.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      const definition = custodialProfileDefinition.parse(template.definition);
      if (family !== "stock_card") {
        const payload = report(family, 0);
        const bytes = await renderCustodialCountWorkbook({ ...payload, profile: { family, definition } });
        const workbook = XLSX.read(bytes, { type: "buffer" });
        expect(workbook.SheetNames).toEqual(definition.sheets.map((sheet) => sheet.name));
        const formatted = new ExcelJS.Workbook();
        await formatted.xlsx.load(bytes as never);
        const first = formatted.worksheets[0]!;
        const typeCell = first.getCell(family === "rpcsp" ? "A3" : "A4");
        expect(typeCell.font).toMatchObject({ name: "Calibri", size: 12, bold: true, underline: true });
        expect(first.getCell(family === "rpcsp" ? "A2" : "A3").font).toMatchObject({ name: "Arial Narrow", size: 14, bold: true });
        expect(first.getCell(family === "rpcsp" ? "A5" : "A6").value).toBe("As of January 2026");
        if (family === "rpcsp") {
          expect(first.getCell("A6").isMerged).toBe(true);
          expect(formatted.worksheets[1]!.getCell("A6").isMerged).toBe(false);
        }
      }
    }
  });
  test.skipIf(!hasCountReferences)("reference profiles preserve each source sheet's fixed header merges", async () => {
    for (const family of ["rpcsp", "rpcppe"] as const) {
      const template = inventoryProfileTemplate(family);
      const definition = custodialProfileDefinition.parse(template.definition);
      const payload = report(family, 0);
      const generated = new ExcelJS.Workbook();
      await generated.xlsx.load(await renderCustodialCountWorkbook({ ...payload, profile: { family, definition } }) as never);
      const source = new ExcelJS.Workbook();
      const file = family === "rpcsp" ? "../../../RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx" : "../../../RPCPPE 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL (1).xlsx";
      await source.xlsx.readFile(fileURLToPath(new URL(file, import.meta.url).href));
      const headerEnd = family === "rpcsp" ? 11 : 13;
      for (const sheet of generated.worksheets) {
        const original = source.getWorksheet(sheet.name)!;
        const totalRows: Record<string, number> = { "RPCSP_IT EQPMNTS": 50, "RPCSP_F&F": 40, "RPCSP_ OTHERSUPPLIES": 172, RPCPPE_LAND: 16, RPCPPE_BLDG: 20, RPCPPE_OTHERBLDG: 25 };
        expect(!!definition.sheets.find((item) => item.name === sheet.name)?.sumUnitValues).toBe(!!original.getCell(`E${totalRows[sheet.name]}`).formula);
        const headerMerges = (value: ExcelJS.Worksheet) => value.model.merges.filter((range) => XLSX.utils.decode_range(range).e.r < headerEnd).sort();
        expect(headerMerges(sheet)).toEqual(headerMerges(original));
        const first = family === "rpcsp" ? 10 : 11;
        const columns = family === "rpcsp" ? 10 : 12;
        for (let column = 1; column <= columns; column++) expect(sheet.getColumn(column).width).toBeCloseTo(original.getColumn(column).width!, 8);
        for (const side of ["top", "bottom", "left", "right"] as const) expect(sheet.pageSetup.margins?.[side]).toBeCloseTo(original.pageSetup.margins![side]!, 8);
        const headings = family === "rpcsp" ? ["A1", "A2", "A3", "A4", "A5"] : ["I1", "A3", "A4", "A5", "A6"];
        for (const address of family === "rpcsp" ? ["A2", "A3", "A4"] : ["A3", "A4", "A5"]) expect(sheet.getCell(address).value).toBe(original.getCell(address).value);
        for (const address of headings) {
          const font = (cell: ExcelJS.Cell) => ({ name: cell.font.name, size: cell.font.size, bold: !!cell.font.bold, italic: !!cell.font.italic, underline: !!cell.font.underline });
          expect(font(sheet.getCell(address))).toEqual(font(original.getCell(address)));
          expect(sheet.getCell(address).alignment.horizontal).toBe(original.getCell(address).alignment.horizontal);
        }
        const certificationRow = (value: ExcelJS.Worksheet) => {
          let found = 0;
          value.eachRow((row) => { const cell = row.getCell(1); if (typeof cell.value === "string" && /^certified correct by/i.test(cell.value.trim())) found = row.number; });
          return found;
        };
        const outputAnchor = certificationRow(sheet), sourceAnchor = certificationRow(original);
        expect(outputAnchor).toBeGreaterThan(0);
        expect(sourceAnchor).toBeGreaterThan(0);
        const signatureMerges = (value: ExcelJS.Worksheet, anchor: number) => value.model.merges.map((range) => XLSX.utils.decode_range(range)).filter((range) => range.s.r + 1 >= anchor && range.e.r + 1 <= anchor + 8).map((range) => `${range.s.c}:${range.s.r + 1 - anchor}:${range.e.c}:${range.e.r + 1 - anchor}`).sort();
        expect(signatureMerges(sheet, outputAnchor)).toEqual(signatureMerges(original, sourceAnchor));
        for (const column of [2, 4]) expect(sheet.getCell(outputAnchor + 6, column).value).toBe(original.getCell(sourceAnchor + 6, column).value);
        for (const [offset, column] of [[2, 2], [5, 2], [5, 4], [5, 8]] as const) {
          const font = (cell: ExcelJS.Cell) => ({ name: cell.font.name, size: cell.font.size, bold: !!cell.font.bold, underline: !!cell.font.underline });
          expect(font(sheet.getCell(outputAnchor + offset, column))).toEqual(font(original.getCell(sourceAnchor + offset, column)));
        }
        if (family === "rpcppe") {
          const offset = sheet.name === "RPCPPE_OTHERBLDG" ? 9 : 10;
          const generatedNote = sheet.getCell(outputAnchor + offset, 2);
          const sourceNote = original.getCell(sourceAnchor + offset, 2);
          expect(generatedNote.value).toBe(sourceNote.value);
          expect({ name: generatedNote.font.name, size: generatedNote.font.size, bold: !!generatedNote.font.bold }).toEqual({ name: sourceNote.font.name, size: sourceNote.font.size, bold: !!sourceNote.font.bold });
          const generatedExample = sheet.getCell(outputAnchor + offset + 1, 2);
          const sourceExample = original.getCell(sourceAnchor + offset + 1, 2);
          expect(generatedExample.value).toBe(sourceExample.value);
          expect({ name: generatedExample.font.name, size: generatedExample.font.size, bold: !!generatedExample.font.bold }).toEqual({ name: sourceExample.font.name, size: sourceExample.font.size, bold: !!sourceExample.font.bold });
        }
        for (let row = first; row <= headerEnd; row++) for (let column = 1; column <= columns; column++) {
          const edges = (cell: ExcelJS.Cell) => [cell.border?.top?.style, cell.border?.right?.style, cell.border?.bottom?.style, cell.border?.left?.style].map((edge) => edge ?? null);
          expect(edges(sheet.getCell(row, column))).toEqual(edges(original.getCell(row, column)));
        }
      }
    }
  });
  test.skipIf(!hasCountReferences)("reference detail borders follow source first, middle and last rows as groups grow", async () => {
    const cases = {
      rpcsp: [{ rows: [12, 13, 20], count: 9 }, { rows: [12, 13, 21], count: 10 }, { rows: [12, 13, 128], count: 117 }],
      rpcppe: [{ rows: [14, 15, 15], count: 2 }, { rows: [14, 15, 18], count: 5 }, { rows: [14, 15, 24], count: 11 }],
    } as const;
    for (const family of ["rpcsp", "rpcppe"] as const) {
      const template = inventoryProfileTemplate(family);
      const definition = custodialProfileDefinition.parse(template.definition);
      const payload = report(family, cases[family].reduce((sum, item) => sum + item.count, 0));
      let lineIndex = 0;
      cases[family].forEach((item, sheetIndex) => {
        const profile = definition.sheets[sheetIndex]!;
        for (let i = 0; i < item.count; i++) payload.lines[lineIndex++]!.section = { name: profile.sectionLabels[0]!, sheetName: profile.name, order: sheetIndex };
      });
      const generated = new ExcelJS.Workbook();
      await generated.xlsx.load(await renderCustodialCountWorkbook({ ...payload, profile: { family, definition } }) as never);
      const source = new ExcelJS.Workbook();
      const file = family === "rpcsp" ? "../../../RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx" : "../../../RPCPPE 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL (1).xlsx";
      await source.xlsx.readFile(fileURLToPath(new URL(file, import.meta.url).href));
      for (const [index, sheet] of generated.worksheets.entries()) {
        const reference = source.getWorksheet(sheet.name)!;
        const { rows, count } = cases[family][index]!;
        const first = family === "rpcsp" ? 12 : 14;
        const columns = family === "rpcsp" ? 10 : 12;
        expect(sheet.getCell(first, 1).alignment.textRotation ?? 0).toBe(reference.getCell(rows[0], 1).alignment.textRotation ?? 0);
        const articleFont = (cell: ExcelJS.Cell) => ({ name: cell.font.name, size: cell.font.size, bold: !!cell.font.bold });
        expect(articleFont(sheet.getCell(first, 1))).toEqual(articleFont(reference.getCell(rows[0], 1)));
        const positions = count === 2 ? [[first, rows[0]], [first + 1, rows[2]]] : [[first, rows[0]], [first + 1, rows[1]], [first + count - 1, rows[2]]];
        for (const [outputRow, sourceRow] of positions) for (let column = 1; column <= columns; column++) {
          const edges = (cell: ExcelJS.Cell) => [cell.border?.top?.style, cell.border?.right?.style, cell.border?.bottom?.style, cell.border?.left?.style].map((edge) => edge ?? null);
          expect(edges(sheet.getCell(outputRow!, column))).toEqual(edges(reference.getCell(sourceRow!, column)));
        }
      }
    }
  });
  test.skipIf(!existsSync(countReferences.rpcsp))("each RPCSP section retains its own reference detail border rules", async () => {
    const spans = [[[12, 20], [22, 49]], [[12, 21], [22, 28], [29, 39]], [[12, 128], [129, 143], [144, 153], [154, 157], [158, 164], [165, 171]]] as const;
    const definition = custodialProfileDefinition.parse(inventoryProfileTemplate("rpcsp").definition);
    const count = spans.flat().reduce((sum, [first, last]) => sum + last - first + 1, 0);
    const payload = report("rpcsp", count);
    let lineIndex = 0;
    for (const [sheetIndex, sections] of spans.entries()) for (const [sectionIndex, [first, last]] of sections.entries()) {
      const profile = definition.sheets[sheetIndex]!;
      for (let row = first; row <= last; row++) payload.lines[lineIndex++]!.section = { name: profile.sectionLabels[sectionIndex]!, sheetName: profile.name, order: sheetIndex * 100 + sectionIndex };
    }
    const generated = new ExcelJS.Workbook();
    await generated.xlsx.load(await renderCustodialCountWorkbook({ ...payload, profile: { family: "rpcsp", definition } }) as never);
    const source = new ExcelJS.Workbook();
    await source.xlsx.readFile(fileURLToPath(new URL("../../../RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx", import.meta.url).href));
    for (const [sheetIndex, sections] of spans.entries()) {
      const sheet = generated.worksheets[sheetIndex]!;
      const reference = source.getWorksheet(sheet.name)!;
      let outputStart = 12;
      for (const [sectionIndex, [first, last]] of sections.entries()) {
        const length = last - first + 1;
        const font = (cell: ExcelJS.Cell) => ({ name: cell.font.name, size: cell.font.size, bold: !!cell.font.bold });
        expect(font(sheet.getCell(outputStart, 1))).toEqual(font(reference.getCell(first, 1)));
        for (const [outputRow, sourceRow] of [[outputStart, first], [outputStart + 1, first + 1], [outputStart + length - 1, last]]) for (let column = 1; column <= 10; column++) {
          const edges = (cell: ExcelJS.Cell) => [cell.border?.top?.style, cell.border?.right?.style, cell.border?.bottom?.style, cell.border?.left?.style].map((edge) => edge ?? null);
          expect(edges(sheet.getCell(outputRow!, column))).toEqual(edges(reference.getCell(sourceRow!, column)));
        }
        outputStart += length + (definition.sheets[sheetIndex]!.subtotalAfterSections?.includes(definition.sheets[sheetIndex]!.sectionLabels[sectionIndex]!) ? 1 : 0);
      }
    }
  });
  for (const family of ["rpcsp", "rpcppe"] as const) {
    test(`${family} grows and reopens with all sheets and corrected values`, async () => {
      const payload = report(family, 180);
      const bytes = await renderCustodialCountWorkbook(payload);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as never);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(payload.profile.definition.sheets.map((sheet) => sheet.name));
      const sheet = workbook.worksheets[0]!;
      const start = family === "rpcsp" ? 12 : 14;
      expect(sheet.getCell(start, 2).value).toBe("=1+1");
      expect(sheet.getCell(start, 6).value).toBe(10);
      expect(sheet.getCell(start, 7).value).toBe(8);
      expect(sheet.getCell(start, 8).value).toEqual({ formula: `G${start}-F${start}`, result: -2 });
      expect(sheet.getCell(start, 9).value).toEqual({ formula: `H${start}*E${start}`, result: -2500 });
      expect(sheet.getCell(start + 180, 9).value).toEqual({ formula: `SUM(I${start}:I${start + 179})`, result: -450000 });
      expect(sheet.pageSetup.orientation).toBe("landscape");
      expect(Number(sheet.pageSetup.printArea?.match(/\d+$/)?.[0])).toBeGreaterThan(start + 180);
      expect(workbook.worksheets[1]!.getCell(family === "rpcsp" ? "A12" : "A14").value).toBeNull();
      for (const current of workbook.worksheets) {
        if (family === "rpcsp") {
          expect(current.getCell("H10").isMerged).toBe(false);
          expect(current.getCell("I10").isMerged).toBe(false);
          expect(current.getCell("A8").isMerged).toBe(false);
        } else {
          expect(current.getCell("F11").isMerged).toBe(false);
          expect(current.getCell("G11").isMerged).toBe(false);
          expect(current.getCell("F11").value).toBe("QUANTITY");
          expect(current.getCell("G11").value).toBe("QUANTITY");
          expect(current.getCell("A9").isMerged).toBe(false);
        }
      }
    });
  }
  test("rejects an altered variance", async () => {
    const payload = report("rpcsp", 1);
    payload.lines[0]!.variance.value = "2500.00";
    await expect(renderCustodialCountWorkbook(payload)).rejects.toThrow("Frozen variance");
  });
  test("uses the reviewed profile's report title and type caption", async () => {
    const definition = custodialProfileDefinition.parse(inventoryProfileTemplate("rpcsp").definition);
    definition.sheets[0]!.reportTitle = "Reviewed fictional report title";
    definition.sheets[0]!.typeCaption = "Reviewed fictional caption";
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await renderCustodialCountWorkbook({ ...report("rpcsp", 0), profile: { family: "rpcsp", definition } }) as never);
    expect(workbook.worksheets[0]!.getCell("A2").value).toBe("Reviewed fictional report title");
    expect(workbook.worksheets[0]!.getCell("A4").value).toBe("Reviewed fictional caption");
  });
  test("rejects profile merges that overlap form headers or detail rows", async () => {
    const payload = report("rpcppe", 0);
    Object.assign(payload.profile.definition.sheets[0]!, { applyHeaderMerges: true, mergedRanges: ["F11:G11"] });
    await expect(renderCustodialCountWorkbook(payload)).rejects.toThrow("overwrite content");
    Object.assign(payload.profile.definition.sheets[0]!, { mergedRanges: ["A14:B14"] });
    await expect(renderCustodialCountWorkbook(payload)).rejects.toThrow("fixed header area");
  });
  test("marks partial counts and rejects rows outside their frozen scope", async () => {
    const payload = { ...report("rpcsp", 1), sectionScope: [{ id: "00000000-0000-4000-8000-000000000001", name: "Fictional section", sheetName: "RPCSP_IT EQPMNTS", version: 0 }] };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await renderCustodialCountWorkbook(payload) as never);
    expect(workbook.worksheets[0]!.headerFooter.oddHeader).toContain("Partial count");
    expect(workbook.worksheets[0]!.getCell("A6").value).toBe("PARTIAL COUNT — SELECTED SECTIONS");
    payload.sectionScope[0]!.name = "Other section";
    await expect(renderCustodialCountWorkbook(payload)).rejects.toThrow("outside the frozen section scope");
  });
  test("includes reviewed mixed-condition quantities in the remarks", async () => {
    const payload = report("rpcsp", 1);
    Object.assign(payload.lines[0]!, { condition: "mixed", conditionBreakdown: [{ condition: "serviceable", quantity: 5 }, { condition: "unserviceable", quantity: 3 }] });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await renderCustodialCountWorkbook(payload) as never);
    expect(workbook.worksheets[0]!.getCell("J12").value).toBe("Test; serviceable: 5, unserviceable: 3");
  });
  test("long descriptions and remarks expand into verified continuation rows", async () => {
    const definition = custodialProfileDefinition.parse(inventoryProfileTemplate("rpcppe").definition);
    const payload = report("rpcppe", 1);
    const line = payload.lines[0]!;
    line.snapshot.description = `${"Long description ".repeat(80)}\n${"Second line ".repeat(30)}${"\n📦".repeat(20)}`;
    line.remarks = "Detailed remark ".repeat(60);
    line.section.name = "LAND (SCHOOL SITE)";
    const bytes = await renderCustodialCountWorkbook({ ...payload, profile: { family: "rpcppe", definition } });
    const workbook = XLSX.read(bytes, { type: "buffer", cellFormula: true });
    const sheet = workbook.Sheets.RPCPPE_LAND!;
    let row = 14, description = "", remarks = "";
    while (sheet[`A${row}`]?.v !== "GRAND TOTAL") {
      description += sheet[`B${row}`]?.v ?? "";
      remarks += sheet[`L${row}`]?.v ?? "";
      if (row > 14) expect(sheet[`H${row}`]?.v ?? null).toBeNull();
      row++;
      if (row > 100) throw new Error("Continuation rows did not terminate.");
    }
    expect(row).toBeGreaterThan(15);
    expect(description).toBe(line.snapshot.description);
    expect(remarks).toBe(line.remarks);
    expect(sheet[`I${row}`]?.f).toBe(`SUM(I14:I${row - 1})`);
    expect(sheet[`I${row}`]?.v).toBe(-2500);
    const imported = inspectTrustedInventoryWorkbook(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), "fictional.xlsx");
    expect(imported.sheets[0]!.rows).toHaveLength(1);
    expect(imported.sheets[0]!.rows[0]!.warnings).toContain("CONTINUATION_ROWS_REQUIRE_REVIEW");
    expect(Object.keys(imported.sheets[0]!.rows[0]!.fields).some((key) => key.startsWith("descriptionContinuation_"))).toBe(true);
  });
  test("generates 2,000 detail rows without truncation", async () => {
    const started = performance.now();
    const bytes = await renderCustodialCountWorkbook(report("rpcsp", 2000));
    const elapsed = performance.now() - started;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    expect(workbook.worksheets[0]!.getCell("I2012").value).toEqual({ formula: "SUM(I12:I2011)", result: -5000000 });
    expect(elapsed).toBeLessThan(30000);
  }, 30000);
  test("rebuilds section and signed totals without double-counting subtotal rows", async () => {
    const payload = report("rpcsp", 2);
    payload.profile.definition.sheets[0]!.sectionLabels = ["First", "Second"];
    Object.assign(payload.profile.definition.sheets[0]!, { subtotalAfterSections: ["First"], sumUnitValues: true });
    payload.lines[0]!.section = { name: "First", sheetName: "RPCSP_IT EQPMNTS", order: 1 };
    payload.lines[1]!.section = { name: "Second", sheetName: "RPCSP_IT EQPMNTS", order: 2 };
    payload.lines[1]!.physicalQuantity = 12;
    Object.assign(payload.lines[1]!.variance, { quantity: 2, value: "2500.00", status: "overage" });
    payload.totals = { shortageValue: "2500.00", overageValue: "2500.00" };
    const workbook = new ExcelJS.Workbook();
    const bytes = await renderCustodialCountWorkbook(payload);
    await workbook.xlsx.load(bytes as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell("I13").value).toEqual({ formula: "SUM(I12:I12)", result: -2500 });
    expect(sheet.getCell("E13").value).toEqual({ formula: "SUM(E12:E12)", result: 1250 });
    expect(sheet.getCell("E15").value).toEqual({ formula: "SUM(E12:E12,E14:E14)", result: 2500 });
    expect(sheet.getCell("I15").formula).toBe("SUM(I12:I12,I14:I14)");
    const reopened = XLSX.read(bytes, { type: "buffer", cellFormula: true });
    expect(reopened.Sheets["RPCSP_IT EQPMNTS"]?.I15?.v).toBe(0);
    expect(sheet.getCell("I16").value).toBe(-2500);
    expect(sheet.getCell("I17").value).toBe(2500);
  });
  test("import inspection does not treat generated totals as inventory rows", async () => {
    const definition = custodialProfileDefinition.parse(inventoryProfileTemplate("rpcsp").definition);
    const payload = report("rpcsp", 2);
    for (const line of payload.lines) line.section.name = "IT/OFFICE EQUIPMENTS";
    const bytes = await renderCustodialCountWorkbook({ ...payload, profile: { family: "rpcsp", definition } });
    const inspected = inspectTrustedInventoryWorkbook(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), "fictional.xlsx");
    expect(inspected.sheets[0]!.rows).toHaveLength(2);
    expect(inspected.sheets.slice(1).flatMap((sheet) => sheet.rows)).toHaveLength(0);
    expect(inspected.warnings.some((warning) => warning.startsWith("SOURCE_VARIANCE_SUMMARY_IGNORED:"))).toBe(true);
  });
  test("routes every reference section to its source sheet with growing groups", async () => {
    const cases = {
      rpcsp: [["IT/OFFICE EQUIPMENTS", "OTHER EQUIPMENTS"], ["CLASSROOM FURNITURES & FIXTURES", "LABORATORY /ICTFURNITURES & FIXTURES", "ADMINISTRATION FURNITURES & FIXTURES"], ["SCIENCE EQUIPMENTS / SUPPLIES", "MATH SUPPLIES/EQUIPMENTS", "SPORTS SUPPLIES/EQUIPMENTS", "EMERGENCY SUPPLIES/EQUIPMENT", "CLINIC & ISOLATION SUPPLIES/EQUIPMENT", "OTHER SUPPLIES & EQUIPMENTS"]],
      rpcppe: [["LAND (SCHOOL SITE)"], ["SCHOOL BUILDINGS"], ["OTHER STRUCTURES"]],
    } as const;
    for (const family of ["rpcsp", "rpcppe"] as const) {
      const sections = cases[family];
      const payload = report(family, sections.flat().length * 2);
      let index = 0;
      for (const [sheetIndex, labels] of sections.entries()) {
        const sheetProfile = payload.profile.definition.sheets[sheetIndex]!;
        sheetProfile.sectionLabels = [...labels];
        for (const label of labels) for (let n = 0; n < 2; n++) {
          const line = payload.lines[index]!;
          line.section = { name: label, sheetName: sheetProfile.name, order: index };
          index++;
        }
      }
      const bytes = await renderCustodialCountWorkbook(payload);
      const workbook = XLSX.read(bytes, { type: "buffer" });
      for (const [sheetIndex, labels] of sections.entries()) {
        const sheetName = payload.profile.definition.sheets[sheetIndex]!.name;
        const current = workbook.Sheets[sheetName]!;
        const values = Object.entries(current).filter(([address]) => /^A\d+$/.test(address)).map(([, cell]) => (cell as XLSX.CellObject).v);
        for (const label of labels) expect(values.filter((value) => value === label)).toHaveLength(1);
        const first = family === "rpcsp" ? 12 : 14;
        expect(current[`H${first}`]?.v).toBe(-2);
        expect(current[`I${first}`]?.v).toBe(-2500);
        expect((current["!merges"] ?? []).some((range) => range.s.c === 0 && range.e.c === 0 && range.e.r > range.s.r)).toBe(true);
      }
    }
  });
  test("renders stock-card dates, chronological balances and a blank form", async () => {
    const sheetProfile = { ...report("rpcsp", 0).profile.definition.sheets[0]!, name: "SC", orientation: "portrait" as const, columns: Array.from({ length: 7 }, (_, index) => ({ label: `Column ${index}`, width: 14 })), signatures: [] };
    const card = { entity: "Fictional School", fundCluster: "TEST", office: null, asOfDate: "2026-02-01", item: { code: "00-001", article: "Paper", description: "Fictional stock", unit: "box", reorderPoint: 0 }, profile: { family: "stock_card" as const, definition: { sheets: [sheetProfile], dateFormat: "yyyy-mm-dd", numberFormat: "0", currencyFormat: "0.00", thresholdNote: "" } }, entries: [{ id: "00000000-0000-4000-8000-000000000001", effectiveDate: "2026-01-01", sequence: 1, reference: "Opening", office: "A", delta: 10, balanceAfter: 10, daysToConsume: null }, { id: "00000000-0000-4000-8000-000000000002", effectiveDate: "2026-01-02", sequence: 2, reference: "Issue", office: "A", delta: -3, balanceAfter: 7, daysToConsume: 4 }] };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await renderCustodialStockCardWorkbook(card) as never);
    const sheet = workbook.getWorksheet("SC")!;
    expect(sheet.getCell("C13").value).toBe(10);
    expect(sheet.getCell("D14").value).toBe(3);
    expect(sheet.getCell("F14").value).toBe(7);
    expect(sheet.pageSetup.orientation).toBe("portrait");
    expect(sheet.getCell("A13").value).toBeInstanceOf(Date);
    const blank = new ExcelJS.Workbook();
    await blank.xlsx.load(await renderCustodialStockCardWorkbook({ ...card, entries: [] }) as never);
    expect(blank.getWorksheet("SC")!.pageSetup.printArea).toBe("A1:G45");
    const referenceProfile = custodialProfileDefinition.parse(inventoryProfileTemplate("stock_card").definition);
    referenceProfile.sheets[0]!.stockCardPageRows = 3;
    const longEntry = { ...card.entries[0]!, reference: "Long transaction reference ".repeat(30), office: "Fictional office ".repeat(20) };
    const longCardBytes = await renderCustodialStockCardWorkbook({ ...card, entries: [longEntry], profile: { family: "stock_card", definition: referenceProfile } });
    const longCard = XLSX.read(longCardBytes, { type: "buffer" }).Sheets.SC!;
    let reference = "", office = "", carryCount = 0, receipts = 0;
    for (let current = 13; current <= XLSX.utils.decode_range(longCard["!ref"]!).e.r + 1; current++) {
      if (longCard[`B${current}`]?.v === "Balance brought forward") { expect(longCard[`F${current}`]?.v).toBe(10); carryCount++; continue; }
      reference += longCard[`B${current}`]?.v ?? "";
      office += longCard[`E${current}`]?.v ?? "";
      if (longCard[`C${current}`]?.v != null) { expect(longCard[`C${current}`]?.v).toBe(10); receipts++; }
      expect(longCard[`D${current}`]?.v ?? null).toBeNull();
    }
    expect(carryCount).toBeGreaterThan(0);
    expect(receipts).toBe(1);
    expect(reference).toBe(longEntry.reference);
    expect(office).toBe(longEntry.office);
    const inspectedCard = inspectTrustedInventoryWorkbook(new Uint8Array(longCardBytes.buffer, longCardBytes.byteOffset, longCardBytes.byteLength), "fictional.xlsx");
    expect(inspectedCard.warnings.filter((warning) => warning.startsWith("STOCK_CARD_CARRY_FORWARD_IGNORED:"))).toHaveLength(carryCount);
    expect(inspectedCard.sheets[0]!.rows.some((item) => item.fields.reference?.value === "Balance brought forward")).toBe(false);
    expect(inspectedCard.sheets[0]!.rows).toHaveLength(1);
    expect(inspectedCard.sheets[0]!.rows[0]!.warnings).toContain("CONTINUATION_ROWS_REQUIRE_REVIEW");
    expect(Object.keys(inspectedCard.sheets[0]!.rows[0]!.fields).some((key) => key.startsWith("referenceContinuation_"))).toBe(true);
    const manyEntries = Array.from({ length: 60 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, effectiveDate: "2026-01-01", sequence: index + 1, reference: `Entry ${index + 1}`, office: "A", delta: 1, balanceAfter: index + 1, daysToConsume: null }));
    const paged = new ExcelJS.Workbook();
    const pagedBytes = await renderCustodialStockCardWorkbook({ ...card, entries: manyEntries });
    await paged.xlsx.load(pagedBytes as never);
    const pagedSheet = paged.getWorksheet("SC")!;
    expect(pagedSheet.getCell("B33").value).toBe("Balance brought forward");
    expect(pagedSheet.getCell("F33").value).toBe(20);
    expect(pagedSheet.getCell("C33").value).toBeNull();
    expect(pagedSheet.getCell("D33").value).toBeNull();
    expect(pagedSheet.getCell("B53").value).toBe("Balance brought forward");
    expect(pagedSheet.getCell("F53").value).toBe(39);
    const archive = XLSX.read(pagedBytes, { type: "buffer", bookFiles: true }) as XLSX.WorkBook & { files: Record<string, { content: Uint8Array }> };
    const xml = new TextDecoder().decode(archive.files["xl/worksheets/sheet1.xml"]!.content);
    expect(xml).toMatch(/<brk[^>]*id="32"/);
    expect(xml).toMatch(/<brk[^>]*id="52"/);
    const taller = new ExcelJS.Workbook();
    await taller.xlsx.load(await renderCustodialStockCardWorkbook({ ...card, entries: manyEntries.map((entry) => ({ ...entry, reference: `Fictional transaction ${entry.sequence}`, office: "Test Office" })), profile: { family: "stock_card", definition: custodialProfileDefinition.parse(inventoryProfileTemplate("stock_card").definition) } }) as never);
    const tallSheet = taller.getWorksheet("SC")!;
    expect(tallSheet.getCell("B24").value).toBe("Balance brought forward");
    expect(tallSheet.getCell("F24").value).toBe(10);
    await expect(renderCustodialStockCardWorkbook({ ...card, entries: [card.entries[1]!] })).rejects.toThrow("running balance");
  });
  test.skipIf(!existsSync(stockCardReference))("stock-card header merges match the private source reference", async () => {
    const profile = custodialProfileDefinition.parse(inventoryProfileTemplate("stock_card").definition);
    const bytes = await renderCustodialStockCardWorkbook({
      entity: "Fictional School", fundCluster: "TEST", office: null, asOfDate: "2026-02-01",
      item: { code: "00-001", article: "Paper", description: "Fictional stock", unit: "box", reorderPoint: 0 },
      profile: { family: "stock_card", definition: profile }, entries: [],
    });
    const generatedMerges = XLSX.read(bytes, { type: "buffer" }).Sheets.SC!["!merges"] ?? [];
    const source = XLSX.read(readFileSync(stockCardReference), { type: "buffer" });
    const headerMerges = (ranges: XLSX.Range[]) => ranges.filter((range) => range.e.r < 12).map((range) => XLSX.utils.encode_range(range)).sort();
    expect(headerMerges(generatedMerges)).toEqual(headerMerges(source.Sheets.SC!["!merges"] ?? []));
  });
});
