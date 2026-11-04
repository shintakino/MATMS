/** Reference geometry only. The school must review and approve each profile before use. */
import { referenceDetailBorders } from "./inventory-reference-detail-borders";
const sheets = {
  rpcsp: [
    ["RPCSP_IT EQPMNTS", "IT AND OFFICE EQUIPMENTS", [8.26953125, 27.7265625, 12.26953125, 9.81640625, 10.26953125, 15.7265625, 10.7265625, 8.1796875, 10, 26.54296875], ["IT/OFFICE EQUIPMENTS", "OTHER EQUIPMENTS"], [0, 0, 0.503472222222222, 0.503472222222222]],
    ["RPCSP_F&F", "FURNITURES AND FIXTURES", [18.6328125, 27.26953125, 14.1796875, 12.81640625, 9.1796875, 12.6328125, 10.54296875, 11.1796875, 8.08984375, 24.81640625], ["CLASSROOM FURNITURES & FIXTURES", "LABORATORY /ICTFURNITURES & FIXTURES", "ADMINISTRATION FURNITURES & FIXTURES"], [0.75, 0.75, 0.25, 0.25]],
    ["RPCSP_ OTHERSUPPLIES", "OTHER SUPPLIES & EQUIPMENTS", [21.81640625, 24.1796875, 12.453125, 8.7265625, 9.6328125, 13.54296875, 8.7265625, 8.7265625, 14.1796875, 21.54296875], ["SCIENCE EQUIPMENTS / SUPPLIES", "MATH SUPPLIES/EQUIPMENTS", "SPORTS SUPPLIES/EQUIPMENTS", "EMERGENCY SUPPLIES/EQUIPMENT", "CLINIC & ISOLATION SUPPLIES/EQUIPMENT", "OTHER SUPPLIES & EQUIPMENTS"], [0.751388888888889, 0.751388888888889, 0.109722222222222, 0.109722222222222]],
  ],
  rpcppe: [
    ["RPCPPE_LAND", "LAND (SCHOOL SITE)", [10.7272727272727, 22.4545454545455, 14.7272727272727, 11.7272727272727, 10.8181818181818, 11.8181818181818, 14, 8.72727272727273, 8.72727272727273, 8.72727272727273, 9.81818181818182, 13.4545454545455], ["LAND (SCHOOL SITE)"], [0.751388888888889, 0.751388888888889, 0.109722222222222, 0.109722222222222]],
    ["RPCPPE_BLDG", "SCHOOL BUILDINGS", [8.81818181818182, 18.4545454545455, 15, 14.7272727272727, 12.5454545454545, 10.7272727272727, 9.54545454545454, 8.72727272727273, 8.72727272727273, 8.72727272727273, 8.72727272727273, 19.5454545454545], ["SCHOOL BUILDINGS"], [0.751388888888889, 0.751388888888889, 0.109722222222222, 0.109722222222222]],
    ["RPCPPE_OTHERBLDG", "OTHER STRUCTURES", [10, 19.3636363636364, 13.9090909090909, 8.72727272727273, 8.72727272727273, 9.63636363636364, 12.8181818181818, 9.18181818181818, 8.72727272727273, 10, 8.72727272727273, 22.3636363636364], ["OTHER STRUCTURES"], [0.75, 0.75, 0.25, 0.25]],
  ],
} as const;
const hashes = { rpcsp: "9e72470132ed1115050fa0b488594f643fc38a91cc3200d2b783a029b9c6f818", rpcppe: "d3dd4272ccded5e1c32a8fde248b8db2c80d9684b76bed23730a3de4ebb08974", stock_card: "f350dce16a51e34685bfa530c33a194b7b453248e23f07c90424265dfe166f94" } as const;
// Each code records the top, right, bottom and left edge: none, thin or medium.
const rpcspHeader = [["mmnm", "mtnn", "mtnt", "mtnt", "mtnt", "mtnt", "mtnt", "mttt", "mttt", "mmnt"], ["nmnm", "ntnn", "ntnt", "ntnt", "ntnt", "ntnt", "ntnt", "ttnt", "ttnt", "nmnt"]];
const rpcspOtherHeader = [rpcspHeader[0]!, ["nmmm", "ntmn", "ntmt", "ntmt", "ntmt", "ntmt", "ntmt", "ttmt", "ttmt", "nmmt"]];
const rpcppeHeader = [["mmnm", "mmnm", "mmnm", "mmnn", "mmnm", "mmnm", "mmnm", "mnnm", "mmnn", "mmnm", "mmnm", "mmnm"], ["nmnm", "nmnm", "nmnm", "nmnn", "nmnm", "nmnm", "nmnm", "nnmm", "nmmn", "nmnm", "nmnm", "nmnm"], ["nmmm", "nmmm", "nmmm", "nmmn", "nmmm", "nmmm", "nmmm", "mnmm", "mmmm", "nmmm", "nmmm", "nmmm"]];
const detailPatterns: Record<string, { first: string[]; middle: string[]; last: string[] }> = {
  "RPCSP_IT EQPMNTS": { first: ["mmnm", "mttn", "mttt", "mttt", "mttt", "mttt", "mttt", "mttt", "mttt", "mmtt"], middle: ["nmnm", "nttn", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nmtt"], last: ["nmnm", "ntnm", "ntnt", "ntnt", "ntnt", "ntnt", "nttt", "nttt", "ntnt", "tmnt"] },
  "RPCSP_F&F": { first: ["mnnm", "mtnm", "mtnt", "mtnt", "mtnt", "mtnt", "mtnt", "mtnt", "mtnt", "mmnt"], middle: ["nnnm", "tttm", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tmtt"], last: ["nnnm", "ttmm", "ttmt", "ttmt", "ttmt", "ttmt", "ttmt", "ttmt", "ntmt", "nmmt"] },
  "RPCSP_ OTHERSUPPLIES": { first: ["mtnm", "tttt", "tttt", "tttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nmtt"], middle: ["ntnm", "tttt", "tttt", "tttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nmtt"], last: ["ntnm", "tttt", "tttt", "tttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nmtt"] },
  RPCPPE_LAND: { first: ["mmnm", "mmnm", "mmnm", "mmnm", "mmnm", "mmnm", "mmnm", "mtnm", "mmnt", "mmnm", "mmnm", "mmnm"], middle: ["nmnm", "nmnm", "nmnm", "nmnn", "nmnm", "nmnm", "nmnm", "ntnm", "nmnt", "nmnn", "nmnn", "nmnm"], last: ["nmnm", "nmnm", "nmnm", "nmnn", "nmnm", "nmnm", "nmnm", "ntnm", "nmnt", "nmnn", "nmnn", "nmnm"] },
  RPCPPE_BLDG: { first: ["mtnm", "nttn", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nmtt"], middle: ["ntnm", "tttn", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tmtt"], last: ["ntnm", "tttn", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "nmtt"] },
  RPCPPE_OTHERBLDG: { first: ["mtnm", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nttt", "nmtt"], middle: ["ntnm", "nttt", "nttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "nmtt"], last: ["ntnm", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "tttt", "nmtt"] },
};
function withSingle(pattern: { first: readonly string[]; middle: readonly string[]; last: readonly string[] }) {
  return { first: [...pattern.first], middle: [...pattern.middle], last: [...pattern.last], single: pattern.first.map((first, index) => `${first[0]}${first[1]}${pattern.last[index]![2]}${first[3]}`) };
}
function detailBorders(name: string) {
  return withSingle(detailPatterns[name]!);
}

export function formatProfileAsOf(date: string, mode: "iso" | "month_year" | "long_date" = "iso") {
  if (mode === "iso") return date;
  const [year, month, day] = date.split("-");
  const name = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(month) - 1];
  if (!name || !year || !day) throw new Error("Invalid profile as-of date.");
  return mode === "month_year" ? `${name} ${year}` : `${name} ${Number(day)}, ${year}`;
}

export function splitReportText(value: string, width: number, fontSize: number, enabled: boolean): string[] {
  if (!enabled) return [value];
  const lineHeight = Math.max(15, Math.ceil(fontSize * 1.35));
  const maxLines = Math.max(1, Math.floor(280 / lineHeight / 2));
  const effectiveWidth = Math.max(1, width * Math.min(1, 11 / fontSize) * 0.5);
  const limit = Math.max(1, Math.floor(effectiveWidth * maxLines));
  const chunks: string[] = [];
  let current = "", characters = 0, breaks = 0;
  for (const character of value) {
    if (characters >= limit || breaks >= maxLines) { chunks.push(current); current = ""; characters = 0; breaks = 0; }
    current += character; characters++;
    if (character === "\n") breaks++;
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks;
}

export function inventoryProfileTemplate(family: keyof typeof hashes) {
  const labels = family === "stock_card" ? ["Date", "Reference", "Receipt Qty.", "Issue Qty.", "Office", "Balance Qty.", "No. of Days to Consume"] : family === "rpcsp" ? ["Article", "Description", "Semi-expendable Property No.", "Unit of Measure", "Unit Value", "Balance Per Property Card", "On Hand Per Count", "Quantity", "Value", "Remarks"] : ["Article", "Description", "Property Number", "Unit of Measure", "Unit Value", "PROPERTY CARD", "PHYSICAL COUNT", "Quantity", "Value", "Supplier", "Year Acquired", "Remarks"];
  const signatures = (name: string) => {
    const wide = name === "RPCPPE_OTHERBLDG";
    const signatureLabel = "Signature over Printed Name of School Inventory";
    return [{ role: "custodian", startColumn: 2, endColumn: 2, rowOffset: 1, underlineName: true }, { role: "committee_chair", startColumn: 2, endColumn: 2, rowOffset: 4, designationOffset: 2, signatureLabel, underlineName: true }, { role: "committee_member", startColumn: 4, endColumn: wide ? 7 : 6, rowOffset: 4, designationOffset: 2, signatureLabel, labelEndColumn: wide ? 7 : 4, underlineName: true }, { role: "school_head", startColumn: 8, endColumn: wide ? 11 : 10, rowOffset: 4, underlineName: true }];
  };
  const definition = { asOfDisplay: "month_year", dateFormat: "yyyy-mm-dd", numberFormat: "0", currencyFormat: "#,##0.00", thresholdNote: family === "rpcppe" ? "USE RPCPPE FORM FOR 50K UP" : "", ...(family === "rpcppe" ? { thresholdExample: "(e.g  School Building, Land etc)" } : {}), defaultSignatories: {}, sheets: family === "stock_card" ? [{ name: "SC", title: "STOCK CARD", reportTitle: "STOCK CARD", label: "Appendix 58", columns: [11.125, 14, 11.75, 11.75, 23.625, 15.75, 21.5].map((width, i) => ({ label: labels[i], width })), font: "Times New Roman", fontSize: 12, orientation: "portrait", margins: { top: 0.75, bottom: 0.75, left: 0.25, right: 0.25 }, mergedRanges: ["A4:G4", "A5:G5", "A11:A12", "B11:B12", "D11:E11", "G11:G12"], applyHeaderMerges: true, continuationRows: true, headerRows: { first: 11, last: 12 }, detailStartRow: 13, sectionLabels: [], signatures: [] }] : sheets[family].map(([name, title, widths, sections, margins], i) => ({ name, title, reportTitle: family === "rpcsp" ? "REPORT ON THE PHYSICAL COUNT OF THE SEMI-EXPENDABLE PROPERTY" : "REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT", typeCaption: "(Type of Property, Plant and Equipment)", label: family === "rpcsp" ? "Annex A.8" : "Appendix 73", columns: widths.map((width, n) => ({ label: labels[n], width })), font: "Arial Narrow", fontSize: 10, detailBorders: detailBorders(name), ...(family === "rpcsp" ? { detailBordersBySection: Object.fromEntries(Object.entries(referenceDetailBorders[name as keyof typeof referenceDetailBorders]).map(([section, rule]) => [section, withSingle(rule)])) } : {}), continuationRows: true, articleRotation: family === "rpcppe" || i === 0 ? 90 : 0, articleStyle: { font: "Arial Narrow", size: i === 0 ? 10 : 9, bold: true }, ...(name === "RPCSP_IT EQPMNTS" ? { articleStylesBySection: { "IT/OFFICE EQUIPMENTS": { font: "Calibri", size: 11, bold: true } } } : {}), headerBorders: family === "rpcsp" ? (i === 2 ? rpcspOtherHeader : rpcspHeader) : rpcppeHeader, headingStyles: { label: { font: family === "rpcsp" ? "Calibri" : "Arial Narrow", size: family === "rpcsp" ? 11 : 15, italic: true, alignment: family === "rpcppe" || i === 2 ? "right" : "center" }, title: { font: "Arial Narrow", size: 14, bold: true }, type: { font: "Calibri", size: 12, bold: true, underline: true }, caption: { font: "Calibri", size: 12 }, date: { font: "Calibri", size: 12 } }, orientation: "landscape", margins: { top: margins[0], bottom: margins[1], left: margins[2], right: margins[3] }, mergedRanges: family === "rpcsp" ? ["A1:J1", "A2:J2", "A3:J3", "A4:J4", "A5:J5", ...(i === 0 ? ["A6:J6"] : []), ...["A", "B", "C", "D", "E", "F", "G", "J"].map((column) => `${column}10:${column}11`)] : ["I1:L1", "A3:L3", "A4:L4", "A5:L5", "A6:L6", ...["A", "B", "C", "D", "E", "J", "K", "L"].map((column) => `${column}11:${column}13`), "H11:I12"], applyHeaderMerges: true, headerRows: { first: family === "rpcsp" ? 10 : 11, last: family === "rpcsp" ? 11 : 13 }, detailStartRow: family === "rpcsp" ? 12 : 14, sectionLabels: [...sections], sumUnitValues: name === "RPCSP_IT EQPMNTS" || name === "RPCSP_ OTHERSUPPLIES" || name === "RPCPPE_BLDG", subtotalAfterSections: family === "rpcsp" && i === 0 ? [sections[0]] : [], ...(family === "rpcppe" ? { thresholdNotePosition: { rowOffset: name === "RPCPPE_OTHERBLDG" ? 9 : 10, column: 2 }, thresholdNoteStyle: { font: "Arial Narrow", size: 8, bold: name === "RPCPPE_OTHERBLDG" } } : {}), ...(name === "RPCPPE_OTHERBLDG" ? { signatureExtraMerges: [{ rowOffset: 7, startColumn: 8, endColumn: 11 }] } : {}), signatures: signatures(name) })) };
  return { sourceHash: hashes[family], definition };
}
