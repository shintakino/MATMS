"use client";

import { Button } from "@matms/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@matms/ui/components/card";
import { Input } from "@matms/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowUpRightIcon, SearchIcon } from "lucide-react";

import type { ReportFilters, ReportKind, ReportRow } from "@matms/api/reporting-service";
import type { NavigationRole } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { client, orpc } from "@/utils/orpc";

const reportLabels: Record<ReportKind, string> = {
  box_folders: "Box and folder register", documents: "Document register", balances: "Template balances",
  ledger: "Stock ledger", loans: "Loan history", requests: "Request history", movements: "Relocation history",
};
const reportKinds = Object.keys(reportLabels) as ReportKind[];

function detailHref(row: ReportRow) {
  if (row.kind === "box") return `/boxes/${row.id}`;
  if (row.kind === "folder") return `/folders/${row.id}`;
  if (row.kind === "document") return `/documents/${row.id}`;
  if (row.kind === "template") return `/templates/${row.id}`;
  if (row.kind === "inventory" && typeof row.details.templateId === "string") return `/templates/${row.details.templateId}`;
  return undefined;
}

function statusLabel(value: string) {
  if (value === "out") return "Out of stock";
  if (value === "low") return "Low stock";
  if (value === "in") return "In stock";
  return value.replaceAll("_", " ");
}

function displayDate(value: string | Date | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function DashboardOverview({ role }: { role: NavigationRole }) {
  const summary = useQuery(orpc.reporting.dashboard.queryOptions());
  if (summary.isLoading) return <section className="p-6 sm:p-10"><LoadingState label="Loading dashboard" /></section>;
  if (summary.isError || !summary.data) return <section className="p-6 sm:p-10"><ErrorState description="The dashboard is unavailable." onRetry={() => void summary.refetch()} /></section>;
  const { counts, operations, recent } = summary.data;
  const metrics = [
    { label: "Active boxes", value: counts.boxes, href: "/search?kind=box&lifecycle=active" },
    { label: "Active folders", value: counts.folders, href: "/search?kind=folder&lifecycle=active&recordLifecycle=active" },
    { label: "Active documents", value: counts.documents, href: "/search?kind=document&lifecycle=active&recordLifecycle=active&folderLifecycle=active" },
    { label: "Low-stock lines", value: counts.low, href: "/search?kind=inventory&stockStatus=low&lifecycle=active&recordLifecycle=active" },
    { label: "Out-of-stock lines", value: counts.out, href: "/search?kind=inventory&stockStatus=out&lifecycle=active&recordLifecycle=active" },
    ...(operations ? [
      { label: "Pending requests", value: operations.requests, href: "/reports?report=requests&requestStatus=submitted" },
      { label: "Active loans", value: operations.loans, href: "/loans?filter=active" },
      { label: "Overdue loans", value: operations.overdue, href: "/loans?filter=overdue" },
    ] : []),
  ];
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header className="dashboard-hero"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Your daily overview</p><h1 className="text-2xl font-semibold">Dashboard</h1><p className="text-sm text-muted-foreground">Keep records organized. Keep your school moving.</p></div><Button nativeButton={false} render={<a href="/search" />}><SearchIcon aria-hidden="true" />Find a record<ArrowUpRightIcon aria-hidden="true" /></Button></header><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{metrics.map((metric) => <Card className="metric-card" key={metric.label}><CardHeader><CardTitle>{metric.label}</CardTitle></CardHeader><CardContent><a className="text-2xl font-semibold tabular-nums text-primary underline-offset-4 hover:underline" href={metric.href}>{metric.value}<span className="sr-only"> {metric.label}</span></a></CardContent></Card>)}</div>{role === "admin" || role === "property_custodian" ? <CustodialDashboard /> : null}{role !== "viewer" ? <section className="space-y-3"><h2 className="text-lg font-semibold">Recent permitted activity</h2>{recent.length ? <ul className="divide-y divide-border rounded-lg border border-border bg-card px-5">{recent.map((event) => <li className="py-3 text-sm" key={`${event.kind}-${event.id}`}>{event.kind} · {event.code} · {event.title} · {event.location}</li>)}</ul> : <EmptyState title="No recent activity" description="No permitted operational activity is available." />}</section> : null}</section>;
}

function CustodialDashboard() {
  const overview = useQuery({ queryKey: ["custodial-dashboard"], queryFn: () => client.custodialInventory.dashboard() });
  if (overview.isLoading) return <LoadingState label="Loading property inventory summary" />;
  if (overview.isError || !overview.data) return <ErrorState description="Property inventory summary is unavailable." onRetry={() => void overview.refetch()} />;
  const values = overview.data;
  const metrics = [
    { label: "At reorder point", value: values.low, href: "/property-inventory?reorder=yes&active=yes" },
    { label: "Out-of-stock offices", value: values.out, href: "/property-inventory?out=yes&active=yes" },
    { label: "Unresolved count lines", value: values.unresolved, href: "/property-inventory/counts" },
    { label: "Condition review lots", value: values.unserviceable, href: "/property-inventory?conditionReview=yes&active=yes" },
    { label: "Draft counts", value: values.drafts, href: "/property-inventory/counts" },
    { label: "Counts for review", value: values.awaiting, href: "/property-inventory/counts" },
  ];
  return <section className="space-y-3"><h2 className="text-lg font-semibold">Property inventory</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map((metric) => <Card className="metric-card" key={metric.label}><CardHeader><CardTitle>{metric.label}</CardTitle></CardHeader><CardContent><a className="text-2xl font-semibold tabular-nums text-primary underline-offset-4 hover:underline" href={metric.href}>{metric.value}<span className="sr-only"> {metric.label}</span></a></CardContent></Card>)}</div><h3 className="font-semibold">Recent receipts and issues</h3>{values.recent.length ? <ul className="divide-y rounded-lg border bg-card px-5">{values.recent.map((entry) => <li className="py-3 text-sm" key={entry.id}><a className="underline" href={`/property-inventory/items/${entry.itemId}`}>{entry.itemCode} · {entry.article}</a> · {entry.type} {entry.delta} · {entry.office} · {entry.date} · {entry.reference}</li>)}</ul> : <p className="text-sm text-muted-foreground">No recent receipts or issues.</p>}</section>;
}

