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
const conditions = ["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"] as const;
const metadataFields = [["entity", "Entity / school"], ["accountableOfficer", "Accountable officer"], ["accountableDesignation", "Accountable officer designation"], ["custodian", "Property Custodian"], ["custodianDesignation", "Property Custodian designation"], ["committeeChair", "Committee chair"], ["committeeChairDesignation", "Committee chair designation"], ["committeeMember", "Committee member"], ["committeeMemberDesignation", "Committee member designation"], ["schoolHead", "School Head"], ["schoolHeadDesignation", "School Head designation"]] as const;
type ImportDetail = Awaited<ReturnType<typeof client.inventoryImports.get>>;
type ImportRow = ImportDetail["rows"][number];
type Targets = Awaited<ReturnType<typeof client.custodialInventory.listItems>>["rows"];
type Commit = Parameters<typeof client.inventoryImports.commit>[0];
const warningsOf = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const mappingDisposition = (value: unknown) => value && typeof value === "object" && "disposition" in value ? String(value.disposition) : "unresolved";

export function InventoryImportDetail({ id, role }: { id: string; role: NavigationRole }) {
  const manager = role === "admin" || role === "property_custodian";
  const queryClient = useQueryClient();
  const operationIds = useRef(new Map<string, string>());
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [targetQuery, setTargetQuery] = useState("");
  const [targetPage, setTargetPage] = useState(1);
  const [rowPage, setRowPage] = useState(1);
  const [review, setReview] = useState<Commit | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["custodial-import", id], queryFn: () => client.inventoryImports.get({ batchId: id }), enabled: manager });
  const config = useQuery({ queryKey: ["custodial-configuration"], queryFn: () => client.physicalCounts.configuration(), enabled: manager });
  const targets = useQuery({ queryKey: ["import-targets", targetQuery, targetPage], queryFn: () => client.custodialInventory.listItems({ page: targetPage, pageSize: 50, filters: { query: targetQuery || undefined, active: true } }), enabled: manager });
  async function invalidate() { await Promise.all([queryClient.invalidateQueries({ queryKey: ["custodial-import", id] }), queryClient.invalidateQueries({ queryKey: ["custodial-imports"] }), queryClient.invalidateQueries({ queryKey: ["physical-counts"] }), queryClient.invalidateQueries({ queryKey: ["custodial-items"] })]); }
  async function run(key: string, action: (operationId: string) => Promise<unknown>, success: string) {
    const operationId = operationIds.current.get(key) ?? crypto.randomUUID(); operationIds.current.set(key, operationId); setPending(true); setFeedback(null);
    try { await action(operationId); operationIds.current.delete(key); await invalidate(); setFeedback(success); return true; }
    catch (error) { setFeedback(error instanceof Error ? error.message : "The import action could not be completed."); return false; }
    finally { setPending(false); }
  }
  async function downloadErrors() {
    if (!detail.data) return;
    const key = `errors:${detail.data.batch.version}`; const operationId = operationIds.current.get(key) ?? crypto.randomUUID(); operationIds.current.set(key, operationId); setPending(true);
    try { const result = await client.inventoryImports.errors({ batchId: id, expectedVersion: detail.data.batch.version, operationId }); operationIds.current.delete(key); const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `inventory-import-errors-${id}.csv`; anchor.click(); URL.revokeObjectURL(url); setFeedback("Error report downloaded."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Error report could not be downloaded."); }
    finally { setPending(false); }
  }
  if (!manager) return <section className="p-6"><h1 className="text-2xl font-semibold">Inventory import</h1><p>This workspace is unavailable for your account.</p></section>;
  if (detail.isLoading) return <div className="p-6"><LoadingState label="Loading staged import" /></div>;
  if (detail.isError || !detail.data) return <div className="p-6"><ErrorState description="This import is unavailable." onRetry={() => void detail.refetch()} /></div>;
  const { batch, rows } = detail.data;
  const workbookWarnings = warningsOf(batch.warnings);
  const excluded = rows.filter((row) => mappingDisposition(row.mapping) === "exclude").length;
  const unresolved = rows.filter((row) => mappingDisposition(row.mapping) === "unresolved").length;
  const mapped = rows.length - excluded - unresolved;
  async function prepareCommit(data: FormData) {
    setReviewError(null);
    if (unresolved > 0) { setFeedback(`Resolve or exclude all ${unresolved} remaining source row(s) before reviewing the commit.`); return; }
    const effect = get(data, "effect") as Commit["effect"];
    const base = { batchId: id, sourceHash: batch.sourceHash, expectedBatchVersion: batch.version, confirmed: true as const, acknowledgedExclusions: data.get("acknowledged") === "on", operationId: crypto.randomUUID() };
    const warningResolutions = workbookWarnings.map((code, index) => ({ code, reason: get(data, `warning-${index}`) }));
    if (warningResolutions.some((entry) => !entry.reason)) { setFeedback("Resolve every workbook warning before committing."); return; }
    if (effect === "historical_ledger") { setReview({ ...base, effect, warningResolutions }); return; }
    if (effect === "verified_openings") { setReview({ ...base, effect, warningResolutions }); return; }
    const count = { code: get(data, "code"), profileId: get(data, "profile"), asOfDate: get(data, "asOfDate"), fundCluster: get(data, "fund"), office: get(data, "office") || null, warningResolutions, metadata: { entity: get(data, "entity"), accountableOfficer: get(data, "accountableOfficer"), accountableDesignation: get(data, "accountableDesignation"), accountabilityAssumedDate: get(data, "assumedDate"), custodian: get(data, "custodian"), custodianDesignation: get(data, "custodianDesignation"), committeeChair: get(data, "committeeChair"), committeeChairDesignation: get(data, "committeeChairDesignation"), committeeMember: get(data, "committeeMember"), committeeMemberDesignation: get(data, "committeeMemberDesignation"), schoolHead: get(data, "schoolHead"), schoolHeadDesignation: get(data, "schoolHeadDesignation") } };
    setReview(effect === "draft_count" ? { ...base, effect, ...count } : { ...base, effect: "openings_and_draft_count", ...count });
  }
  async function confirmCommit() {
    if (!review) return;
    setPending(true); setFeedback(null);
    try { await client.inventoryImports.commit(review); setReview(null); await invalidate(); setFeedback("Import committed. Review the recorded result below."); }
    catch (error) { setReviewError(error instanceof Error ? error.message : "Import could not be committed."); }
    finally { setPending(false); }
  }
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header><a href="/property-inventory/imports" className="text-sm underline">Inventory imports</a><h1 className="mt-3 text-2xl font-semibold">{batch.filename}</h1><p className="text-sm">{batch.family.toUpperCase()} · {batch.status} · SHA-256 {batch.sourceHash}</p><p className="text-sm text-muted-foreground">Policy threshold: {batch.classificationThreshold === null ? "Not selected" : `₱${batch.classificationThreshold}`} · {rows.length} source rows</p></header>
    <WorkflowGuidance title="Import progress" steps={[
      { label: "Workbook staged", description: "The original rows and source evidence were inspected.", complete: true },
      { label: "Resolve source rows", description: `${unresolved} unresolved; ${mapped} mapped; ${excluded} excluded.`, complete: batch.status === "committed" || unresolved === 0, target: batch.status === "staged" ? "import-rows" : undefined },
      { label: "Review intended effect", description: "Resolve warnings and choose exactly what will be recorded.", complete: batch.status === "committed", target: batch.status === "staged" ? "import-effect" : undefined },
      { label: "Confirm commit", description: "Save the reviewed effect, then reconcile with your records.", complete: batch.status === "committed" },
    ]} next={batch.status === "committed" ? "The import has been committed. Review the saved result and reconcile the resulting count or ledger with the original workbook." : batch.status !== "staged" ? "This batch is no longer available for commit. Stage the original workbook again if needed." : unresolved ? `Resolve or exclude the ${unresolved} remaining row(s). Creating missing items, lots or office balances is done in Property inventory.` : "Row mappings are saved. Resolve every warning, select the intended effect and review the confirmation before committing."} target={batch.status === "staged" ? unresolved ? "import-rows" : "import-effect" : undefined} />
    <InventoryTerms />
    <p role="status" aria-live="polite" className="text-sm">{feedback}</p><section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Review summary</h2><p className="text-sm">{mapped} mapped · {excluded} excluded · {unresolved} unresolved. Source evidence remains unchanged.</p><Button className="mt-3" variant="outline" disabled={pending} onClick={() => void downloadErrors()}>Download error report</Button><details className="mt-3"><summary className="cursor-pointer text-sm">Source metadata and signature evidence</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(batch.metadataEvidence, null, 2)}</pre></details>{workbookWarnings.length ? <ul className="mt-3 list-disc pl-5 text-sm">{workbookWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}{batch.commitDetails ? <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(batch.commitDetails, null, 2)}</pre> : null}</section>
    {batch.status === "staged" ? <><section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Find existing mapping targets</h2><form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setTargetQuery(get(data, "query")); setTargetPage(1); }}><label className="flex-1">Item code or description<Input name="query" /></label><Button className="self-end" type="submit">Search</Button></form><p className="mt-2 text-sm text-muted-foreground">Row selectors use the items on this target page. Search or change pages to find other lots and balances.</p><div className="mt-2 flex items-center gap-2"><Button variant="outline" size="sm" disabled={targetPage === 1 || targets.isFetching} onClick={() => setTargetPage((value) => value - 1)}>Previous targets</Button><span className="text-sm">Page {targetPage}</span><Button variant="outline" size="sm" disabled={!targets.data?.hasNext || targets.isFetching} onClick={() => setTargetPage((value) => value + 1)}>Next targets</Button></div>{targets.isError ? <ErrorState description="Mapping targets are unavailable." onRetry={() => void targets.refetch()} /> : null}</section>
      <section id="import-rows" className="scroll-mt-24 space-y-3"><h2 className="font-semibold">Source rows</h2>{rows.slice((rowPage - 1) * 25, rowPage * 25).map((row) => <ImportRowEditor key={row.id} row={row} batch={batch} targets={targets.data?.rows ?? []} pending={pending} run={run} />)}<nav aria-label="Source row pages" className="flex items-center gap-3"><Button variant="outline" disabled={rowPage === 1} onClick={() => setRowPage((value) => value - 1)}>Previous rows</Button><span className="text-sm">Page {rowPage}</span><Button variant="outline" disabled={rowPage * 25 >= rows.length} onClick={() => setRowPage((value) => value + 1)}>Next rows</Button></nav></section>
      <section id="import-effect" className="scroll-mt-24 rounded-lg border bg-card p-5"><h2 className="font-semibold">Review intended effect</h2><p className="text-sm text-muted-foreground">Resolve every row and warning. A count remains a draft and does not adjust inventory.</p><CommitForm batch={batch} config={config.data} pending={pending} warnings={workbookWarnings} onReview={prepareCommit} /></section>
    </> : null}
    <AlertDialog open={review !== null} onOpenChange={(open) => { if (!open && !pending) setReview(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Commit reviewed import?</AlertDialogTitle><AlertDialogDescription>Effect: {review?.effect.replaceAll("_", " ")}. {mapped} mapped, {excluded} excluded and {unresolved} unresolved rows. This action is atomic and recorded with the source hash.</AlertDialogDescription></AlertDialogHeader>{reviewError ? <p role="alert" className="text-sm text-destructive">{reviewError}</p> : null}<AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void confirmCommit(); }}>{pending ? "Committing…" : "Confirm commit"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

function ImportRowEditor({ row, batch, targets, pending, run }: { row: ImportRow; batch: ImportDetail["batch"]; targets: Targets; pending: boolean; run: (key: string, action: (id: string) => Promise<unknown>, success: string) => Promise<boolean> }) {
  const [disposition, setDisposition] = useState(batch.family === "stock_card" ? "ledger" : "map");
  const [openingSelected, setOpeningSelected] = useState(false);
  const warnings = warningsOf(row.warnings);
  async function save(data: FormData) {
    const warningResolutions = warnings.map((code, index) => ({ code, reason: get(data, `warning-${index}`) }));
    const targetLot = targets.flatMap((item) => item.lots).find((lot) => lot.id === get(data, "lot"));
    const targetBalance = targets.flatMap((item) => item.balances).find((balance) => balance.id === get(data, "balance"));
    let mapping: Parameters<typeof client.inventoryImports.resolve>[0]["mapping"];
    if (disposition === "exclude") mapping = { disposition: "exclude", reason: get(data, "reason") };
    else if (disposition === "map") {
      const physical = get(data, "physical");
      const opening = data.get("opening") === "on" ? { balanceId: targetBalance?.id ?? "", expectedVersion: targetBalance?.version ?? -1, quantity: Number(get(data, "openingQuantity")), transactionDate: get(data, "openingDate"), reference: get(data, "openingReference"), reason: get(data, "openingReason") } : null;
      mapping = { disposition: "map", lotId: targetLot?.id ?? "", expectedLotVersion: targetLot?.version ?? -1, physicalQuantity: physical === "" ? null : Number(physical), condition: (get(data, "condition") || null) as typeof conditions[number] | null, physicalVerification: get(data, "verification") || null, cardMismatchReason: get(data, "mismatch") || null, opening, warningResolutions };
    } else mapping = { disposition: "ledger", balanceId: targetBalance?.id ?? "", expectedBalanceVersion: targetBalance?.version ?? -1, type: get(data, "type") as "opening" | "receipt" | "issue" | "return", quantity: Number(get(data, "quantity")), transactionDate: get(data, "date"), reference: get(data, "reference"), reason: get(data, "ledgerReason"), counterparty: get(data, "counterparty") || null, balanceAfter: Number(get(data, "balanceAfter")), sourceVerification: get(data, "verification"), daysToConsume: get(data, "days") ? Number(get(data, "days")) : null, warningResolutions };
    const input = { batchId: batch.id, rowId: row.id, expectedBatchVersion: batch.version, expectedRowVersion: row.version, mapping };
    await run(`row:${JSON.stringify(input)}`, (operationId) => client.inventoryImports.resolve({ ...input, operationId }), "Source row resolution saved.");
  }
  return <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer font-medium">{row.sheetName} row {row.sourceRow} · {mappingDisposition(row.mapping)}{warnings.length ? ` · ${warnings.length} warnings` : ""}</summary><details className="mt-3"><summary className="cursor-pointer text-sm">Source evidence and coordinates</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(row.evidence, null, 2)}</pre></details>{row.candidates.length ? <div className="mt-3 text-sm"><p>Existing property-number candidates (up to 20; review before mapping):</p><ul className="list-disc pl-5">{row.candidates.map((candidate) => <li key={candidate.lotId}>{candidate.itemCode} · {candidate.fundCluster} / {candidate.office}</li>)}</ul></div> : null}<form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget)); }}><label>Resolution<select className={selectClass} value={disposition} onChange={(event) => setDisposition(event.target.value)}><option value={batch.family === "stock_card" ? "ledger" : "map"}>{batch.family === "stock_card" ? "Map to ledger" : "Map to existing lot"}</option><option value="exclude">Exclude with reason</option></select></label>
    {disposition === "exclude" ? <label>Reason for exclusion<Input name="reason" required /></label> : <>{disposition === "map" ? <><label>Target lot<select className={selectClass} name="lot" required><option value="">Select lot</option>{targets.flatMap(({ item, lots }) => lots.filter((lot) => lot.active && lot.reportingClass === (batch.family === "rpcsp" ? "semi_expendable" : "ppe")).map((lot) => <option key={lot.id} value={lot.id}>{item.code} · {lot.propertyNumber ?? "Number missing"} · {lot.fundCluster}</option>))}</select></label><label>Physical quantity (blank if unavailable)<Input name="physical" type="number" min={0} step={1} /></label><label>Observed condition<select className={selectClass} name="condition"><option value="">Not recorded</option>{conditions.map((condition) => <option key={condition} value={condition}>{condition.replaceAll("_", " ")}</option>)}</select></label><label>Independent physical verification<Input name="verification" /></label><label>Card mismatch resolution<Input name="mismatch" /></label><label><input type="checkbox" name="opening" checked={openingSelected} onChange={(event) => setOpeningSelected(event.target.checked)} /> Map a verified opening for this lot</label>{openingSelected ? <><label>Opening quantity<Input name="openingQuantity" type="number" min={0} step={1} required /></label><label>Opening date<Input name="openingDate" type="date" required /></label><label>Opening reference<Input name="openingReference" required /></label><label>Opening reason / source<Input name="openingReason" required /></label></> : null}</> : <><label>Transaction type<select className={selectClass} name="type"><option value="opening">Opening</option><option value="receipt">Receipt</option><option value="issue">Issue</option><option value="return">Return</option></select></label><label>Quantity<Input name="quantity" type="number" min={1} step={1} required /></label><label>Transaction date<Input name="date" type="date" required /></label><label>Reference<Input name="reference" required /></label><label>Reason<Input name="ledgerReason" required /></label><label>Source or office<Input name="counterparty" /></label><label>Verified balance after row<Input name="balanceAfter" type="number" min={0} step={1} required /></label><label>Source verification<Input name="verification" required /></label><label>Days to consume<Input name="days" type="number" min={0} step={1} /></label></>}
      <label>Target balance<select className={selectClass} name="balance" required={disposition === "ledger" || openingSelected}><option value="">Select when needed</option>{targets.flatMap(({ item, balances }) => balances.map((balance) => <option key={balance.id} value={balance.id}>{item.code} · {balance.fundCluster} / {balance.office} · {balance.quantity}</option>))}</select></label>{warnings.map((warning, index) => <label key={`${warning}-${index}`}>Resolution: {warning}<Input name={`warning-${index}`} required /></label>)}</>}
    <div className="md:col-span-2"><Button type="submit" disabled={pending}>Save row resolution</Button></div></form></details>;
}

type Configuration = Awaited<ReturnType<typeof client.physicalCounts.configuration>>;
function CommitForm({ batch, config, pending, warnings, onReview }: { batch: ImportDetail["batch"]; config: Configuration | undefined; pending: boolean; warnings: string[]; onReview: (data: FormData) => Promise<void> }) {
  const [effect, setEffect] = useState(batch.family === "stock_card" ? "historical_ledger" : "draft_count");
  const countEffect = effect === "draft_count" || effect === "openings_and_draft_count";
  return <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void onReview(new FormData(event.currentTarget)); }}><label>Effect<select className={selectClass} name="effect" value={effect} onChange={(event) => setEffect(event.target.value)}>{batch.family === "stock_card" ? <option value="historical_ledger">Historical Stock Card ledger</option> : <><option value="draft_count">Draft physical count only</option><option value="verified_openings">Verified openings only</option><option value="openings_and_draft_count">Verified openings and draft count</option></>}</select></label><label className="text-sm"><input name="acknowledged" type="checkbox" /> I acknowledge all excluded source rows.</label>{warnings.map((warning, index) => <label key={`${warning}-${index}`}>Workbook warning: {warning}<Input name={`warning-${index}`} required /></label>)}
    {countEffect ? <><label>Count code<Input name="code" required /></label><label>Form profile<select className={selectClass} name="profile" required><option value="">Select profile</option>{config?.profiles.filter((profile) => profile.family === batch.family).map((profile) => <option key={profile.id} value={profile.id}>{profile.family.toUpperCase()} v{profile.version} · {profile.effectiveFrom}</option>)}</select></label><label>Count as of<Input name="asOfDate" type="date" required /></label><label>Fund cluster<Input name="fund" required /></label><label>Office / location (optional)<Input name="office" /></label>{metadataFields.map(([name, label]) => <label key={name}>{label}<Input name={name} required /></label>)}<label>Accountability assumed date<Input name="assumedDate" type="date" required /></label></> : null}<div className="rounded-md bg-muted p-3 text-sm leading-relaxed md:col-span-2">{effect === "draft_count" ? "Creates observations for manager review. Stock quantities stay unchanged." : effect === "verified_openings" ? "Records verified starting balances. This changes inventory and does not create a physical count." : effect === "openings_and_draft_count" ? "Records verified starting balances and creates a separate draft physical count for review." : "Records historical stock movements. Review the dates and running balances carefully before committing."}</div><div className="md:col-span-2"><Button type="submit" disabled={pending}>Review commit</Button></div></form>;
}
