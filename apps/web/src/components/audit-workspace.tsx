"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { SearchableChoice } from "@/components/searchable-choice";
import { client, orpc } from "@/utils/orpc";

type Filters = { action?: string; targetType?: string; actorId?: string; from?: string; to?: string };
const readable = (value: string) => value.replaceAll("_", " ").split(".").join(" · ");
const keys = ["action", "targetType", "actorId", "from", "to"] as const;

export function AuditWorkspace() {
  const [filters, setFilters] = useState<Filters>({});
  const [committedFilters, setCommittedFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = window.setTimeout(() => setCommittedFilters(filters), 300); return () => window.clearTimeout(timer); }, [filters]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next: Filters = {};
    for (const key of keys) { const value = params.get(key); if (value) next[key] = value; }
    setFilters(next);
    const parsed = Number(params.get("page"));
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 10000) setPage(parsed);
  }, []);
  function update(next: Filters, nextPage = 1) {
    setFilters(next); setPage(nextPage);
    const params = new URLSearchParams();
    for (const key of keys) if (next[key]) params.set(key, next[key]!);
    if (nextPage > 1) params.set("page", String(nextPage));
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }
  const choices = useQuery({ queryKey: ["audit-choices"], queryFn: () => client.admin.auditChoices() });
  const accounts = useQuery(orpc.identity.admin.listUsers.queryOptions());
  const result = useQuery({ queryKey: ["admin-audit", committedFilters, page], queryFn: () => client.admin.audit({ filters: committedFilters, page, pageSize: 25 }) });
  return <section className="mx-auto w-full max-w-7xl space-y-5 p-6 sm:p-10"><div><h1 className="text-2xl font-semibold">System audit</h1><p className="text-sm text-muted-foreground">Read-only administrative history. Times are shown in Asia/Manila.</p></div>
    <section className="grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3"><label>Action<select className="h-10 rounded-md border bg-card px-2 text-sm" value={filters.action ?? ""} onChange={(event) => update({ ...filters, action: event.target.value || undefined })}><option value="">All actions</option>{filters.action && !choices.data?.actions.includes(filters.action) ? <option value={filters.action}>{readable(filters.action)}</option> : null}{choices.data?.actions.map((action) => <option key={action} value={action}>{readable(action)}</option>)}</select></label><SearchableChoice label="Actor" value={filters.actorId ?? ""} onChange={(id) => update({ ...filters, actorId: id || undefined })} options={accounts.data?.map((account) => ({ id: account.id, label: `${account.name} — ${account.email}` })) ?? []} /><label>Record type<select className="h-10 rounded-md border bg-card px-2 text-sm" value={filters.targetType ?? ""} onChange={(event) => update({ ...filters, targetType: event.target.value || undefined })}><option value="">All types</option>{filters.targetType && !choices.data?.targetTypes.includes(filters.targetType) ? <option value={filters.targetType}>{readable(filters.targetType)}</option> : null}{choices.data?.targetTypes.map((type) => <option value={type} key={type}>{readable(type)}</option>)}</select></label>{(["from", "to"] as const).map((key) => <label key={key}>{key === "from" ? "From date" : "To date"}<Input type="date" value={filters[key] ?? ""} onChange={(event) => update({ ...filters, [key]: event.target.value || undefined })} /></label>)}<div className="flex items-end"><Button variant="outline" onClick={() => update({})}>Reset filters</Button></div>{choices.isError || accounts.isError ? <p role="alert" className="text-sm">Filter choices are unavailable. <Button variant="outline" onClick={() => { void choices.refetch(); void accounts.refetch(); }}>Retry choices</Button></p> : null}</section>
    {result.isLoading ? <LoadingState label="Loading audit history" /> : null}{result.isError ? <ErrorState description="Audit history is unavailable. Check the filters and retry." onRetry={() => void result.refetch()} /> : null}{result.data?.rows.length === 0 ? <EmptyState title="No audit events" description="No events match these filters." /> : null}
    {result.data?.rows.length ? <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[55rem] text-left text-sm"><caption className="sr-only">System audit events</caption><thead><tr><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Changes</th><th className="p-3">Correlation ID</th></tr></thead><tbody>{result.data.rows.map((row) => <tr className="border-t" key={row.id}><td className="p-3">{new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(row.createdAt))}</td><td className="p-3">{row.actorName ?? row.actorId ?? "System"}</td><td className="p-3">{readable(row.action)}<details className="mt-1"><summary className="text-xs">Action code</summary><code className="text-xs">{row.action}</code></details></td><td className="p-3">{readable(row.targetType)}<details className="mt-1"><summary className="text-xs">Record ID</summary><code className="break-all text-xs">{row.targetId}</code></details></td><td className="p-3"><details><summary>View changes</summary><pre className="max-w-sm whitespace-pre-wrap break-all text-xs">{JSON.stringify({ before: row.before, after: row.after }, null, 2)}</pre></details></td><td className="p-3 font-mono text-xs"><details><summary className="text-xs">Support reference</summary>{row.correlationId}</details></td></tr>)}</tbody></table></div> : null}
    <nav aria-label="Audit pages" className="flex items-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => update(filters, page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!result.data?.hasMore} onClick={() => update(filters, page + 1)}>Next</Button></nav>
  </section>;
}
