"use client";

import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { NavigationRole } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { orpc } from "@/utils/orpc";
import { ScopedRegister } from "@/components/scoped-register";
import { StockLineControls } from "@/components/stock-line-controls";

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The stock operation could not be completed."; }

export function TemplateRegister({ role }: { role: NavigationRole }) {
  const queryClient = useQueryClient();
  const templates = useQuery(orpc.inventory.templates.list.queryOptions());
  const categories = useQuery(orpc.archive.categories.list.queryOptions());
  const createTemplate = useMutation(orpc.inventory.templates.create.mutationOptions());
  const [message, setMessage] = useState<string | null>(null);
  async function create(formData: FormData) {
    try {
      await createTemplate.mutateAsync({ code: String(formData.get("code") ?? ""), familyCode: String(formData.get("familyCode") ?? ""), name: String(formData.get("name") ?? ""), description: String(formData.get("description") ?? "") || null, categoryId: String(formData.get("categoryId") ?? ""), revisionLabel: String(formData.get("revisionLabel") ?? ""), revisionDate: String(formData.get("revisionDate") ?? "") || null, digitalUrl: String(formData.get("digitalUrl") ?? ""), supersedesId: String(formData.get("supersedesId") ?? "") || null });
      await queryClient.invalidateQueries(); setMessage("Template revision created.");
    } catch (error) { setMessage(errorMessage(error)); }
  }
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><section><h1 className="text-2xl font-semibold">Template revisions</h1><p className="text-sm text-muted-foreground">Each row is a revision; printed stock always remains tied to its original revision.</p></section>{role === "admin" ? <section className="rounded-lg border border-border bg-card p-5 shadow-sm"><h2 className="font-semibold">Create revision</h2><form onSubmit={(event) => { event.preventDefault(); void create(new FormData(event.currentTarget)); }} className="mt-4 grid gap-3 md:grid-cols-2"><div className="space-y-1"><Label htmlFor="template-code">Revision code</Label><Input id="template-code" name="code" required /></div><div className="space-y-1"><Label htmlFor="family-code">Family code</Label><Input id="family-code" name="familyCode" required /></div><div className="space-y-1"><Label htmlFor="template-name">Name</Label><Input id="template-name" name="name" required /></div><div className="space-y-1"><Label htmlFor="template-category">Category</Label><select className="h-8 w-full border border-input bg-transparent px-2 text-xs" id="template-category" name="categoryId" required><option value="">Select category</option>{categories.data?.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="space-y-1"><Label htmlFor="revision-label">Revision label</Label><Input id="revision-label" name="revisionLabel" required /></div><div className="space-y-1"><Label htmlFor="revision-date">Revision date</Label><Input id="revision-date" name="revisionDate" type="date" /></div><div className="space-y-1 md:col-span-2"><Label htmlFor="digital-url">Approved HTTPS master link</Label><Input id="digital-url" name="digitalUrl" required type="url" /></div><div className="space-y-1 md:col-span-2"><Label htmlFor="template-description">Description</Label><textarea className="min-h-16 w-full border border-input bg-transparent p-2 text-sm" id="template-description" name="description" /></div><label className="text-sm md:col-span-2">Supersedes revision (optional)<select className="block h-9 w-full border bg-background" name="supersedesId"><option value="">No earlier revision</option>{templates.data?.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.familyCode} / {item.code}</option>)}</select><span className="text-xs">Select an active revision in the same family. Its status will become superseded; existing stock stays with that revision.</span></label><div className="md:col-span-2"><Button disabled={createTemplate.isPending} type="submit">{createTemplate.isPending ? "Creating…" : "Create revision"}</Button></div></form>{message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground" role="status">{message}</p> : null}</section> : null}{templates.isLoading ? <LoadingState label="Loading template revisions" /> : null}{templates.isError ? <ErrorState description="Template revisions are unavailable." onRetry={() => void templates.refetch()} /> : null}{templates.data?.length === 0 ? <EmptyState title="No template revisions" description="No template revisions are available yet." /> : null}<ScopedRegister kind="template" /></section>;
}

export function InventoryRegister({ role }: { role: NavigationRole }) {
  const queryClient = useQueryClient();
  const inventory = useQuery(orpc.inventory.inventory.list.queryOptions());
  const receive = useMutation(orpc.inventory.inventory.receive.mutationOptions());
  const issue = useMutation(orpc.inventory.inventory.issue.mutationOptions());
  const transfer = useMutation(orpc.inventory.inventory.transfer.mutationOptions());
  const correct = useMutation(orpc.inventory.inventory.correct.mutationOptions());
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [action, setAction] = useState("receive");
  const [selectedLine, setSelectedLine] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<FormData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = receive.isPending || issue.isPending || transfer.isPending || correct.isPending;
  async function submit(formData: FormData) {
    const action = String(formData.get("action") ?? "receive"); const inventoryId = String(formData.get("inventoryId") ?? ""); const quantity = Number(formData.get("quantity")); const reason = String(formData.get("reason") ?? "");
    setMessage(null);
    try {
      if (action === "receive") await receive.mutateAsync({ inventoryId, quantity, reason, reference: String(formData.get("reference") ?? "") || null, operationId });
      if (action === "issue") await issue.mutateAsync({ inventoryId, quantity, reason, reference: String(formData.get("reference") ?? "") || null, supersededDecision: String(formData.get("supersededDecision") ?? "") || null, operationId });
      if (action === "transfer") await transfer.mutateAsync({ sourceInventoryId: inventoryId, destinationInventoryId: String(formData.get("destinationInventoryId") ?? ""), quantity, reason, operationId });
      if (action === "correct") { if (role !== "admin") throw new Error("Only an Administrator can correct a balance."); await correct.mutateAsync({ inventoryId, count: quantity, expectedVersion: Number(formData.get("expectedVersion")), reason, operationId }); }
      await queryClient.invalidateQueries(); setMessage("Stock operation confirmed."); setOperationId(crypto.randomUUID()); setCorrection(null);
    } catch (error) { await queryClient.invalidateQueries(); setReviewError(errorMessage(error)); }
  }
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10">
    <section><h1 className="text-2xl font-semibold">Physical template inventory</h1><p className="text-sm text-muted-foreground">Balances are per revision and folder. Changes appear after confirmation.</p></section>
    {role !== "viewer" ? <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Stock operation</h2>
      <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const selected = inventory.data?.find((line) => line.id === String(data.get("inventoryId"))); data.set("expectedVersion", String(selected?.version ?? -1)); data.set("sourceLabel", selected ? `${selected.templateCode} / ${selected.folderCode}` : "Unavailable"); data.set("sourceCount", String(selected?.count ?? 0)); const destination = inventory.data?.find((line) => line.id === String(data.get("destinationInventoryId"))); data.set("destinationLabel", destination ? `${destination.templateCode} / ${destination.folderCode}` : "Unavailable"); data.set("destinationCount", String(destination?.count ?? 0)); setReviewError(null); setCorrection(data); }} onChange={() => { setOperationId(crypto.randomUUID()); setCorrection(null); setReviewError(null); }} className="mt-4 grid gap-3 md:grid-cols-2">
        <label>Action<select className="block h-9 w-full border bg-background" name="action" value={action} onChange={(event) => setAction(event.target.value)}><option value="receive">Receive</option><option value="issue">Issue</option><option value="transfer">Transfer</option>{role === "admin" ? <option value="correct">Correct balance</option> : null}</select></label>
        <label>Inventory line<select className="block h-9 w-full border bg-background" name="inventoryId" value={selectedLine} onChange={(event) => setSelectedLine(event.target.value)} required><option value="">Select inventory</option>{inventory.data?.map((line) => <option key={line.id} value={line.id}>{line.templateCode} / {line.folderCode} — {line.count} copies ({line.templateStatus})</option>)}</select></label>
        {action === "transfer" ? <label>Transfer destination<select className="block h-9 w-full border bg-background" name="destinationInventoryId" required><option value="">Select when transferring</option>{inventory.data?.filter((line) => line.id !== selectedLine && line.templateId === inventory.data?.find((source) => source.id === selectedLine)?.templateId).map((line) => <option key={line.id} value={line.id}>{line.templateCode} / {line.folderCode}</option>)}</select></label> : null}
        <label>Quantity / corrected count<Input name="quantity" type="number" min={action === "correct" ? 0 : 1} step={1} required /></label>
        <label>Reason or purpose<Input name="reason" minLength={3} maxLength={1000} required /></label>
        <label>Requester/reference<Input name="reference" maxLength={240} /></label>
        {role === "admin" && action === "issue" && inventory.data?.find((line) => line.id === selectedLine)?.templateStatus === "superseded" ? <label>Admin decision for superseded stock<Input name="supersededDecision" required maxLength={1000} /></label> : null}
        <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Review stock operation"}</Button></div>
      </form><p role="status" aria-live="polite">{message}</p>
    </section> : null}
    {inventory.isLoading ? <LoadingState label="Loading inventory" /> : null}
    {inventory.isError ? <ErrorState description="Inventory is unavailable." onRetry={() => void inventory.refetch()} /> : null}
    {inventory.data?.length === 0 ? <EmptyState title="No inventory lines" description="Create a stock line in a template folder to get started." /> : null}
    <ScopedRegister kind="inventory" />
    <AlertDialog open={correction !== null} onOpenChange={(open) => { if (!open && !pending) setCorrection(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{correction?.get("action") === "correct" ? "Correct the stock balance?" : "Confirm stock operation?"}</AlertDialogTitle><AlertDialogDescription>{correction?.get("action") === "correct" ? `Replace the recorded balance with ${String(correction.get("quantity"))} copies.` : `${String(correction?.get("action") ?? "")} ${String(correction?.get("quantity") ?? "")} copies.`} Verify the selected revision, folder, quantity and reason. Stock changes only after confirmation.</AlertDialogDescription><div className="space-y-2 text-sm"><p>Source: {String(correction?.get("sourceLabel") ?? "")} · {String(correction?.get("sourceCount") ?? "")} → {correction?.get("action") === "correct" ? Number(correction.get("quantity")) : Number(correction?.get("sourceCount")) + (correction?.get("action") === "receive" ? 1 : -1) * Number(correction?.get("quantity"))} copies</p>{correction?.get("action") === "transfer" ? <p>Destination: {String(correction.get("destinationLabel"))} · {String(correction.get("destinationCount"))} → {Number(correction.get("destinationCount")) + Number(correction.get("quantity"))} copies</p> : null}<p>Reason: {String(correction?.get("reason") ?? "")}</p></div>{reviewError ? <p role="alert" className="text-sm text-destructive">{reviewError} Retry the same confirmation if its outcome is uncertain; cancel and review again to change it.</p> : null}</AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); if (correction) void submit(correction); }}>{correction?.get("action") === "correct" ? "Confirm correction" : "Confirm operation"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {role !== "viewer" ? <section className="space-y-3"><h2 className="font-semibold">Quick actions and thresholds</h2>{inventory.data?.map((line) => <details className="rounded-lg border p-4" key={line.id}><summary>{line.templateCode} / {line.folderCode} — {line.count} copies</summary><StockLineControls id={line.id} threshold={line.threshold} role={role} superseded={line.templateStatus === "superseded"} /></details>)}</section> : null}
  </section>;
}

