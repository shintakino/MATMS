"use client";

import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Button } from "@matms/ui/components/button";
import { z } from "zod";
import { formatProfileAsOf, splitReportText } from "@matms/api/inventory-profile-templates";
import type { NavigationRole } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/ui-states";
import { client } from "@/utils/orpc";

const text = z.string();
const headingStyle = z.object({ font: text, size: z.number(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), alignment: z.enum(["left", "center", "right"]).optional() });
const sheet = z.object({ name: text, label: text, title: text, reportTitle: text.optional(), typeCaption: text.optional(), columns: z.array(z.object({ label: text, width: z.number() })), font: text, fontSize: z.number(), headerBorders: z.array(z.array(text)).optional(), detailBorders: z.object({ single: z.array(text), first: z.array(text), middle: z.array(text), last: z.array(text) }).optional(), detailBordersBySection: z.record(text, z.object({ single: z.array(text), first: z.array(text), middle: z.array(text), last: z.array(text) })).optional(), articleRotation: z.number().optional(), articleStyle: headingStyle.optional(), articleStylesBySection: z.record(text, headingStyle).optional(), headingStyles: z.object({ label: headingStyle.optional(), title: headingStyle.optional(), type: headingStyle.optional(), caption: headingStyle.optional(), date: headingStyle.optional() }).optional(), sectionLabels: z.array(text), subtotalAfterSections: z.array(text).optional(), sumUnitValues: z.boolean().optional(), stockCardPageRows: z.number().int().min(2).max(100).optional(), continuationRows: z.boolean().optional(), signatures: z.array(z.object({ role: text, startColumn: z.number(), endColumn: z.number(), rowOffset: z.number(), signatureLabel: text.optional(), underlineName: z.boolean().optional() })) });
const definition = z.object({ sheets: z.array(sheet), thresholdNote: text, thresholdExample: text.optional(), asOfDisplay: z.enum(["iso", "month_year", "long_date"]).optional() });
const metadata = z.object({ entity: text, accountableOfficer: text, accountableDesignation: text, accountabilityAssumedDate: text, custodian: text, custodianDesignation: text, committeeChair: text, committeeChairDesignation: text, committeeMember: text, committeeMemberDesignation: text, schoolHead: text, schoolHeadDesignation: text });
const countSchema = z.object({ family: z.enum(["rpcsp", "rpcppe"]), code: text, asOfDate: text, fundCluster: text, office: text.nullable(), sectionScope: z.array(z.object({ id: text, name: text, sheetName: text })).optional(), metadata, profile: z.object({ definition }), lines: z.array(z.object({ lotId: text, status: text, snapshot: z.object({ description: text, propertyNumber: text.nullable(), unit: text, unitValue: text.nullable(), cardQuantity: z.number(), supplier: text.nullable().optional(), acquiredOn: text.nullable().optional(), yearLabel: text.nullable().optional() }), section: z.object({ name: text, sheetName: text, order: z.number() }), physicalQuantity: z.number().optional(), conditionBreakdown: z.array(z.object({ condition: text, quantity: z.number() })).nullable().optional(), remarks: text.nullable().optional(), variance: z.object({ quantity: z.number(), value: text.nullable(), status: text }).nullable() })), membershipExclusions: z.array(z.object({ reason: text })).optional(), totals: z.object({ shortageValue: text, overageValue: text }) }).refine((value) => value.lines.every((line) => line.status !== "counted" || (line.physicalQuantity !== undefined && line.snapshot.unitValue !== null && /^\d+\.\d{2}$/.test(line.snapshot.unitValue) && line.variance !== null && line.variance.value !== null && /^-?\d+\.\d{2}$/.test(line.variance.value))));
const cardSchema = z.object({ family: z.string().optional(), entity: text, fundCluster: text, office: text.nullable(), asOfDate: text, item: z.object({ code: text, article: text, description: text, unit: text, reorderPoint: z.number().nullable() }), profile: z.object({ definition }), entries: z.array(z.object({ id: text, effectiveDate: text, reference: text, office: text, delta: z.number(), balanceAfter: z.number(), daysToConsume: z.number().nullable() })) });

