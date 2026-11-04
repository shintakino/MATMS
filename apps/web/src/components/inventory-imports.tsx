"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import type { NavigationRole } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { client } from "@/utils/orpc";

const selectClass = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const get = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

export function InventoryImports({ role }: { role: NavigationRole }) {
  const manager = role === "admin" || role === "property_custodian";
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [policyId, setPolicyId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [duplicateIds, setDuplicateIds] = useState<string[]>([]);
  const [policyFeedback, setPolicyFeedback] = useState<string | null>(null);
  const uploadId = useRef(crypto.randomUUID());
  const policyIdempotency = useRef(crypto.randomUUID());
  const batches = useQuery({ queryKey: ["custodial-imports", page], queryFn: () => client.inventoryImports.list({ page, pageSize: 25 }), enabled: manager });
  const config = useQuery({ queryKey: ["custodial-configuration"], queryFn: () => client.physicalCounts.configuration(), enabled: manager });
  const createPolicy = useMutation({ mutationFn: (input: Parameters<typeof client.inventoryImports.createPolicy>[0]) => client.inventoryImports.createPolicy(input) });
  async function savePolicy(data: FormData) {
    setPolicyFeedback(null);
    try { await createPolicy.mutateAsync({ effectiveFrom: get(data, "effective"), threshold: get(data, "threshold"), note: get(data, "note"), operationId: policyIdempotency.current }); policyIdempotency.current = crypto.randomUUID(); await queryClient.invalidateQueries({ queryKey: ["custodial-configuration"] }); setPolicyFeedback("Classification policy recorded."); }
    catch (error) { setPolicyFeedback(error instanceof Error ? error.message : "Policy could not be saved."); }
  }
  async function upload() {
    if (!file) { setFeedback("Choose a workbook."); return; }
    if (!file.size || file.size > 8 * 1024 * 1024) { setFeedback("Workbook must be no larger than 8 MB."); return; }
    setUploading(true); setFeedback(null); setDuplicateIds([]);
    try {
      const headers: Record<string, string> = { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name), "x-operation-id": uploadId.current };
      if (policyId) headers["x-classification-policy-id"] = policyId;
      const response = await fetch("/api/custodial-imports", { method: "POST", credentials: "same-origin", headers, body: file });
      const data = await response.json() as { id?: string; duplicateBatchIds?: string[]; message?: string };
      if (!response.ok || !data.id) throw new Error(data.message ?? "Workbook could not be staged.");
      uploadId.current = crypto.randomUUID(); await queryClient.invalidateQueries({ queryKey: ["custodial-imports"] });
      setDuplicateIds(data.duplicateBatchIds ?? []);
      setFeedback(`Workbook staged for review.${data.duplicateBatchIds?.length ? ` ${data.duplicateBatchIds.length} earlier batch(es) have the same source hash.` : ""}`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Workbook could not be staged."); }
    finally { setUploading(false); }
  }
  if (!manager) return <section className="p-6"><h1 className="text-2xl font-semibold">Inventory imports</h1><p>This workspace is unavailable for your account.</p></section>;
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header><a href="/property-inventory" className="text-sm underline">Property inventory</a><h1 className="mt-3 text-2xl font-semibold">Controlled inventory import</h1><p className="text-sm text-muted-foreground">Follow four steps: upload a supported workbook, resolve its source rows, review what will be recorded, then confirm the commit. Uploading alone does not change stock.</p></header>
    {role === "admin" ? <details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Record classification policy</summary><p className="mt-2 text-sm text-muted-foreground">Use the threshold confirmed by the school and accounting representative. Prior policy versions stay unchanged.</p><form className="mt-4 grid gap-3 md:grid-cols-3" onChange={() => { policyIdempotency.current = crypto.randomUUID(); }} onSubmit={(event) => { event.preventDefault(); void savePolicy(new FormData(event.currentTarget)); }}><label>Effective date<Input name="effective" type="date" required /></label><label>Threshold in PHP<Input name="threshold" type="number" min={0} step="0.01" required /></label><label>Approval / policy note<Input name="note" required /></label><div><Button type="submit" disabled={createPolicy.isPending}>Record policy</Button></div></form><p role="status" aria-live="polite" className="mt-3 text-sm">{policyFeedback}</p></details> : null}
    <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Stage workbook</h2><p className="text-sm text-muted-foreground">Supported: Appendix 58 Stock Card, Annex A.8 RPCSP and Appendix 73 RPCPPE. RPCSP requires a reviewed classification policy.</p><form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void upload(); }}><label>Workbook<Input type="file" accept=".xls,.xlsx" required onChange={(event) => { setFile(event.target.files?.[0] ?? null); uploadId.current = crypto.randomUUID(); }} /></label><label>Classification policy<select className={selectClass} value={policyId} onChange={(event) => { setPolicyId(event.target.value); uploadId.current = crypto.randomUUID(); }}><option value="">No policy selected</option>{config.data?.policies.map((policy) => <option key={policy.id} value={policy.id}>v{policy.version} · {policy.effectiveFrom} · ₱{policy.threshold}</option>)}</select></label><div className="md:col-span-2"><Button disabled={uploading} type="submit">{uploading ? "Inspecting…" : "Stage for review"}</Button></div></form><p role="status" aria-live="polite" className="mt-3 text-sm">{feedback}</p>{duplicateIds.length ? <ul className="mt-2 space-y-1 text-sm">{duplicateIds.map((batchId) => <li key={batchId}><a className="underline" href={`/property-inventory/imports/${batchId}`}>Open earlier batch {batchId}</a></li>)}</ul> : null}</section>
    {batches.isLoading ? <LoadingState label="Loading imports" /> : null}{batches.isError ? <ErrorState description="Imports are unavailable." onRetry={() => void batches.refetch()} /> : null}{batches.data?.rows.length === 0 ? <EmptyState title="No imports" description="Stage a supported workbook to review it." /> : null}
    <ul className="space-y-3">{batches.data?.rows.map((batch) => <li key={batch.id} className="rounded-lg border bg-card p-4"><a className="font-semibold underline" href={`/property-inventory/imports/${batch.id}`}>{batch.filename}</a><p className="text-sm">{batch.family.toUpperCase()} · {batch.status} · SHA-256 {batch.sourceHash}</p></li>)}</ul><nav aria-label="Import pages" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || batches.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!batches.data?.hasNext || batches.isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button></nav>
  </section>;
}
