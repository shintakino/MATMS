"use client";

import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { NavigationRole } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { RequestDocumentPicker } from "@/components/request-document-picker";
import { WorkflowGuidance } from "@/components/workflow-guidance";
import { orpc } from "@/utils/orpc";

function text(form: FormData, name: string) { return String(form.get(name) ?? "").trim(); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The action could not be completed."; }
function displayTime(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ConfirmForm({ children, title, description, button, pending, onConfirm }: { children: React.ReactNode; title: string; description: string; button: string; pending: boolean; onConfirm: (data: FormData) => Promise<void> }) {
  const [data, setData] = useState<FormData | null>(null);
  return <>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setData(new FormData(event.currentTarget)); }}>{children}<Button disabled={pending} type="submit">{pending ? "Saving…" : button}</Button></form>
    <AlertDialog open={data !== null} onOpenChange={(open) => { if (!open) setData(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Go back</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={() => { if (data) void onConfirm(data); setData(null); }}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

export function RequestList() {
  const [page, setPage] = useState(1);
  useEffect(() => { const value = Number(new URLSearchParams(window.location.search).get("page")); if (Number.isInteger(value) && value > 0 && value <= 100000) setPage(value); }, []);
  const requests = useQuery(orpc.custody.requests.list.queryOptions({ input: { page } }));
  const [selectedDocuments, setSelectedDocuments] = useState<Array<{ id: string; code: string; title: string }>>([]);
  const create = useMutation(orpc.custody.requests.create.mutationOptions());
  const cache = useQueryClient();
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage("");
    try {
      const result = await create.mutateAsync({ code: text(data, "code"), requesterName: text(data, "requester"), office: text(data, "office") || null, contact: text(data, "contact") || null, purpose: text(data, "purpose"), kind: text(data, "kind") as "inspect" | "copy" | "borrow", notes: text(data, "notes") || null, documentIds: data.getAll("documents").map(String) });
      await cache.invalidateQueries({ queryKey: orpc.custody.requests.list.queryKey() });
      window.location.assign(`/requests/${result.id}`);
    } catch (error) { setMessage(errorMessage(error)); }
  }

  return <section className="mx-auto w-full max-w-6xl space-y-6 p-6 sm:p-10">
    <section><h1 className="text-2xl font-semibold">Requests</h1><p className="text-sm text-muted-foreground">Create and process requests for permitted records.</p></section>
    <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">New request</h2><p className="mt-2 text-sm text-muted-foreground">Select documents and save a draft, submit it for decisions, then record fulfillment or release. Borrowing an original also requires a recorded return.</p>
      <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="request-code">Request code</Label><Input id="request-code" name="code" required /></div>
        <div className="space-y-2"><Label htmlFor="requester">Requester name</Label><Input id="requester" name="requester" required /></div>
        <div className="space-y-2"><Label htmlFor="office">Office</Label><Input id="office" name="office" /></div>
        <div className="space-y-2"><Label htmlFor="contact">Contact</Label><Input id="contact" name="contact" /></div>
        <div className="space-y-2"><Label htmlFor="purpose">Purpose</Label><Input id="purpose" name="purpose" required /></div>
        <div className="space-y-2"><Label htmlFor="kind">Request type</Label><select className="h-8 w-full border border-input bg-background px-2 text-sm" id="kind" name="kind"><option value="inspect">Inspect</option><option value="copy">Copy</option><option value="borrow">Borrow</option></select></div>
        <RequestDocumentPicker selected={selectedDocuments} onChange={setSelectedDocuments} />
        <div className="space-y-2 md:col-span-2"><Label htmlFor="request-notes">Notes</Label><textarea id="request-notes" name="notes" className="min-h-20 w-full border border-input bg-background p-2 text-sm" /></div>
        <div><Button disabled={create.isPending || selectedDocuments.length === 0} type="submit">{create.isPending ? "Creating…" : "Create draft"}</Button></div>
      </form>{message ? <p role="alert" className="mt-3 text-sm text-destructive">{message}</p> : null}
    </section>
    {requests.isLoading ? <LoadingState label="Loading requests" /> : null}{requests.isError ? <ErrorState description="Requests are unavailable." onRetry={() => void requests.refetch()} /> : null}{requests.data?.items.length === 0 ? <EmptyState title="No requests" description="No requests are available in your scope on this page." /> : null}
    {requests.data?.items.length ? <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Request register</h2><ul className="mt-3 divide-y divide-border">{requests.data.items.map((request) => <li className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={request.id}><a className="text-primary underline-offset-4 hover:underline" href={`/requests/${request.id}`}>{request.code} · {request.requesterName}</a><span className="capitalize">{request.status.replaceAll("_", " ")}</span></li>)}</ul></section> : null}
    <nav aria-label="Request pages" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => { const next = page - 1; setPage(next); window.history.replaceState(null, "", `?page=${next}`); }}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!requests.data?.hasMore} onClick={() => { const next = page + 1; setPage(next); window.history.replaceState(null, "", `?page=${next}`); }}>Next</Button></nav>
  </section>;
}

export function RequestDetail({ id, role }: { id: string; role: NavigationRole }) {
  const detail = useQuery(orpc.custody.requests.get.queryOptions({ input: { id } }));
  const submit = useMutation(orpc.custody.requests.submit.mutationOptions());
  const cancel = useMutation(orpc.custody.requests.cancel.mutationOptions());
  const decide = useMutation(orpc.custody.requests.decide.mutationOptions());
  const fulfill = useMutation(orpc.custody.requests.fulfill.mutationOptions());
  const release = useMutation(orpc.custody.loans.release.mutationOptions());
  const cache = useQueryClient();
  const [message, setMessage] = useState("");
  const [operationIds, setOperationIds] = useState<Record<string, string>>({});
  const pending = submit.isPending || cancel.isPending || decide.isPending || fulfill.isPending || release.isPending;
  async function run(action: () => Promise<unknown>) {
    setMessage("");
    try { await action(); await cache.invalidateQueries(); setMessage("Action recorded."); } catch (error) { setMessage(errorMessage(error)); }
  }
  async function releaseLine(data: FormData, itemId: string) {
    const localDue = text(data, "dueAt");
    const operationId = operationIds[itemId] ?? crypto.randomUUID();
    setOperationIds((current) => ({ ...current, [itemId]: operationId }));
    try {
      await release.mutateAsync({ itemId, recipient: text(data, "recipient"), acknowledged: data.get("acknowledged") === "on", dueAt: new Date(`${localDue}:00+08:00`).toISOString(), operationId });
      await cache.invalidateQueries();
      setOperationIds((current) => { const next = { ...current }; delete next[itemId]; return next; });
      setMessage("Release recorded.");
    } catch (error) { setMessage(errorMessage(error)); }
  }
  if (detail.isLoading) return <section className="p-6"><LoadingState label="Loading request" /></section>;
  if (detail.isError || !detail.data) return <section className="p-6"><ErrorState title="This request is unavailable" description="You may not have access, or it may no longer be available." onRetry={() => void detail.refetch()} /></section>;
  const { request, lines } = detail.data;
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-6 sm:p-10">
    <section><h1 className="text-2xl font-semibold">Request {request.code}</h1><p className="text-sm text-muted-foreground">{request.requesterName} · {request.kind} · {request.status.replaceAll("_", " ")}</p><p className="mt-2 text-sm">Purpose: {request.purpose}</p><div className="mt-3 flex flex-wrap gap-2">{request.status === "draft" ? <Button disabled={pending} onClick={() => void run(() => submit.mutateAsync({ requestId: id }))}>Submit request</Button> : null}{lines.some((line) => line.status === "pending" || line.status === "approved") ? <Button variant="outline" disabled={pending} onClick={() => void run(() => cancel.mutateAsync({ requestId: id }))}>Cancel unfulfilled lines</Button> : null}</div></section>
    <WorkflowGuidance title="Request progress" steps={[
      { label: "Draft saved", description: "The requester and selected documents are recorded.", complete: true },
      { label: "Submit and decide", description: `${lines.filter((line) => line.status === "pending").length} pending decision(s). Restricted records need Administrator approval.`, complete: request.status !== "draft" && lines.every((line) => line.status !== "pending") },
      { label: request.kind === "borrow" ? "Release originals" : "Record fulfillment", description: `${lines.filter((line) => line.status === "approved").length} approved line(s) awaiting action.`, complete: lines.every((line) => line.status !== "pending" && line.status !== "approved") && request.status !== "draft" },
    ]} next={request.status === "draft" ? "Review the selected documents and purpose, then submit this request." : lines.some((line) => line.status === "pending") ? "Record a decision for each pending line. A mixed request can progress one approved line at a time." : lines.some((line) => line.status === "approved") ? request.kind === "borrow" ? "Record the recipient, acknowledgement and due date before releasing each original. Track physical returns in Loans." : "Record fulfillment for each approved line after the inspection or copy is provided." : "All request-line actions are recorded. For borrowed originals, review Loans for outstanding returns or exceptions."} />
    {message ? <p role="status" aria-live="polite" className="text-sm">{message}</p> : null}
    <section className="space-y-4"><h2 className="font-semibold">Request lines</h2>{lines.map((line) => <article className="space-y-3 rounded-lg border border-border bg-card p-5" key={line.id}><div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{line.documentCode} · {line.documentTitle}</p><p className="text-sm capitalize">{line.status}{line.checkout ? line.checkout.exception && !line.checkout.resolvedAt ? " · exception unresolved" : line.checkout.returnedAt ? " · returned" : line.checkout.resolvedAt ? " · resolved" : " · on loan" : ""}</p></div>
      {request.status !== "draft" && line.status === "pending" ? <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void run(() => decide.mutateAsync({ itemId: line.id, decision: text(data, "decision") as "approved" | "rejected" | "cancelled", reason: text(data, "reason") || null })); }} className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-sm">Decision<select className="block h-8 border border-input bg-background px-2" name="decision"><option value="approved">Approve</option><option value="rejected">Reject</option><option value="cancelled">Cancel</option></select></label><label className="space-y-1 text-sm">Reason (required for rejection)<Input name="reason" /></label><Button disabled={pending} type="submit">Record decision</Button></form> : null}
      {line.status === "approved" ? <div className="space-y-3"><div className="flex flex-wrap gap-2"><Button disabled={pending} variant="outline" onClick={() => void run(() => decide.mutateAsync({ itemId: line.id, decision: "cancelled" }))}>Cancel unfulfilled line</Button>{role === "admin" && !line.approvedByAdmin ? <Button disabled={pending} variant="outline" onClick={() => void run(() => decide.mutateAsync({ itemId: line.id, decision: "approved" }))}>Record Administrator approval</Button> : null}</div>{request.kind === "borrow" ? <ConfirmForm title="Release this original?" description="The recipient takes custody of the original until it is returned or an exception is resolved." button="Release original" pending={pending} onConfirm={(data) => releaseLine(data, line.id)}><label className="space-y-1 text-sm">Recipient<Input name="recipient" required /></label><label className="space-y-1 text-sm">Due (Manila time)<Input name="dueAt" type="datetime-local" required /></label><label className="flex items-center gap-2 text-sm"><input name="acknowledged" type="checkbox" required /> Recipient acknowledged</label></ConfirmForm> : <Button disabled={pending} onClick={() => void run(() => fulfill.mutateAsync({ itemId: line.id }))}>Record fulfillment</Button>}</div> : null}
      {line.decisionReason ? <p className="text-sm text-muted-foreground">Decision reason: {line.decisionReason}</p> : null}
      {line.checkout ? <p className="text-sm text-muted-foreground">Released {displayTime(line.checkout.releasedAt)} · Due {displayTime(line.checkout.dueAt)}{line.checkout.returnedAt ? ` · Returned ${displayTime(line.checkout.returnedAt)} (${line.checkout.returnCondition})` : ""}. Manage returns and exceptions under Loans.</p> : null}
      {role !== "admin" ? <p className="text-xs text-muted-foreground">Restricted records require Administrator approval.</p> : null}
    </article>)}</section>
  </section>;
}