type Count = z.infer<typeof countSchema>;
type Card = z.infer<typeof cardSchema>;
const printableCss = `
#inventory-print { color: #000; background: #fff; font-family: "Arial Narrow", Arial, sans-serif; }
#inventory-print table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
#inventory-print th, #inventory-print td { border: 0.5pt solid #000; padding: 2pt; vertical-align: top; overflow-wrap: anywhere; }
#inventory-print th { text-align: center; vertical-align: middle; }
#inventory-print thead { display: table-header-group; }
#inventory-print tr, #inventory-print .signatures { break-inside: avoid; }
#inventory-print .report-title { text-align: center; font-weight: bold; }
#inventory-print .form-page { background: #fff; margin: 1rem 0; padding: 0.5rem; }
#inventory-print .signatures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-top: 1rem; text-align: center; font-size: 9pt; }
@media print { body * { visibility: hidden !important; } #inventory-print, #inventory-print * { visibility: visible !important; } #inventory-print { position: absolute; left: 0; top: 0; width: 100%; } #inventory-print .form-page { padding: 0; margin: 0; break-after: page; } #inventory-print .form-page:last-child { break-after: auto; } }
`;

export function InventoryReportPreview({ id, role }: { id: string; role: NavigationRole }) {
  const manager = role === "admin" || role === "property_custodian";
  const report = useQuery({ queryKey: ["inventory-report", id], queryFn: () => client.inventoryReports.get({ exportId: id }), enabled: manager });
  if (!manager) return <section className="p-6"><h1 className="text-2xl font-semibold">Inventory report</h1><p>This workspace is unavailable for your account.</p></section>;
  if (report.isLoading) return <div className="p-6"><LoadingState label="Loading report" /></div>;
  if (report.isError || !report.data) return <div className="p-6"><ErrorState description="This report is unavailable." onRetry={() => void report.refetch()} /></div>;
  const parsedCount = report.data.family === "stock_card" ? null : countSchema.safeParse(report.data.payload);
  const parsedCard = report.data.family === "stock_card" ? cardSchema.safeParse(report.data.payload) : null;
  if ((parsedCount && !parsedCount.success) || (parsedCard && !parsedCard.success)) return <section className="p-6"><p>Report snapshot could not be displayed.</p></section>;
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header><a className="text-sm underline" href="/property-inventory/reports">Report history</a><h1 className="mt-3 text-2xl font-semibold">{report.data.filename}</h1><p className="break-all text-xs text-muted-foreground">Snapshot SHA-256 {report.data.dataHash} · Original workbook SHA-256 {report.data.checksum}</p><div className="mt-3 flex gap-4"><a className="text-sm underline" href={`/api/inventory-reports/${id}/download`}>Download Excel</a><Button type="button" variant="outline" onClick={() => window.print()}>Print / Save as PDF</Button></div></header><style>{printableCss + `@media print { @page { size: A4 ${report.data.family === "stock_card" ? "portrait" : "landscape"}; margin: 10mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; } } }`}</style><div id="inventory-print">{parsedCount?.success ? <CountForms count={parsedCount.data} /> : parsedCard?.success ? <StockCard card={parsedCard.data} /> : null}</div></section>;
}

