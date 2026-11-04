"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { orpc } from "@/utils/orpc";
import { ErrorState } from "@/components/ui-states";
import { useSchedulingList } from "@/components/use-scheduling-list";

export const panelClass = "rounded-xl border border-border bg-card p-5 sm:p-6";
export const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export function value(form: FormData, name: string) { return String(form.get(name) ?? "").trim(); }
export function ScheduleField({ label, name, type = "text", defaultValue, required = true, min }: { label: string; name: string; type?: string; defaultValue?: string; required?: boolean; min?: string }) {
  return <div className="space-y-2"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} min={min} maxLength={type === "text" ? 2000 : undefined} /></div>;
}
export function useScheduleAction() {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  async function run(action: () => Promise<unknown>, success = "Changes saved.") {
    if (busy) return false;
    setBusy(true); setNotice(null);
    try { await action(); await cache.invalidateQueries({ queryKey: orpc.scheduling.key() }); setNotice({ error: false, text: success }); return true; }
    catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "The request could not be completed." }); return false; }
    finally { setBusy(false); }
  }
  return { busy, run, feedback: notice ? <p className={`rounded-lg border p-3 text-sm ${notice.error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/30 bg-accent text-accent-foreground"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null };
}

export function ResourcePicker({ selected, onSelect, idPrefix = "booking", disabled = false }: { selected: string; onSelect: (id: string, name?: string) => void; idPrefix?: string; disabled?: boolean }) {
  const { page, setPage, search, setSearch, filter } = useSchedulingList(idPrefix === "booking" ? "picker" : idPrefix);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const resources = useQuery(orpc.scheduling.resources.queryOptions({ input: { page, search: filter } }));
  const chosen = resources.data?.items.find((r) => r.id === selected) ?? (saved?.id === selected ? saved : null);
  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border p-4 md:col-span-2"><legend className="px-1 text-sm font-medium">Equipment or facility</legend><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${idPrefix}-resource-search`}>Search resources</Label><Input id={`${idPrefix}-resource-search`} value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="space-y-2"><Label htmlFor={`${idPrefix}-resource`}>Choose resource</Label><select id={`${idPrefix}-resource`} className={selectClass} value={selected} required onChange={(e) => { onSelect(e.target.value, resources.data?.items.find((r) => r.id === e.target.value)?.name); setSaved(resources.data?.items.find((r) => r.id === e.target.value) ?? null); }}><option value="">Select equipment or a facility</option>{chosen && !resources.data?.items.some((r) => r.id === chosen.id) ? <option value={chosen.id}>{chosen.name}</option> : null}{selected && !chosen ? <option value={selected}>Selected resource — check availability below</option> : null}{resources.data?.items.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.kind}</option>)}</select></div></div>{resources.isError ? <ErrorState description="Resources are unavailable." onRetry={() => void resources.refetch()} /> : null}{resources.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading resources…</p> : null}<div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs">Resource page {page}</span><Button type="button" variant="outline" disabled={!resources.data?.hasMore} onClick={() => setPage(page + 1)}>Next</Button></div></fieldset>;
}

