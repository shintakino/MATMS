"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import type { NavigationRole } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/ui-states";
import { WorkflowGuidance, InventoryTerms } from "@/components/workflow-guidance";
import { client } from "@/utils/orpc";

const selectClass = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const get = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const conditions = ["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved", "mixed"] as const;
const breakdownConditions = conditions.filter((condition): condition is Exclude<typeof conditions[number], "mixed" | "mixed_unresolved"> => condition !== "mixed" && condition !== "mixed_unresolved");
type Detail = Awaited<ReturnType<typeof client.physicalCounts.get>>;
type Line = Detail["lines"][number];
type RefreshPlan = Awaited<ReturnType<typeof client.physicalCounts.previewRefresh>>;

export function PhysicalCountDetail({ id, role }: { id: string; role: NavigationRole }) {
  const manager = role === "admin" || role === "property_custodian";
  const queryClient = useQueryClient();
  const operationIds = useRef(new Map<string, string>());
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [refreshPlan, setRefreshPlan] = useState<RefreshPlan | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reportPreview, setReportPreview] = useState<Awaited<ReturnType<typeof client.inventoryReports.previewCount>> | null>(null);
  const [reportResult, setReportResult] = useState<{ id: string; filename: string } | null>(null);
  const detail = useQuery({ queryKey: ["physical-count", id], queryFn: () => client.physicalCounts.get({ countId: id }), enabled: role !== "viewer" });
  const config = useQuery({ queryKey: ["custodial-configuration"], queryFn: () => client.physicalCounts.configuration(), enabled: manager });
  const assignees = useQuery({ queryKey: ["count-assignees"], queryFn: () => client.physicalCounts.assignees(), enabled: manager });
  async function invalidate() { await Promise.all([queryClient.invalidateQueries({ queryKey: ["physical-count", id] }), queryClient.invalidateQueries({ queryKey: ["physical-counts"] })]); }
  async function run(key: string, action: (operationId: string) => Promise<unknown>, success: string) {
    const operationId = operationIds.current.get(key) ?? crypto.randomUUID(); operationIds.current.set(key, operationId);
    setPending(true); setFeedback(null);
    try { await action(operationId); operationIds.current.delete(key); await invalidate(); setFeedback(success); return true; }
    catch (error) { setFeedback(error instanceof Error ? error.message : "The operation could not be completed."); return false; }
    finally { setPending(false); }
  }
  async function loadRefresh() {
    setPending(true); setFeedback(null);
    try { setRefreshPlan(await client.physicalCounts.previewRefresh({ countId: id })); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Refresh preview is unavailable."); }
    finally { setPending(false); }
  }
  async function previewReport() {
    setPending(true); setFeedback(null);
    try { const result = await client.inventoryReports.previewCount({ countId: id }); setReportPreview(result); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Report preview is unavailable."); }
    finally { setPending(false); }
  }
  async function generateReport() {
    const key = `report:${id}`; const operationId = operationIds.current.get(key) ?? crypto.randomUUID(); operationIds.current.set(key, operationId); setPending(true); setFeedback(null);
    try { const result = await client.inventoryReports.generate({ kind: "count", countId: id, operationId }); operationIds.current.delete(key); setReportResult(result); setFeedback("Workbook generated and saved to report history."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Workbook could not be generated."); }
    finally { setPending(false); }
  }
  async function applyRefresh(data: FormData) {
    if (!refreshPlan) return;
    const includeLotIds: string[] = [], excludeLots: Array<{ lotId: string; reason: string }> = [];
    for (const source of refreshPlan.added) {
      const choice = get(data, `choice-${source.lotId}`);
      if (choice === "include") includeLotIds.push(source.lotId);
      if (choice === "exclude") {
        const reason = get(data, `reason-${source.lotId}`);
        if (!reason) { setFeedback("Provide a reason for every excluded item."); return; }
        excludeLots.push({ lotId: source.lotId, reason });
      }
    }
    for (const omitted of refreshPlan.omitted) if (omitted.currentlyAvailable && !refreshPlan.added.some((source) => source.lotId === omitted.lotId) && data.get(`restore-${omitted.lotId}`)) includeLotIds.push(omitted.lotId);
    const input = { countId: id, expectedVersion: refreshPlan.version, planHash: refreshPlan.planHash, includeLotIds, excludeLots };
    if (await run(`refresh:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.refresh({ ...input, operationId }), "Count sources refreshed. Review changed or unavailable lines.")) setRefreshPlan(null);
  }
  if (role === "viewer") return <section className="p-6"><h1 className="text-2xl font-semibold">Physical count</h1><p>This workspace is unavailable for your account.</p></section>;
  if (detail.isLoading) return <div className="p-6"><LoadingState label="Loading physical count" /></div>;
  if (detail.isError || !detail.data) return <div className="p-6"><ErrorState description="This count is unavailable." onRetry={() => void detail.refetch()} /></div>;
  const { count, lines, assignments, sourceChanges } = detail.data;
  const draft = count.status === "draft";
  const uncounted = lines.filter((line) => line.status === "uncounted").length;
  const needsReview = lines.filter((line) => line.reviewRequired || (line.status === "counted" && !line.resolution && (line.physicalQuantity !== line.snapshot.cardQuantity || !["serviceable", "operational"].includes(line.condition ?? "")))).length;
  const changedSources = sourceChanges ? sourceChanges.added + sourceChanges.changed + sourceChanges.unavailable : 0;
  const profile = config.data?.profiles.find((entry) => entry.id === count.profileId);
  const definition = profile?.definition as { sheets?: Array<{ name?: string }> } | undefined;
  const sheets = definition?.sheets?.map((sheet) => sheet.name).filter((name): name is string => typeof name === "string") ?? [];
  const previewPayload = reportPreview?.payload && typeof reportPreview.payload === "object" ? reportPreview.payload as { membershipExclusions?: Array<{ reason?: string }>; totals?: { shortageValue?: string; overageValue?: string }; metadata?: { custodian?: string; committeeChair?: string; committeeMember?: string; schoolHead?: string } } : null;
  async function finalize(data: FormData) {
    const reviewedSheets = sheets.filter((sheet) => data.get(`sheet-${sheet}`));
    if (!sheets.length || reviewedSheets.length !== sheets.length) { setFeedback("Review and select every form sheet before finalizing."); return; }
    const input = { countId: id, expectedVersion: count.version, reviewedSheets };
    if (await run(`finalize:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.finalize({ ...input, operationId }), "Count finalized. Its report data is now frozen.")) setFinalizeOpen(false);
  }
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header><a className="text-sm underline" href="/property-inventory/counts">Physical counts</a><h1 className="mt-3 text-2xl font-semibold">{count.code}</h1><p className="text-sm">{count.family.toUpperCase()} · {count.status} · {count.fundCluster} / {count.office ?? "All offices"} · {count.asOfDate}</p><p className="text-sm text-muted-foreground">{count.sectionIds.length ? `Partial count: ${count.sectionIds.length} selected section(s).` : "All report sections included."} Physical counts do not post stock adjustments.</p></header>
    <WorkflowGuidance title="Count progress" steps={[
      { label: "Session created", description: "The date, report layout and scope are saved.", complete: true },
      { label: "Enter observations", description: `${uncounted} uncounted line(s) in your visible scope.`, complete: !draft || uncounted === 0, target: "count-observations" },
      { label: "Review and finalize", description: draft ? `${needsReview} line(s) flagged for review; ${changedSources} source change(s).` : "The finalized snapshot is saved.", complete: !draft, target: manager && draft ? (changedSources ? "count-refresh" : "count-finalization") : undefined },
      ...(manager ? [{ label: "Generate workbook", description: "Review the frozen data and generate the official form.", complete: reportResult !== null, target: !draft ? "count-workbook" : undefined }] : []),
    ]} next={!draft ? manager ? "This count is finalized. Review the report scope before generating a workbook; use a linked amendment for corrections." : "This count is finalized." : !manager ? "Save observations for your assigned lines. An Administrator or Property Custodian handles review and finalization." : changedSources ? "Source records changed. Preview and apply reviewed source changes before finalizing." : uncounted ? `Enter observations or record a reason for exclusion/unavailability for the ${uncounted} uncounted line(s).` : "Review each line, condition, signatory and report sheet. The server checks all requirements when you finalize."} target={draft ? changedSources && manager ? "count-refresh" : manager && uncounted === 0 && needsReview === 0 ? "count-finalization" : "count-observations" : manager ? "count-workbook" : undefined} />
    <InventoryTerms />
    {sourceChanges ? <p className="rounded-lg border p-4 text-sm">Source changes: {sourceChanges.added} new, {sourceChanges.changed} changed, {sourceChanges.unavailable} unavailable. Preview and refresh before finalization.</p> : null}
    <p role="status" aria-live="polite" className="text-sm">{feedback}</p>
    {manager ? <CountSummary lines={lines} /> : null}
    {manager && draft ? <>
      <details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Assign Staff</summary><form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const input = { countId: id, userId: get(data, "user"), lineId: get(data, "line") || null, active: true }; void run(`assign:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.assign({ ...input, operationId }), "Assignment saved."); }}><label>Staff member<select className={selectClass} name="user" required><option value="">Select Staff</option>{assignees.data?.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Scope<select className={selectClass} name="line"><option value="">Entire draft session</option>{lines.map((line) => <option key={line.id} value={line.id}>{String(line.snapshot.article ?? line.lotId)} · {String(line.snapshot.propertyNumber ?? "No property number")}</option>)}</select></label><div><Button disabled={pending} type="submit">Assign</Button></div></form>{assignments.filter((assignment) => assignment.active).length ? <ul className="mt-4 space-y-2">{assignments.filter((assignment) => assignment.active).map((assignment) => <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{assignees.data?.find((user) => user.id === assignment.userId)?.name ?? "Unavailable Staff"} · {assignment.lineId ? "One line" : "Entire session"}</span><Button size="sm" variant="outline" disabled={pending} onClick={() => { const input = { countId: id, userId: assignment.userId, lineId: assignment.lineId, active: false }; void run(`assign:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.assign({ ...input, operationId }), "Assignment revoked."); }}>Revoke</Button></li>)}</ul> : null}</details>
      <section id="count-refresh" className="scroll-mt-24 rounded-lg border bg-card p-5"><h2 className="font-semibold">Refresh count sources</h2><p className="text-sm text-muted-foreground">New items require an explicit inclusion or reason for exclusion. Saved counts are retained and changed lines require review.</p><Button className="mt-3" variant="outline" disabled={pending} onClick={() => void loadRefresh()}>Preview changes</Button>{refreshPlan ? <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void applyRefresh(new FormData(event.currentTarget)); }}><p className="text-sm">{refreshPlan.changed.length} changed lines · {refreshPlan.unavailable.length} unavailable lines</p>{refreshPlan.added.map((source) => <div key={source.lotId} className="rounded-md border p-3"><p className="text-sm font-medium">{String(source.snapshot.article ?? "Item")} · {String(source.snapshot.propertyNumber ?? "No property number")}</p><label>Decision<select className={selectClass} name={`choice-${source.lotId}`} defaultValue=""><option value="">Leave for later review</option><option value="include">Include in count</option><option value="exclude">Exclude with reason</option></select></label><label>Reason for exclusion<Input name={`reason-${source.lotId}`} maxLength={1000} /></label></div>)}{refreshPlan.omitted.filter((entry) => entry.currentlyAvailable && !refreshPlan.added.some((source) => source.lotId === entry.lotId)).map((entry) => <label className="block text-sm" key={entry.lotId}><input type="checkbox" name={`restore-${entry.lotId}`} /> Include previously excluded item: {String(entry.snapshot && typeof entry.snapshot === "object" && "article" in entry.snapshot ? entry.snapshot.article : entry.lotId)} · {entry.reason}</label>)}<Button disabled={pending} type="submit">Apply reviewed changes</Button></form> : null}</section>
    </> : null}
    <section id="count-observations" className="scroll-mt-24 space-y-3"><h2 className="font-semibold">Count lines</h2>{lines.length === 0 ? <p className="text-sm text-muted-foreground">No lines in this scope.</p> : null}{lines.map((line) => <CountLine key={line.id} line={line} draft={draft} manager={manager} pending={pending} run={run} countId={id} />)}</section>
    {manager && draft ? <section id="count-finalization" className="scroll-mt-24 rounded-lg border bg-card p-5"><h2 className="font-semibold">Finalize count</h2><p className="text-sm text-muted-foreground">Review every line, source change, signatory and sheet before freezing this count. Finalization never changes stock.</p><form id="finalize-count" className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); setFeedback(null); setFinalizeOpen(true); }}>{sheets.map((sheet) => <label className="block text-sm" key={sheet}><input type="checkbox" required name={`sheet-${sheet}`} /> Reviewed {sheet}</label>)}<Button type="submit" disabled={pending || sheets.length === 0}>Review finalization</Button></form><AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Finalize this count?</AlertDialogTitle><AlertDialogDescription>The snapshot and membership will be frozen. Corrections require a linked amendment.</AlertDialogDescription></AlertDialogHeader>{feedback ? <p role="alert" className="text-sm text-destructive">{feedback}</p> : null}<AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); const form = document.getElementById("finalize-count"); if (form instanceof HTMLFormElement) void finalize(new FormData(form)); }}>Finalize count</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section> : null}
    {manager && !draft ? <><section id="count-workbook" className="scroll-mt-24 rounded-lg border bg-card p-5"><h2 className="font-semibold">Finalized workbook</h2><p className="text-sm text-muted-foreground">Review the frozen count and its form profile before generating the full three-sheet workbook.</p><Button className="mt-3" variant="outline" disabled={pending} onClick={() => void previewReport()}>Review report scope</Button>{reportPreview ? <div className="mt-3 space-y-2 text-sm"><p>{reportPreview.family.toUpperCase()} · {count.fundCluster} / {count.office ?? "All offices"} · {count.asOfDate} · {lines.filter((line) => line.status === "counted").length} counted lines · {lines.filter((line) => line.status !== "counted").length} resolved lines</p><p>Profile {reportPreview.profileId} · Snapshot SHA-256 {reportPreview.dataHash}</p><p>Membership exclusions: {previewPayload?.membershipExclusions?.length ?? 0} · Shortage: ₱{previewPayload?.totals?.shortageValue ?? "Unavailable"} · Overage: ₱{previewPayload?.totals?.overageValue ?? "Unavailable"}</p>{previewPayload?.membershipExclusions?.length ? <ul className="list-disc pl-5">{previewPayload.membershipExclusions.map((entry, index) => <li key={index}>{entry.reason ?? "Reason unavailable"}</li>)}</ul> : null}<p>Signatories: {previewPayload?.metadata?.custodian ?? "Unavailable"}; {previewPayload?.metadata?.committeeChair ?? "Unavailable"}; {previewPayload?.metadata?.committeeMember ?? "Unavailable"}; {previewPayload?.metadata?.schoolHead ?? "Unavailable"}</p><p>{count.sectionIds.length ? "Partial count; selected sections only. " : "All sections included. "}Workbook sheets: {sheets.join(", ")}</p><Button disabled={pending} onClick={() => void generateReport()}>{pending ? "Generating…" : "Generate Excel workbook"}</Button></div> : null}{reportResult ? <p className="mt-3 text-sm"><a className="underline" href={`/api/inventory-reports/${reportResult.id}/download`}>Download {reportResult.filename}</a> · <a className="underline" href={`/property-inventory/reports/${reportResult.id}`}>Preview and print</a></p> : null}</section><details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Create linked amendment</summary><form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const input = { countId: id, code: get(data, "code"), reason: get(data, "reason") }; void run(`amend:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.amend({ ...input, operationId }), "Amendment created. Open it from the count list."); }}><label>Amendment code<Input name="code" required /></label><label>Reason<Input name="reason" required /></label><div><Button disabled={pending} type="submit">Create amendment</Button></div></form></details></> : null}
  </section>;
}

function CountSummary({ lines }: { lines: Line[] }) {
  const groups = new Map<string, { section: string; unit: string; card: bigint; physical: bigint; shortage: bigint; overage: bigint; shortageValue: bigint; overageValue: bigint; unavailableValue: number }>();
  let matched = 0, uncounted = 0, excluded = 0, unavailable = 0;
  for (const line of lines) {
    if (line.status === "excluded") { excluded++; continue; }
    if (line.status === "unavailable") { unavailable++; continue; }
    if (line.status === "uncounted") uncounted++;
    if (line.variance?.status === "matched") matched++;
    const section = line.snapshot.section && typeof line.snapshot.section === "object" && "name" in line.snapshot.section && typeof line.snapshot.section.name === "string" ? line.snapshot.section.name : "Unassigned section";
    const unit = typeof line.snapshot.unit === "string" ? line.snapshot.unit : "Unknown unit";
    const key = JSON.stringify([section, unit]);
    const group = groups.get(key) ?? { section, unit, card: BigInt(0), physical: BigInt(0), shortage: BigInt(0), overage: BigInt(0), shortageValue: BigInt(0), overageValue: BigInt(0), unavailableValue: 0 };
    group.card += BigInt(line.snapshot.cardQuantity);
    if (line.physicalQuantity !== null) group.physical += BigInt(line.physicalQuantity);
    if (line.variance) {
      const quantity = BigInt(line.variance.quantity);
      if (quantity < BigInt(0)) group.shortage -= quantity; else group.overage += quantity;
      if (line.variance.value === null) group.unavailableValue++;
      else {
        const cents = BigInt(line.variance.value.replace(".", ""));
        if (cents < BigInt(0)) group.shortageValue -= cents; else group.overageValue += cents;
      }
    }
    groups.set(key, group);
  }
  const money = (cents: bigint) => `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
  const totals = new Map<string, (typeof groups extends Map<string, infer T> ? T : never)>();
  for (const group of groups.values()) {
    const total = totals.get(group.unit) ?? { section: "All sections", unit: group.unit, card: BigInt(0), physical: BigInt(0), shortage: BigInt(0), overage: BigInt(0), shortageValue: BigInt(0), overageValue: BigInt(0), unavailableValue: 0 };
    total.card += group.card; total.physical += group.physical; total.shortage += group.shortage; total.overage += group.overage; total.shortageValue += group.shortageValue; total.overageValue += group.overageValue; total.unavailableValue += group.unavailableValue;
    totals.set(group.unit, total);
  }
  const report = [...totals.values()].reduce((sum, group) => ({ shortage: sum.shortage + group.shortageValue, overage: sum.overage + group.overageValue, unavailable: sum.unavailable + group.unavailableValue }), { shortage: BigInt(0), overage: BigInt(0), unavailable: 0 });
  return <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Count summary</h2><p className="mt-2 text-sm">{matched} matched · {uncounted} uncounted · {excluded} excluded lines · {unavailable} unavailable lines</p><p className="text-sm">Known shortage value: ₱{money(report.shortage)} · Known overage value: ₱{money(report.overage)}{report.unavailable ? ` · ${report.unavailable} valuation(s) unavailable` : ""}</p><p className="text-sm text-muted-foreground">Card totals include uncounted lines; physical totals include counted lines. Excluded and unavailable lines are not included in totals.</p>{groups.size ? <ul className="mt-3 space-y-2">{[...totals.values(), ...groups.values()].map((group, index) => <li className="text-sm" key={`${index}:${group.section}:${group.unit}`}><strong>{group.section} · {group.unit}</strong>: Card {group.card.toString()} · Physical {group.physical.toString()} · Shortage {group.shortage.toString()} (₱{money(group.shortageValue)}) · Overage {group.overage.toString()} (₱{money(group.overageValue)}){group.unavailableValue ? ` · ${group.unavailableValue} valuation(s) unavailable` : ""}</li>)}</ul> : <p className="mt-2 text-sm">No countable lines in this scope.</p>}</section>;
}

function CountLine({ line, draft, manager, pending, run, countId }: { line: Line; draft: boolean; manager: boolean; pending: boolean; run: (key: string, action: (id: string) => Promise<unknown>, success: string) => Promise<boolean>; countId: string }) {
  const [condition, setCondition] = useState(line.condition ?? "");
  return <article className="rounded-lg border bg-card p-4"><h3 className="font-medium">{String(line.snapshot.article ?? "Item")} · {String(line.snapshot.propertyNumber ?? "No property number")}</h3><p className="text-sm">{String(line.snapshot.description ?? "")} · Card balance: {line.snapshot.cardQuantity} · Unit value: {line.snapshot.unitValue === null ? "Unknown" : `₱${line.snapshot.unitValue}`}</p><p className="text-sm">Status: {line.status}{line.physicalQuantity !== null ? ` · Physical count: ${line.physicalQuantity}` : ""}{line.variance ? ` · Variance: ${line.variance.quantity} (${line.variance.value ?? "value unknown"})` : ""}{line.reviewRequired ? " · Review required" : ""}{line.resolution ? ` · Note: ${line.resolution}` : ""}{line.conditionBreakdown?.length ? ` · ${line.conditionBreakdown.map((entry) => `${entry.condition.replaceAll("_", " ")}: ${entry.quantity}`).join(", ")}` : ""}</p>
    {draft && (manager || (line.status !== "excluded" && line.status !== "unavailable")) ? <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const input = { countId, lineId: line.id, expectedVersion: line.version, physicalQuantity: Number(get(data, "quantity")), condition: get(data, "condition") as typeof conditions[number], ...(get(data, "condition") === "mixed" ? { conditionBreakdown: breakdownConditions.flatMap((condition) => { const quantity = get(data, `breakdown-${condition}`); return quantity ? [{ condition, quantity: Number(quantity) }] : []; }) } : {}), remarks: get(data, "remarks") || null, reviewerNote: get(data, "reviewerNote") || null }; void run(`line:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.save({ ...input, operationId }), "Physical count saved."); }}><label>Physical quantity<Input name="quantity" type="number" min={0} max={2147483647} step={1} defaultValue={line.physicalQuantity ?? ""} required /></label><label>Condition<select className={selectClass} name="condition" value={condition} onChange={(event) => setCondition(event.target.value)} required><option value="">Select condition</option>{conditions.map((condition) => <option key={condition} value={condition}>{condition.replaceAll("_", " ")}</option>)}</select></label>{condition === "mixed" ? <fieldset className="md:col-span-3"><legend>Mixed condition quantities</legend><p className="text-sm text-muted-foreground">Enter at least two positive quantities; together they must equal the physical count. A manager must review the breakdown.</p><div className="grid gap-2 md:grid-cols-3">{breakdownConditions.map((part) => <label key={part}>{part.replaceAll("_", " ")}<Input name={`breakdown-${part}`} type="number" min={1} max={2147483647} step={1} defaultValue={line.conditionBreakdown?.find((entry) => entry.condition === part)?.quantity ?? ""} /></label>)}</div></fieldset> : null}<label>Remarks<Input name="remarks" defaultValue={line.remarks ?? ""} /></label><label>Reviewer note<Input name="reviewerNote" maxLength={4000} defaultValue={line.reviewerNote ?? ""} /></label><div><Button disabled={pending} type="submit">Save count</Button></div></form> : null}
    {draft && manager ? <div className="mt-4 grid gap-3 md:grid-cols-2"><form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const input = { countId, lineId: line.id, expectedVersion: line.version, note: get(data, "note") }; void run(`review:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.review({ ...input, operationId }), "Review note saved."); }}><label>Review note<Input name="note" required /></label><Button type="submit" variant="outline" disabled={pending}>Record review</Button></form><form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const input = { countId, lineId: line.id, expectedVersion: line.version, status: get(data, "status") as "excluded" | "unavailable", reason: get(data, "reason") }; void run(`resolve:${JSON.stringify(input)}`, (operationId) => client.physicalCounts.resolve({ ...input, operationId }), "Line resolution saved."); }}><label>Resolution<select className={selectClass} name="status"><option value="excluded">Exclude</option><option value="unavailable">Mark unavailable</option></select></label><label>Reason<Input name="reason" required /></label><Button type="submit" variant="outline" disabled={pending}>Save resolution</Button></form></div> : null}
  </article>;
}
