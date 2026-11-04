"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { useState } from "react";
import { client, orpc } from "@/utils/orpc";

type Edit = { kind: "category"; id: string; code: string; name: string } | { kind: "location"; id: string; code: string; room: string; shelf: string; rack: string; position: string; label: string };

export function ReferenceAdministration() {
  const cache = useQueryClient();
  const categories = useQuery(orpc.archive.categories.list.queryOptions());
  const locations = useQuery(orpc.archive.locations.list.queryOptions());
  const [pending, setPending] = useState<{ kind: "category" | "location"; id: string; label: string; active: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const mutation = useMutation({ mutationFn: (input: NonNullable<typeof pending>) => input.kind === "category" ? client.archive.categories.setActive({ id: input.id, active: input.active }) : client.archive.locations.setActive({ id: input.id, active: input.active }) });
  const update = useMutation({ mutationFn: async (input: Edit) => {
    if (input.kind === "category") {
      await client.archive.categories.update({ id: input.id, code: input.code, name: input.name });
      return;
    }
    await client.archive.locations.update({ id: input.id, code: input.code, room: input.room, shelf: input.shelf, rack: input.rack, position: input.position || null, label: input.label });
  } });
  async function confirm() { if (!pending) return; try { await mutation.mutateAsync(pending); await cache.invalidateQueries(); setMessage("Status updated."); } catch (error) { setMessage(error instanceof Error ? error.message : "The status could not be changed."); } setPending(null); }
  async function saveEdit() { if (!edit) return; try { await update.mutateAsync(edit); await cache.invalidateQueries(); setMessage("Changes saved."); setEdit(null); } catch (error) { setMessage(error instanceof Error ? error.message : "The changes could not be saved."); } setConfirmEdit(false); }
  function beginEdit(kind: "category" | "location", id: string) {
    setMessage("");
    if (kind === "category") { const item = categories.data?.find((entry) => entry.id === id); if (item) setEdit({ kind, id, code: item.code, name: item.name }); }
    else { const item = locations.data?.find((entry) => entry.id === id); if (item) setEdit({ kind, id, code: item.code, room: item.room, shelf: item.shelf, rack: item.rack, position: item.position ?? "", label: item.label }); }
  }
  const entries = [...(categories.data ?? []).map((item) => ({ kind: "category" as const, id: item.id, label: item.name, active: item.active })), ...(locations.data ?? []).map((item) => ({ kind: "location" as const, id: item.id, label: item.label, active: item.active }))];
  return <section className="mx-auto mb-8 w-full max-w-5xl space-y-4 px-6 sm:px-10">
    <h2 className="font-semibold">Categories and locations</h2>
    <p className="text-sm text-muted-foreground">Edit existing entries or change their status. Inactive entries remain in existing records and history.</p>
    {categories.isLoading || locations.isLoading ? <p>Loading categories and locations…</p> : null}
    {categories.isError || locations.isError ? <p role="alert">The list is unavailable. Reload to retry.</p> : null}
    {entries.length ? <ul className="divide-y rounded-md border">{entries.map((item) => <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><span>{item.kind}: {item.label} — {item.active ? "Active" : "Inactive"}</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => beginEdit(item.kind, item.id)}>Edit</Button><Button size="sm" variant="outline" onClick={() => setPending({ ...item, active: !item.active })}>{item.active ? "Deactivate" : "Activate"}</Button></div></li>)}</ul> : !categories.isLoading && !locations.isLoading && !categories.isError && !locations.isError ? <p className="text-sm text-muted-foreground">No categories or locations yet.</p> : null}
    {edit ? <form className="grid gap-3 rounded-md border p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setConfirmEdit(true); }}>
      <h3 className="font-semibold sm:col-span-2">Edit {edit.kind}</h3>
      <label className="text-sm">Code<Input value={edit.code} maxLength={64} required onChange={(event) => setEdit({ ...edit, code: event.target.value })} /></label>
      {edit.kind === "category" ? <label className="text-sm">Name<Input value={edit.name} minLength={2} maxLength={120} required onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label> : <>
        <label className="text-sm">Label<Input value={edit.label} maxLength={200} required onChange={(event) => setEdit({ ...edit, label: event.target.value })} /></label>
        <label className="text-sm">Room<Input value={edit.room} maxLength={120} required onChange={(event) => setEdit({ ...edit, room: event.target.value })} /></label>
        <label className="text-sm">Shelf<Input value={edit.shelf} maxLength={120} required onChange={(event) => setEdit({ ...edit, shelf: event.target.value })} /></label>
        <label className="text-sm">Rack<Input value={edit.rack} maxLength={120} required onChange={(event) => setEdit({ ...edit, rack: event.target.value })} /></label>
        <label className="text-sm">Position<Input value={edit.position} maxLength={120} onChange={(event) => setEdit({ ...edit, position: event.target.value })} /></label>
      </>}
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={update.isPending}>Review changes</Button><Button type="button" variant="outline" disabled={update.isPending} onClick={() => setEdit(null)}>Cancel</Button></div>
    </form> : null}
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
    <AlertDialog open={confirmEdit} onOpenChange={(open) => { if (!open && !update.isPending) setConfirmEdit(false); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Save changes to this {edit?.kind}?</AlertDialogTitle><AlertDialogDescription>Existing boxes using this entry will show the updated details. Previous movement snapshots remain in history; printed labels may need updating.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={update.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={update.isPending} onClick={(event) => { event.preventDefault(); void saveEdit(); }}>{update.isPending ? "Saving…" : "Save changes"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) setPending(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{pending?.active ? "Activate" : "Deactivate"} {pending?.label}?</AlertDialogTitle><AlertDialogDescription>Existing records and history keep this reference. Inactive entries cannot be selected for new boxes, templates, or box relocation.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); void confirm(); }}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
