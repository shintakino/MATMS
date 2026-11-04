"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { categoryLabels } from "@matms/api/scheduling-contract";
import { client, orpc } from "@/utils/orpc";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { panelClass, selectClass, useScheduleAction, value } from "@/components/booking-controls";
import { useSchedulingList } from "@/components/use-scheduling-list";

type Person = Awaited<ReturnType<typeof client.scheduling.people>>["items"][number];
export function SchedulingDirectory() {
  const { page, setPage, search, setSearch, filter } = useSchedulingList("directory");
  const [editing, setEditing] = useState<Person | null>(null);
  const people = useQuery({ ...orpc.scheduling.people.queryOptions({ input: { page, search: filter, includeInactive: true } }), placeholderData: previous => previous });
  return <section id="people-directory" className="space-y-5"><header><h2 className="text-xl font-semibold">Teacher & personnel directory</h2><p className="mt-2 text-sm text-muted-foreground">Add teachers here without creating accounts. Classify each teacher as SHS or JHS. Link an existing personnel account to let that person file leave for themselves and others.</p></header>
    <PersonEditor key={editing ? `${editing.id}-${editing.version}` : "new"} person={editing} onSaved={() => setEditing(null)} />
    <section className={panelClass}><h3 className="font-semibold">Directory register</h3><div className="mt-4 space-y-2"><Label htmlFor="directory-search">Search directory</Label><Input id="directory-search" value={search} onChange={event => setSearch(event.target.value)} /></div>
      {people.isLoading ? <LoadingState label="Loading directory" /> : null}{people.isError ? <ErrorState description="The directory could not be loaded." onRetry={() => void people.refetch()} /> : null}
      {people.data?.items.length === 0 ? <EmptyState title="No people found" description="Add a teacher or personnel member above, or try another search." /> : null}
      <ul className="mt-4 divide-y">{people.data?.items.map(person => <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h4 className="text-sm font-medium">{person.name}</h4><p className="mt-1 text-xs text-muted-foreground">{person.code} · {categoryLabels[person.category]} · {person.active ? "Active" : "Retired"}</p><p className="mt-1 text-xs text-muted-foreground">{person.userId ? `${person.accountActive ? "Active" : "Inactive"} ${person.role?.replaceAll("_", " ") ?? "personnel"} login linked` : "No login account"}</p></div><Button variant="outline" onClick={() => { setEditing(person); document.getElementById("person-editor")?.scrollIntoView({ block: "start" }); }}>Edit<span className="sr-only"> {person.name}</span></Button></li>)}</ul>
      <nav className="mt-4 flex items-center gap-3" aria-label="Directory pages"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous directory page</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!people.data?.hasMore} onClick={() => setPage(page + 1)}>Next directory page</Button></nav>
    </section>
  </section>;
}
function PersonEditor({ person, onSaved }: { person: Person | null; onSaved: () => void }) {
  const [category, setCategory] = useState<"shs" | "jhs" | "personnel" | "">(person?.category === "teacher" ? "" : person?.category ?? "shs");
  const [accountId, setAccountId] = useState(person?.userId ?? "");
  const { busy, run, feedback } = useScheduleAction();
  const accounts = useSchedulingList("directory-accounts");
  const choices = useQuery({ ...orpc.scheduling.accountChoices.queryOptions({ input: { page: accounts.page, search: accounts.filter } }), enabled: category === "personnel" });
  return <section className={panelClass} id="person-editor"><h3 className="font-semibold">{person ? `Edit ${person.name}` : "Add a teacher or personnel member"}</h3>
    <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); if (!category) return; const form = event.currentTarget, data = new FormData(form);
      const saved = await run(() => client.scheduling.savePerson({ id: person?.id, expectedVersion: person?.version, code: value(data, "person-code"), name: value(data, "person-name"), category, userId: category === "personnel" && accountId ? accountId : null, active: data.get("person-active") === "on" }), "Directory person saved.");
      if (saved) { if (person) onSaved(); else { form.reset(); setAccountId(""); } }
    }}>
      <div className="space-y-2"><Label htmlFor="person-code">Directory code</Label><Input id="person-code" name="person-code" required maxLength={64} defaultValue={person?.code} placeholder="For example JHS-001" /></div>
      <div className="space-y-2"><Label htmlFor="person-name">Person name</Label><Input id="person-name" name="person-name" required maxLength={160} defaultValue={person?.name} /></div>
      <div className="space-y-2"><Label htmlFor="person-category">Person category</Label><select id="person-category" className={selectClass} required value={category} onChange={event => { setCategory(event.target.value as typeof category); if (event.target.value !== "personnel") setAccountId(""); }}><option value="">Choose SHS, JHS or personnel</option><option value="shs">SHS — Senior High School teacher</option><option value="jhs">JHS — Junior High School teacher</option><option value="personnel">Personnel / Administrator</option></select></div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input name="person-active" type="checkbox" defaultChecked={person?.active ?? true} />Active directory person</label>
      {category === "personnel" ? <fieldset className="space-y-3 rounded-lg border p-4 sm:col-span-2"><legend className="px-1 text-sm font-medium">Personnel login (optional)</legend><p className="text-xs text-muted-foreground">Create login credentials in Administration → Users first. Linking an active non-Viewer account enables personnel leave filing. An existing link cannot be reassigned to a different person.</p><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="person-account-search">Find personnel login</Label><Input id="person-account-search" value={accounts.search} onChange={event => accounts.setSearch(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="person-account">Linked login account</Label><select id="person-account" className={selectClass} value={accountId} disabled={!!person?.userId} onChange={event => setAccountId(event.target.value)}><option value="">No login linked</option>{accountId && !choices.data?.items.some(row => row.id === accountId) ? <option value={accountId}>Current linked account</option> : null}{choices.data?.items.map(row => <option key={row.id} value={row.id}>{row.name} · {row.role.replaceAll("_", " ")}</option>)}</select></div></div>{choices.isError ? <ErrorState description="Login choices could not be loaded." onRetry={() => void choices.refetch()} /> : null}<div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={accounts.page === 1} onClick={() => accounts.setPage(accounts.page - 1)}>Previous accounts</Button><span className="text-xs">Page {accounts.page}</span><Button type="button" variant="outline" disabled={!choices.data?.hasMore} onClick={() => accounts.setPage(accounts.page + 1)}>Next accounts</Button></div></fieldset> : <p className="text-sm text-muted-foreground sm:col-span-2">Teachers use this directory identity and can receive a temporary public request link. No teacher account or password is needed.</p>}
      <p className="text-xs text-muted-foreground sm:col-span-2">Codes remain unique. Resolve future leave before changing category; resolve future requests before retirement. Saved request names/categories remain historical snapshots.</p>
      <div className="flex gap-3 sm:col-span-2"><Button disabled={busy} type="submit">{busy ? "Saving…" : person ? "Save directory person" : "Add directory person"}</Button>{person ? <Button type="button" variant="outline" disabled={busy} onClick={onSaved}>Cancel person editing</Button> : null}</div>
    </form>{feedback}
  </section>;
}
