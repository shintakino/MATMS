"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { client } from "@/utils/orpc";

export function ScopedRegister({ kind }: { kind: "box" | "folder" | "document" | "inventory" | "template" }) {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lifecycle, setLifecycle] = useState<"active" | "archived" | "retired" | "">("active");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("registerQuery") ?? ""); setDebounced(params.get("registerQuery") ?? "");
    setPage(Math.max(1, Math.min(10000, Number(params.get("registerPage")) || 1)));
    const state = params.get("registerLifecycle");
    if (state === "active" || state === "archived" || state === "retired") setLifecycle(state);
    if (params.has("registerLifecycle") && !state) setLifecycle("");
    setReady(true);
  }, []);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    if (debounced) url.searchParams.set("registerQuery", debounced); else url.searchParams.delete("registerQuery");
    if (page > 1) url.searchParams.set("registerPage", String(page)); else url.searchParams.delete("registerPage");
    // An explicit empty value means all statuses; an absent value defaults active.
    url.searchParams.set("registerLifecycle", lifecycle);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [debounced, page, lifecycle, ready]);
  const filters = { kind, query: debounced || undefined, ...(kind === "template" ? { revisionStatus: lifecycle === "archived" ? "superseded" as const : lifecycle || undefined } : kind === "box" ? { lifecycle: lifecycle || undefined } : { recordLifecycle: lifecycle || undefined }) };
  const result = useQuery({ enabled: ready, queryKey: ["scoped-register", kind, filters, page], queryFn: () => client.reporting.search({ filters, page, pageSize: 25 }) });
  return <section className="space-y-4"><div className="flex flex-wrap items-end gap-3"><label>Search<Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Code, name or keyword" /></label><label>Status<select className="block h-9 border bg-background px-2" value={lifecycle} onChange={(event) => { setLifecycle(event.target.value as typeof lifecycle); setPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="archived">{kind === "template" ? "Superseded" : "Archived"}</option><option value="retired">Retired</option></select></label><Button variant="outline" onClick={() => { setQuery(""); setLifecycle(""); setPage(1); }}>Reset filters</Button></div>
    {result.isLoading ? <p>Loading records…</p> : result.isError ? <p role="alert">Records unavailable. <Button variant="outline" onClick={() => void result.refetch()}>Retry</Button></p> : !result.data?.rows.length ? <p>No permitted records match these filters.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm"><caption className="sr-only">Permitted {kind} register</caption><thead><tr>{["Code", "Name", "Location", "Status", "Details"].map((name) => <th className="p-3" key={name}>{name}</th>)}</tr></thead><tbody>{result.data.rows.map((row) => {
      const href = row.kind === "inventory" ? `/templates/${String(row.details.templateId)}` : `/${row.kind === "box" ? "boxes" : row.kind === "document" ? "documents" : row.kind === "folder" ? "folders" : "templates"}/${row.id}`;
      return <tr key={`${row.kind}-${row.id}`} className="border-b"><td className="p-3">{row.code}</td><td className="p-3"><a className="text-primary underline" href={href}>{row.title}</a></td><td className="p-3">{row.location || "No physical stock location"}</td><td className="p-3">{row.status === "out" ? "Out of stock" : row.status === "low" ? "Low stock" : row.status === "in" ? "In stock" : row.status.replaceAll("_", " ")}</td><td className="p-3">{row.kind === "inventory" ? `${row.details.count} copies; threshold ${row.details.threshold}; ${row.details.revisionStatus}` : row.details.lifecycle ? String(row.details.lifecycle) : "—"}</td></tr>;
    })}</tbody></table></div>}
    <nav aria-label={`${kind} register pages`} className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || result.isFetching} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!result.data?.hasMore || result.isFetching} onClick={() => setPage(page + 1)}>Next</Button></nav>
  </section>;
}