export function LoanList({ role }: { role: NavigationRole }) {
  const [filter, setFilter] = useState<"all" | "active" | "overdue" | "returned" | "exception">("active");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedFilter = params.get("filter");
    if (requestedFilter === "all" || requestedFilter === "active" || requestedFilter === "overdue" || requestedFilter === "returned" || requestedFilter === "exception") setFilter(requestedFilter);
    const requestedPage = Number(params.get("page"));
    if (Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000) setPage(requestedPage);
  }, []);
  const loans = useQuery(orpc.custody.loans.list.queryOptions({ input: { filter, page } }));
  const folders = useQuery(orpc.archive.folders.list.queryOptions());
  const returnLoan = useMutation(orpc.custody.loans.return.mutationOptions());
  const exception = useMutation(orpc.custody.loans.recordException.mutationOptions());
  const resolve = useMutation(orpc.custody.loans.resolveException.mutationOptions());
  const cache = useQueryClient();
  const [message, setMessage] = useState("");
  const [operationIds, setOperationIds] = useState<Record<string, string>>({});
  const pending = returnLoan.isPending || exception.isPending || resolve.isPending;
  async function act(data: FormData, checkoutId: string, kind: "return" | "exception" | "resolve") {
    setMessage("");
    const operationId = operationIds[checkoutId] ?? crypto.randomUUID();
    if (kind === "return") setOperationIds((current) => ({ ...current, [checkoutId]: operationId }));
    try {
      if (kind === "return") await returnLoan.mutateAsync({ checkoutId, condition: text(data, "condition"), folderId: text(data, "folderId") || null, relocationReason: text(data, "relocationReason") || null, operationId });
      else if (kind === "exception") await exception.mutateAsync({ checkoutId, exception: text(data, "exception") as "lost" | "damaged", notes: text(data, "notes") });
      else await resolve.mutateAsync({ checkoutId, disposition: text(data, "disposition"), notes: text(data, "notes") });
      await cache.invalidateQueries(); setMessage("Action recorded.");
      if (kind === "return") setOperationIds((current) => { const next = { ...current }; delete next[checkoutId]; return next; });
    } catch (error) { setMessage(errorMessage(error)); }
  }
  const visible = loans.data?.items ?? [];
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-6 sm:p-10">
    <section><h1 className="text-2xl font-semibold">Loans</h1><p className="text-sm text-muted-foreground">Custody and returns for permitted records.</p><p className="mt-3 text-sm">Use Record return when the original is physically received. Record an exception for loss or damage; an Administrator records its disposition. Resolving an exception does not itself mean the original was returned.</p></section>
    <label className="text-sm">Show <select className="h-8 border border-input bg-background px-2" value={filter} onChange={(event) => {
      const next = event.target.value as typeof filter;
      setFilter(next); setPage(1); window.history.replaceState(null, "", `?filter=${next}&page=1`);
    }}><option value="active">Active</option><option value="overdue">Overdue</option><option value="returned">Returned</option><option value="exception">Exceptions</option><option value="all">All</option></select></label>
    {message ? <p role="status" aria-live="polite" className="text-sm">{message}</p> : null}
    {loans.isLoading ? <LoadingState label="Loading loans" /> : null}{loans.isError ? <ErrorState description="Loans are unavailable." onRetry={() => void loans.refetch()} /> : null}
    {!loans.isLoading && !loans.isError && !visible.length ? <EmptyState title="No loans" description="No permitted loans match this filter on this page." /> : null}
    <section className="space-y-4">{visible.map((loan) => <article className="space-y-3 rounded-lg border border-border bg-card p-5" key={loan.id}>
      <h2 className="font-semibold">{loan.documentCode} · {loan.documentTitle}</h2>
      <p className="text-sm text-muted-foreground">Recipient: {loan.recipient} · Released by {loan.releasedByName} on {displayTime(loan.releasedAt)} · Due {displayTime(loan.dueAt)}{loan.overdue ? " · Overdue" : ""}{loan.returnedAt ? ` · Received by ${loan.returnedByName ?? "Unavailable"} on ${displayTime(loan.returnedAt)}` : ""}{loan.exception ? ` · ${loan.exception}${loan.resolvedAt ? " (resolved)" : " (unresolved)"}` : ""}</p>
      {loan.returnCondition ? <p className="text-sm">Return condition: {loan.returnCondition}</p> : null}
      {loan.exceptionNotes ? <p className="text-sm">Exception notes: {loan.exceptionNotes}</p> : null}
      {loan.resolution ? <p className="text-sm">Disposition: {loan.resolution} · {loan.resolutionNotes}</p> : null}
      {!loan.returnedAt && (!loan.resolvedAt || loan.exception) ? <>
        <ConfirmForm title="Record this return?" description="Any alternative location will be recorded in movement history. A damaged return remains unresolved until an Administrator resolves it." button="Record return" pending={pending} onConfirm={(data) => act(data, loan.id, "return")}><label className="space-y-1 text-sm">Return condition<select className="block h-8 border border-input bg-background px-2" name="condition"><option value="Good">Good</option><option value="Fair">Fair</option><option value="Damaged">Damaged — requires resolution</option></select></label><label className="space-y-1 text-sm">Return location<select className="block h-8 border border-input bg-background px-2" name="folderId"><option value="">Recorded home folder</option>{folders.data?.map((folder) => <option key={folder.id} value={folder.id}>{folder.boxCode} · {folder.code} · {folder.name}</option>)}</select></label><label className="space-y-1 text-sm">Reason for alternative location<Input name="relocationReason" /></label></ConfirmForm>
        {!loan.exception ? <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Report lost or damaged original</summary><form onSubmit={(event) => { event.preventDefault(); void act(new FormData(event.currentTarget), loan.id, "exception"); }} className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-sm">Exception<select className="block h-8 border border-input bg-background px-2" name="exception"><option value="lost">Lost</option><option value="damaged">Damaged</option></select></label><label className="space-y-1 text-sm">Notes<Input name="notes" required /></label><Button disabled={pending} type="submit" variant="outline">Record exception</Button></form></details> : null}
      </> : null}
      {loan.exception && !loan.resolvedAt && role === "admin" ? <form onSubmit={(event) => { event.preventDefault(); void act(new FormData(event.currentTarget), loan.id, "resolve"); }} className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-sm">Disposition<Input name="disposition" required /></label><label className="space-y-1 text-sm">Supporting notes<Input name="notes" required /></label><Button disabled={pending} type="submit">Resolve exception</Button></form> : null}
    </article>)}</section>
    <nav aria-label="Loan pages" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => { const next = page - 1; setPage(next); window.history.replaceState(null, "", `?filter=${filter}&page=${next}`); }}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!loans.data?.hasMore} onClick={() => { const next = page + 1; setPage(next); window.history.replaceState(null, "", `?filter=${filter}&page=${next}`); }}>Next</Button></nav>
  </section>;
}