export function TemplateDetail({ id }: { id: string }) {
  const detail = useQuery(orpc.inventory.templates.get.queryOptions({ input: { id } }));
  if (detail.isLoading) return <section className="p-6 sm:p-10"><p className="text-sm text-muted-foreground">Loading template revision…</p></section>;
  if (detail.isError || !detail.data) return <section className="p-6 sm:p-10"><p className="text-sm text-muted-foreground">This template is unavailable.</p></section>;
  const { template, inventory } = detail.data;
  return <section className="mx-auto w-full max-w-5xl space-y-5 p-6 sm:p-10"><section><p className="font-mono text-sm text-muted-foreground">{template.code} · {template.revisionLabel}</p><h1 className="text-2xl font-semibold">{template.name}</h1><p className="mt-2 text-sm text-muted-foreground">{template.description ?? "No description recorded."}</p><a className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline" href={template.digitalUrl} rel="noreferrer" target="_blank">Open approved master <span className="sr-only">in a new tab</span></a></section><section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Permitted stock by folder</h2>{inventory.length ? <ul className="mt-3 divide-y divide-border">{inventory.map((line) => { const status = line.count === 0 ? "Out of stock" : line.count <= line.threshold ? "Low stock" : "In stock"; return <li className="flex items-center justify-between gap-4 py-3 text-sm" key={line.id}><span>{line.folderName} <span className="font-mono text-xs text-muted-foreground">{line.boxCode}</span></span><span className="tabular-nums">{line.count} · {status}</span></li>; })}</ul> : <p className="mt-2 text-sm text-muted-foreground">No permitted inventory lines are available.</p>}</section></section>;
}