type State = ReportFilters & { report: ReportKind; page: number };
const defaults: State = { report: "documents", page: 1 };
const filterKeys = ["query", "kind", "categoryId", "shelfId", "lifecycle", "recordLifecycle", "folderLifecycle", "confidentiality", "stockStatus", "revisionStatus", "requestStatus", "loanStatus", "from", "to"] as const;

export function ReportingWorkspace({ mode, role }: { mode: "search" | "reports"; role: NavigationRole }) {
  const [state, setState] = useState<State>(defaults);
  const [queryText, setQueryText] = useState("");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const categories = useQuery(orpc.archive.categories.list.queryOptions());
  const locations = useQuery(orpc.archive.locations.list.queryOptions());
  const availableReports = role === "viewer" ? reportKinds.filter((kind) => ["box_folders", "documents", "balances"].includes(kind)) : reportKinds;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedReport = params.get("report") as ReportKind;
    const permittedReport = reportKinds.includes(requestedReport) && (role !== "viewer" || ["box_folders", "documents", "balances"].includes(requestedReport));
    const parsed: Record<string, string | number> = { report: permittedReport ? requestedReport : "documents", page: Math.max(1, Math.min(10000, Number(params.get("page")) || 1)) };
    for (const key of filterKeys) { const value = params.get(key); if (value) parsed[key] = value; }
    setState(parsed as State);
    setQueryText(String(parsed.query ?? ""));
    setReady(true);
  }, [role]);
  function update(next: State) {
    setState(next);
    const params = new URLSearchParams();
    if (mode === "reports") params.set("report", next.report);
    for (const key of filterKeys) { const value = next[key]; if (value) params.set(key, value); }
    if (next.page > 1) params.set("page", String(next.page));
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { if (queryText !== (state.query ?? "")) update({ ...state, query: queryText || undefined, page: 1 }); }, 300);
    return () => window.clearTimeout(timer);
  }, [queryText, state]);
  const { report, page, ...filters } = state;
  const result = useQuery({ enabled: ready, queryKey: ["reporting", mode, report, filters, page], queryFn: () => mode === "search" ? client.reporting.search({ filters, page, pageSize: 25 }) : client.reporting.report({ kind: report, filters, page, pageSize: 25 }) });
  const download = useMutation({ mutationFn: () => client.reporting.exportCsv({ kind: report, filters }) });
  async function exportCsv() {
    setMessage("");
    try {
      const artifact = await download.mutateAsync();
      const url = URL.createObjectURL(new Blob(["\uFEFF", artifact.csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `matms-${report}-${artifact.generatedAt.slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
      setMessage(`Exported ${artifact.rowCount} authorized rows.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export could not be completed."); }
  }
  function select(key: keyof ReportFilters, value: string) { update({ ...state, [key]: value || undefined, page: 1 }); }
  const selectClass = "h-8 w-full border border-input bg-background px-2 text-sm";
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><section className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">{mode === "search" ? "Search the archive" : "Reports"}</h1><p className="text-sm text-muted-foreground">Results include only records available to your account.</p></div>{mode === "reports" && role !== "viewer" ? <Button disabled={download.isPending || result.isFetching || result.isError || !result.data || queryText !== (state.query ?? "")} onClick={() => void exportCsv()}>{download.isPending ? "Preparing export…" : "Export filtered CSV"}</Button> : null}</section>
    <section className="grid gap-3 rounded-lg border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
      {mode === "reports" ? <label className="space-y-1 text-sm">Report<select disabled={!ready} className={selectClass} value={report} onChange={(event) => update({ ...state, report: event.target.value as ReportKind, page: 1, stockStatus: undefined, revisionStatus: undefined, requestStatus: undefined, loanStatus: undefined, kind: undefined, recordLifecycle: undefined, folderLifecycle: undefined })}>{availableReports.map((kind) => <option key={kind} value={kind}>{reportLabels[kind]}</option>)}</select></label> : <label className="space-y-1 text-sm">Record type<select disabled={!ready} className={selectClass} value={state.kind ?? ""} onChange={(event) => select("kind", event.target.value)}><option value="">All types</option><option value="box">Boxes</option><option value="folder">Folders</option><option value="document">Documents</option><option value="inventory">Template stock</option><option value="template">Templates without stock</option></select></label>}
      <label className="space-y-1 text-sm">Search<Input disabled={!ready} value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Code, title, or keyword" /></label>
      <label className="space-y-1 text-sm">Category<select disabled={!ready} className={selectClass} value={state.categoryId ?? ""} onChange={(event) => select("categoryId", event.target.value)}><option value="">All categories</option>{categories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label className="space-y-1 text-sm">Shelf<select disabled={!ready} className={selectClass} value={state.shelfId ?? ""} onChange={(event) => select("shelfId", event.target.value)}><option value="">All shelves</option>{locations.data?.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}</select></label>
      <details className="rounded-md border p-3 sm:col-span-2 lg:col-span-4" open={filterKeys.some((key) => !["query", "kind", "categoryId", "shelfId"].includes(key) && !!state[key]) || undefined}><summary className="cursor-pointer text-sm font-medium">Advanced filters</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">      <label className="space-y-1 text-sm">Box lifecycle<select disabled={!ready} className={selectClass} value={state.lifecycle ?? ""} onChange={(event) => select("lifecycle", event.target.value)}><option value="">All</option><option value="active">Active</option><option value="archived">Archived</option><option value="retired">Retired</option></select></label>
      {mode === "search" ? <><label className="space-y-1 text-sm">Record lifecycle<select disabled={!ready} className={selectClass} value={state.recordLifecycle ?? ""} onChange={(event) => select("recordLifecycle", event.target.value)}><option value="">All</option><option value="active">Active</option><option value="archived">Archived</option><option value="retired">Retired</option></select></label><label className="space-y-1 text-sm">Folder lifecycle<select disabled={!ready} className={selectClass} value={state.folderLifecycle ?? ""} onChange={(event) => select("folderLifecycle", event.target.value)}><option value="">All</option><option value="active">Active</option><option value="archived">Archived</option><option value="retired">Retired</option></select></label></> : null}
      <label className="space-y-1 text-sm">Confidentiality<select disabled={!ready} className={selectClass} value={state.confidentiality ?? ""} onChange={(event) => select("confidentiality", event.target.value)}><option value="">All permitted</option><option value="internal">Internal</option><option value="restricted">Restricted</option></select></label>
      <label className="space-y-1 text-sm">Stock status<select disabled={!ready} className={selectClass} value={state.stockStatus ?? ""} onChange={(event) => select("stockStatus", event.target.value)}><option value="">All</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="in">In stock</option></select></label>
      <label className="space-y-1 text-sm">Revision status<select disabled={!ready} className={selectClass} value={state.revisionStatus ?? ""} onChange={(event) => select("revisionStatus", event.target.value)}><option value="">All</option><option value="active">Active</option><option value="superseded">Superseded</option><option value="retired">Retired</option></select></label>
      {mode === "reports" ? <label className="space-y-1 text-sm">Request status<select disabled={!ready} className={selectClass} value={state.requestStatus ?? ""} onChange={(event) => select("requestStatus", event.target.value)}><option value="">All</option>{["draft", "submitted", "approved", "rejected", "cancelled", "in_progress", "completed"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label> : null}
      {mode === "reports" && report === "loans" ? <label className="space-y-1 text-sm">Loan status<select disabled={!ready} className={selectClass} value={state.loanStatus ?? ""} onChange={(event) => select("loanStatus", event.target.value)}><option value="">All</option><option value="active">Active</option><option value="overdue">Overdue</option><option value="closed">Closed</option></select></label> : null}
      <label className="space-y-1 text-sm">From date<Input type="date" value={state.from ?? ""} onChange={(event) => select("from", event.target.value)} /></label><label className="space-y-1 text-sm">To date<Input type="date" value={state.to ?? ""} onChange={(event) => select("to", event.target.value)} /></label>
</div><p className="mt-3 text-xs text-muted-foreground">Dates are inclusive in Manila time. {mode === "search" ? "Search uses the record's event date: document date when valid (otherwise creation), or creation date for boxes, folders, templates and balances." : ({ box_folders: "Uses the box or folder creation date.", documents: "Uses the document date when it is a valid date; otherwise the record creation date.", balances: "Uses the stock-line creation date, not the last stock movement date.", ledger: "Uses the stock-transaction recording date.", loans: "Uses the original release date, not the due date or return date.", requests: "Uses the request creation date.", movements: "Uses the recorded relocation date." })[report]}</p></details>
      <div className="flex items-end"><Button variant="outline" onClick={() => { setQueryText(""); update(defaults); }}>Reset filters</Button></div>
    </section>
    <section aria-label="Active filters" className="rounded-md bg-muted p-3 text-sm"><p className="font-medium">{mode === "reports" ? reportLabels[report] : "Archive search"}</p><p className="mt-1 text-muted-foreground">{filterKeys.filter((key) => state[key]).map((key) => `${({ query: "Search", kind: "Record type", categoryId: "Category", shelfId: "Shelf", lifecycle: "Box status", recordLifecycle: "Record status", folderLifecycle: "Folder status", confidentiality: "Confidentiality", stockStatus: "Stock", revisionStatus: "Revision", requestStatus: "Request status", loanStatus: "Loan status", from: "From", to: "To" })[key]}: ${key === "categoryId" ? categories.data?.find((item) => item.id === state[key])?.name ?? "Selected category" : key === "shelfId" ? locations.data?.find((item) => item.id === state[key])?.label ?? "Selected shelf" : String(state[key]).replaceAll("_", " ")}`).join(" · ") || "All permitted records; no additional filters."}</p></section>
    {mode === "reports" && role !== "viewer" ? <p className="text-xs text-muted-foreground">Exports include the selected authorized filters, up to 5,000 rows. Narrow filters if the limit is exceeded.</p> : null}{message ? <p role="status" aria-live="polite" className="text-sm">{message}</p> : null}
    {result.isLoading ? <LoadingState label="Loading results" /> : null}{result.isError ? <ErrorState description="Results are unavailable. Check the filters and try again." onRetry={() => void result.refetch()} /> : null}{result.data?.rows.length === 0 ? <EmptyState title="No results" description="No permitted records match these filters. Try a broader search, expand the date range, or reset filters. Restricted records may need an Administrator grant." /> : null}
    {result.data?.rows.length ? <section className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full min-w-[48rem] text-left text-sm"><caption className="sr-only">{mode === "search" ? "Search results" : reportLabels[report]}</caption><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="p-3">Code</th><th className="p-3">Title</th><th className="p-3">Location</th><th className="p-3">Status</th><th className="p-3">Date</th><th className="p-3">Details</th></tr></thead><tbody>{result.data.rows.map((row) => { const href = detailHref(row); return <tr className="border-b border-border last:border-0" key={`${row.kind}-${row.id}`}><td className="p-3 font-mono text-xs">{href ? <a className="text-primary underline-offset-4 hover:underline" href={href}>{row.code}</a> : row.code}</td><td className="p-3">{row.title}</td><td className="p-3">{row.location || "—"}</td><td className="p-3">{statusLabel(row.status)}</td><td className="p-3">{row.kind === "document" && typeof row.details.date === "string" ? row.details.date : displayDate(row.occurred_at)}</td><td className="p-3 text-xs">{Object.entries(row.details ?? {}).filter(([key]) => key !== "templateId").map(([key, value]) => <p key={key}>{key}: {typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</p>)}</td></tr>; })}</tbody></table></section> : null}
    <nav aria-label="Result pages" className="flex items-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => update({ ...state, page: page - 1 })}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!result.data?.hasMore} onClick={() => update({ ...state, page: page + 1 })}>Next</Button></nav>
  </section>;
}
