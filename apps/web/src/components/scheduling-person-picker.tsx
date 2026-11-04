"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { categoryLabels } from "@matms/api/scheduling-contract";
import { orpc } from "@/utils/orpc";
import { ErrorState } from "@/components/ui-states";
import { selectClass } from "@/components/booking-controls";
import { useSchedulingList } from "@/components/use-scheduling-list";

export function SchedulingPersonPicker({ selected, onSelect, idPrefix, self = false, teachersOnly = false, disabled = false }: { selected: string; onSelect: (id: string) => void; idPrefix: string; self?: boolean; teachersOnly?: boolean; disabled?: boolean }) {
  const { page, setPage, search, setSearch, filter } = useSchedulingList(idPrefix);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const people = useQuery(orpc.scheduling.people.queryOptions({ input: { page, search: filter, teachersOnly } }));
  const chosen = people.data?.items.find(row => row.id === selected) ?? (saved?.id === selected ? saved : null);
  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border p-4 md:col-span-2"><legend className="px-1 text-sm font-medium">{teachersOnly ? "Teacher receiving this link" : "Person taking leave or using the resource"}</legend>
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${idPrefix}-search`}>Find a {teachersOnly ? "teacher" : "person"}</Label><Input id={`${idPrefix}-search`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or directory code" /></div>
      <div className="space-y-2"><Label htmlFor={`${idPrefix}-person`}>{teachersOnly ? "Choose teacher" : "Request for"}</Label><select id={`${idPrefix}-person`} className={selectClass} value={selected} required={!self} onChange={event => { onSelect(event.target.value); setSaved(people.data?.items.find(row => row.id === event.target.value) ?? null); }}>
        <option value="">{self ? "Myself" : "Choose a directory teacher"}</option>
        {selected && !people.data?.items.some(row => row.id === selected) ? <option value={selected}>{chosen?.name ?? "Selected person — check the directory"}</option> : null}
        {people.data?.items.map(row => <option key={row.id} value={row.id} disabled={row.category === "teacher"}>{row.name} · {categoryLabels[row.category]} · {row.code}</option>)}
      </select></div></div>
    <p className="text-xs text-muted-foreground">{teachersOnly ? "This single-use link is bound to this teacher. The teacher does not need an account." : "You are filing on behalf of this person. Teachers have separate SHS/JHS directory entries and do not need login credentials."}</p>
    {people.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading directory…</p> : null}
    {people.data?.items.length === 0 ? <p className="text-sm text-muted-foreground">No active {teachersOnly ? "SHS/JHS teachers" : "people"} match this search. Ask Admin to add or classify the directory person.</p> : null}
    {people.isError ? <ErrorState description="The directory could not be loaded." onRetry={() => void people.refetch()} /> : null}
    <div className="flex items-center gap-3"><Button variant="outline" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous people</Button><span className="text-xs">Page {page}</span><Button variant="outline" type="button" disabled={!people.data?.hasMore} onClick={() => setPage(page + 1)}>Next people</Button></div>
  </fieldset>;
}