function CountForms({ count }: { count: Count }) {
  return <>{count.profile.definition.sheets.map((profile) => {
    const lines = count.lines.filter((line) => line.section.sheetName === profile.name && line.status === "counted").sort((a, b) => a.section.order - b.section.order || a.lotId.localeCompare(b.lotId));
    const groups: Array<{ name: string; lines: typeof lines }> = [];
    for (const line of lines) { const group = groups.at(-1); if (group?.name === line.section.name) group.lines.push(line); else groups.push({ name: line.section.name, lines: [line] }); }
    const sum = (selected: typeof lines) => selected.reduce((total, line) => ({ card: total.card + line.snapshot.cardQuantity, physical: total.physical + (line.physicalQuantity ?? 0), quantity: total.quantity + (line.variance?.quantity ?? 0), cents: total.cents + BigInt(line.variance!.value!.replace(".", "")), unitCents: total.unitCents + BigInt(line.snapshot.unitValue!.replace(".", "")) }), { card: 0, physical: 0, quantity: 0, cents: BigInt(0), unitCents: BigInt(0) });
    const money = (cents: bigint) => { const sign = cents < BigInt(0) ? "-" : ""; const absolute = cents < BigInt(0) ? -cents : cents; return `${sign}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`; };
    const totals = sum(lines), shortage = sum(lines.filter((line) => line.variance?.status === "shortage")), overage = sum(lines.filter((line) => line.variance?.status === "overage"));
    const heading = (style: z.infer<typeof headingStyle> | undefined): CSSProperties | undefined => style ? { fontFamily: style.font, fontSize: `${style.size}pt`, fontWeight: style.bold ? "bold" : "normal", fontStyle: style.italic ? "italic" : "normal", textDecoration: style.underline ? "underline" : "none", textAlign: style.alignment ?? "center" as const } : undefined;
    const headerBorder = (row: number, column: number, rowSpan = 1, columnSpan = 1): CSSProperties | undefined => {
      const borders = profile.headerBorders;
      if (!borders) return undefined;
      const edge = (code: string | undefined) => code === "m" ? "1.5pt solid black" : code === "t" ? "0.5pt solid black" : "none";
      return { borderTop: edge(borders[row]?.[column]?.[0]), borderRight: edge(borders[row]?.[column + columnSpan - 1]?.[1]), borderBottom: edge(borders[row + rowSpan - 1]?.[column]?.[2]), borderLeft: edge(borders[row]?.[column]?.[3]) };
    };
    const detailBorder = (section: string, index: number, column: number, length: number, merged = false): CSSProperties | undefined => {
      const rules = profile.detailBordersBySection?.[section] ?? profile.detailBorders;
      if (!rules) return undefined;
      const position = length === 1 ? "single" : index === 0 ? "first" : index === length - 1 ? "last" : "middle";
      const code = rules[position][column];
      const bottom = merged && length > 1 ? rules.last[column]?.[2] : code?.[2];
      const edge = (value: string | undefined) => value === "m" ? "1.5pt solid black" : value === "t" ? "0.5pt solid black" : "none";
      return { borderTop: edge(code?.[0]), borderRight: edge(code?.[1]), borderBottom: edge(bottom), borderLeft: edge(code?.[3]) };
    };
    const people: Record<string, [string, string]> = { custodian: [count.metadata.custodian, count.metadata.custodianDesignation], committee_chair: [count.metadata.committeeChair, count.metadata.committeeChairDesignation], committee_member: [count.metadata.committeeMember, count.metadata.committeeMemberDesignation], school_head: [count.metadata.schoolHead, count.metadata.schoolHeadDesignation] };
    return <section className="form-page" key={profile.name} style={{ fontFamily: profile.font, fontSize: `${profile.fontSize}pt` }}>
      <p style={heading(profile.headingStyles?.label) ?? { textAlign: count.family === "rpcppe" ? "right" : "center" }}>{profile.label}</p>{count.sectionScope?.length ? <p>Partial count — selected sections: {count.sectionScope.map((section) => section.name).join(", ")}</p> : null}
      <h2 className="report-title" style={heading(profile.headingStyles?.title)}>{profile.reportTitle ?? (count.family === "rpcsp" ? "REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY" : "REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT")}</h2>
      <p className="report-title" style={heading(profile.headingStyles?.type)}>{profile.title}</p><p className="report-title" style={heading(profile.headingStyles?.caption)}>{profile.typeCaption ?? (count.family === "rpcsp" ? "(Type of Semi-Expendable Property)" : "(Type of Property, Plant and Equipment)")}</p><p className="report-title" style={heading(profile.headingStyles?.date)}>As of {formatProfileAsOf(count.asOfDate, count.profile.definition.asOfDisplay)}</p>
      <p>Fund Cluster: {count.fundCluster} <span style={{ float: "right" }}>Entity Name: {count.metadata.entity}</span></p>
      <p>For which {count.metadata.accountableOfficer}, {count.metadata.accountableDesignation}, is accountable as of {count.metadata.accountabilityAssumedDate}</p>
      <table><colgroup>{profile.columns.map((column, index) => <col key={index} style={{ width: `${column.width / profile.columns.reduce((total, value) => total + value.width, 0) * 100}%` }} />)}</colgroup>
        {count.family === "rpcsp" ? <thead><tr>{profile.columns.slice(0, 7).map((column, index) => <th key={index} rowSpan={2} style={headerBorder(0, index, 2)}>{column.label}</th>)}<th style={headerBorder(0, 7)}>SHORTAGE/COVERAGE</th><th aria-label="Shortage value heading" style={headerBorder(0, 8)} /><th rowSpan={2} style={headerBorder(0, 9, 2)}>{profile.columns[9]?.label}</th></tr><tr><th style={headerBorder(1, 7)}>{profile.columns[7]?.label}</th><th style={headerBorder(1, 8)}>{profile.columns[8]?.label}</th></tr></thead> : <thead><tr>{profile.columns.slice(0, 5).map((column, index) => <th key={index} rowSpan={3} style={headerBorder(0, index, 3)}>{column.label}</th>)}<th style={headerBorder(0, 5)}>QUANTITY</th><th style={headerBorder(0, 6)}>QUANTITY</th><th colSpan={2} rowSpan={2} style={headerBorder(0, 7, 2, 2)}>SHORTAGE/OVERAGE</th>{profile.columns.slice(9, 12).map((column, index) => <th key={index} rowSpan={3} style={headerBorder(0, index + 9, 3)}>{column.label}</th>)}</tr><tr><th style={headerBorder(1, 5)}>per</th><th style={headerBorder(1, 6)}>per</th></tr><tr>{profile.columns.slice(5, 9).map((column, index) => <th key={index} style={headerBorder(2, index + 5)}>{column.label}</th>)}</tr></thead>}
        <tbody>{groups.flatMap((group) => { const subtotal = sum(group.lines); return [...group.lines.map((line, index) => <tr key={line.lotId}>{index === 0 ? <td rowSpan={group.lines.length} style={detailBorder(group.name, index, 0, group.lines.length, true)}><span style={{ ...heading(profile.articleStylesBySection?.[group.name] ?? profile.articleStyle), ...(profile.articleRotation === 90 ? { writingMode: "vertical-rl", transform: "rotate(180deg)", display: "inline-block" } : {}) }}>{group.name}</span></td> : null}<td style={detailBorder(group.name, index, 1, group.lines.length)}>{line.snapshot.description}</td><td style={detailBorder(group.name, index, 2, group.lines.length)}>{line.snapshot.propertyNumber ?? ""}</td><td style={detailBorder(group.name, index, 3, group.lines.length)}>{line.snapshot.unit}</td><td style={detailBorder(group.name, index, 4, group.lines.length)}>{line.snapshot.unitValue ?? ""}</td><td style={detailBorder(group.name, index, 5, group.lines.length)}>{line.snapshot.cardQuantity}</td><td style={detailBorder(group.name, index, 6, group.lines.length)}>{line.physicalQuantity ?? ""}</td><td style={detailBorder(group.name, index, 7, group.lines.length)}>{line.variance?.quantity ?? ""}</td><td style={detailBorder(group.name, index, 8, group.lines.length)}>{line.variance?.value ?? ""}</td>{count.family === "rpcppe" ? <><td style={detailBorder(group.name, index, 9, group.lines.length)}>{line.snapshot.supplier ?? ""}</td><td style={detailBorder(group.name, index, 10, group.lines.length)}>{line.snapshot.yearLabel ?? line.snapshot.acquiredOn?.slice(0, 4) ?? ""}</td></> : null}<td style={detailBorder(group.name, index, count.family === "rpcsp" ? 9 : 11, group.lines.length)}>{[line.remarks, line.conditionBreakdown?.map((part) => `${part.condition.replaceAll("_", " ")}: ${part.quantity}`).join(", ")].filter(Boolean).join("; ")}</td></tr>), ...(profile.subtotalAfterSections?.includes(group.name) ? [<tr key={`subtotal-${group.name}`}><th colSpan={4}>SUBTOTAL</th><td>{profile.sumUnitValues ? money(subtotal.unitCents) : ""}</td><td>{subtotal.card}</td><td>{subtotal.physical}</td><td>{subtotal.quantity}</td><td>{money(subtotal.cents)}</td><td colSpan={count.family === "rpcsp" ? 1 : 3} /></tr>] : [])]; })}{!lines.length ? <tr><td colSpan={profile.columns.length}>&nbsp;</td></tr> : null}
          <tr><th colSpan={4}>TOTAL</th><td>{profile.sumUnitValues ? money(totals.unitCents) : ""}</td><td>{totals.card}</td><td>{totals.physical}</td><td>{totals.quantity}</td><td>{money(totals.cents)}</td><td colSpan={count.family === "rpcsp" ? 1 : 3} /></tr>
          {[ ["SHORTAGE", shortage], ["OVERAGE", overage] ] .map(([label, total]) => { const value = total as typeof shortage; return <tr key={String(label)}><th colSpan={7}>{String(label)}</th><td>{value.quantity}</td><td>{money(value.cents)}</td><td colSpan={count.family === "rpcsp" ? 1 : 3} /></tr>; })}
        </tbody></table>
      <p>Certified Correct by: <span style={{ float: "right" }}>Noted by:</span></p>
      <div className="signatures" style={{ gridTemplateColumns: `repeat(${profile.columns.length}, minmax(0, 1fr))` }}>{profile.signatures.map((signature) => <div key={signature.role} style={{ gridColumn: `${signature.startColumn} / ${signature.endColumn + 1}`, gridRow: signature.rowOffset + 1 }}><strong style={signature.underlineName ? { textDecoration: "underline" } : undefined}>{people[signature.role]?.[0]}</strong>{signature.signatureLabel ? <><br /><span>{signature.signatureLabel}</span></> : null}<br />{people[signature.role]?.[1]}</div>)}</div>
      {count.family === "rpcppe" && count.profile.definition.thresholdNote ? <p>{count.profile.definition.thresholdNote}{count.profile.definition.thresholdExample ? <><br />{count.profile.definition.thresholdExample}</> : null}</p> : null}
    </section>;
  })}</>;
}
function StockCard({ card }: { card: Card }) {
  const profile = card.profile.definition.sheets[0];
  const capacity = profile?.stockCardPageRows ?? 26;
  type StockRow = { entry: Card["entries"][number]; reference: string; office: string; first: boolean; offset: number };
  const pages: Array<{ carry: number | null; rows: StockRow[] }> = [];
  let carry: number | null = null, rows: StockRow[] = [], priorBalance = 0;
  for (const entry of card.entries) {
    const references = splitReportText(entry.reference, profile?.columns[1]?.width ?? 14, 12, profile?.continuationRows ?? false);
    const offices = splitReportText(entry.office, profile?.columns[4]?.width ?? 14, 12, profile?.continuationRows ?? false);
    const count = Math.max(references.length, offices.length);
    for (let offset = 0; offset < count; offset++) {
      if (rows.length + (carry === null ? 0 : 1) === capacity) {
        pages.push({ carry, rows });
        carry = offset ? entry.balanceAfter : priorBalance;
        rows = [];
      }
      rows.push({ entry, reference: references[offset] ?? "", office: offices[offset] ?? "", first: offset === 0, offset });
    }
    priorBalance = entry.balanceAfter;
  }
  if (rows.length || !pages.length) pages.push({ carry, rows });
  return <>{pages.map((page, pageIndex) => <section key={pageIndex} className="form-page" style={{ fontFamily: "Times New Roman, serif" }}><p style={{ textAlign: "right" }}>{profile?.label ?? "Appendix 58"}</p><h2 className="report-title">{profile?.reportTitle ?? "STOCK CARD"}</h2><p>Entity Name: {card.entity} <span style={{ float: "right" }}>Fund Cluster: {card.fundCluster}</span></p><p>Item: {card.item.article} <span style={{ float: "right" }}>Stock No.: {card.item.code}</span></p><p>Description: {card.item.description} <span style={{ float: "right" }}>Re-order Point: {card.item.reorderPoint ?? ""}</span></p><p>Unit of Measurement: {card.item.unit} · Office: {card.office ?? "All offices"} · As of {card.asOfDate}</p><table><thead><tr><th rowSpan={2}>Date</th><th rowSpan={2}>Reference</th><th>Receipt</th><th colSpan={2}>Issue</th><th>Balance</th><th rowSpan={2}>No. of Days to Consume</th></tr><tr><th>Qty.</th><th>Qty.</th><th>Office</th><th>Qty.</th></tr></thead><tbody>{page.carry !== null ? <tr><td /><td>Balance brought forward</td><td /><td /><td /><td>{page.carry}</td><td /></tr> : null}{page.rows.map(({ entry, reference, office, first, offset }) => <tr key={`${entry.id}:${offset}`}><td>{first ? entry.effectiveDate : ""}</td><td>{reference}</td><td>{first && entry.delta > 0 ? entry.delta : ""}</td><td>{first && entry.delta < 0 ? -entry.delta : ""}</td><td>{office}</td><td>{first ? entry.balanceAfter : ""}</td><td>{first ? entry.daysToConsume ?? "" : ""}</td></tr>)}{!page.rows.length ? <tr><td colSpan={7}>&nbsp;</td></tr> : null}</tbody></table></section>)}</>;
}
