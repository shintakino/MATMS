"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { client, orpc } from "@/utils/orpc";
import { ArchiveHistory } from "@/components/archive-history";

const text = (data: FormData, name: string) => String(data.get(name) ?? "");
const selectClass = "block h-9 w-full border bg-background px-2";

export function ArchiveMaintenance({ kind, id, role }: { kind: "folder" | "document"; id: string; role: "admin" | "property_custodian" | "staff" }) {
  const cache = useQueryClient();
  const folder = useQuery({ ...orpc.archive.folders.get.queryOptions({ input: { id } }), enabled: kind === "folder" });
  const document = useQuery({ ...orpc.archive.documents.get.queryOptions({ input: { id } }), enabled: kind === "document" });
  const boxes = useQuery(orpc.archive.boxes.list.queryOptions());
  const folders = useQuery(orpc.archive.folders.list.queryOptions());
  const [message, setMessage] = useState("");
  const mutation = useMutation({ mutationFn: async ({ data, move }: { data: FormData; move: boolean }) => {
    if (move) {
      if (kind === "folder") await client.archive.folders.relocate({ folderId: id, boxId: text(data, "destination"), reason: text(data, "reason") });
      else await client.archive.documents.refile({ documentId: id, folderId: text(data, "destination"), reason: text(data, "reason") });
    } else if (kind === "folder") {
      await client.archive.folders.update({ id, code: text(data, "code"), isTemplateFolder: data.has("template"), name: text(data, "name"), color: text(data, "color") as "yellow" | "blue" | "red" | "other", urgency: text(data, "urgency") || null, notes: text(data, "notes") || null, confidentiality: text(data, "confidentiality") as "internal" | "restricted" });
    } else {
      await client.archive.documents.update({ id, code: text(data, "code"), title: text(data, "title"), documentDate: text(data, "date") || null, coveredPeriod: text(data, "period") || null, keywords: text(data, "keywords") || null, description: text(data, "description") || null, digitalUrl: text(data, "url") || null, confidentiality: text(data, "confidentiality") as "internal" | "restricted" });
    }
  } });
  async function submit(event: React.FormEvent<HTMLFormElement>, move: boolean) {
    event.preventDefault();
    try { await mutation.mutateAsync({ data: new FormData(event.currentTarget), move }); await cache.invalidateQueries(); setMessage(move ? "Location updated and movement recorded." : "Details saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The change could not be saved."); }
  }
  const record = kind === "folder" ? folder.data?.folder : document.data;
  if (!record) return null;
  return <section className="mx-auto w-full max-w-5xl space-y-4 px-6 pb-8">
    {(kind === "document" || role === "admin") ? <form onSubmit={(event) => void submit(event, false)} className="grid gap-3 rounded-lg border p-5 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">Edit {kind} details</h2>
      <label>Code<Input name="code" defaultValue={record.code} required maxLength={64} /></label>
      {kind === "folder" && folder.data ? <>
        <label>Name<Input name="name" defaultValue={folder.data.folder.name} required maxLength={240} /></label>
        <label><input type="checkbox" name="template" defaultChecked={folder.data.folder.isTemplateFolder} /> Folder holds blank template stock</label>
        <label>Color<select className={selectClass} name="color" defaultValue={folder.data.folder.color}>{["yellow", "blue", "red", "other"].map((color) => <option key={color}>{color}</option>)}</select></label>
        <label>Urgency<Input name="urgency" defaultValue={folder.data.folder.urgency ?? ""} maxLength={120} /></label>
        <label>Notes<Input name="notes" defaultValue={folder.data.folder.notes ?? ""} maxLength={4000} /></label>
      </> : document.data ? <>
        <label>Title<Input name="title" defaultValue={document.data.title} required maxLength={500} /></label>
        <label>Document date<Input name="date" type="date" defaultValue={document.data.documentDate ?? ""} /></label>
        <label>Covered period<Input name="period" defaultValue={document.data.coveredPeriod ?? ""} maxLength={240} /></label>
        <label>Keywords<Input name="keywords" defaultValue={document.data.keywords ?? ""} maxLength={1000} /></label>
        <label>Description<Input name="description" defaultValue={document.data.description ?? ""} maxLength={4000} /></label>
        <label>Approved HTTPS link<Input name="url" type="url" defaultValue={document.data.digitalUrl ?? ""} /></label>
      </> : null}
      <label>Confidentiality<select className={selectClass} name="confidentiality" defaultValue={record.confidentiality}><option value="internal" disabled={role !== "admin" && record.confidentiality === "restricted"}>Internal</option><option value="restricted">Restricted</option></select></label>
      <div><Button type="submit" disabled={mutation.isPending || record.lifecycle === "retired"}>Save details</Button></div>
    </form> : null}
    <form onSubmit={(event) => void submit(event, true)} className="space-y-3 rounded-lg border p-5">
      <h2 className="font-semibold">{kind === "folder" ? "Move folder" : "Refile document"}</h2>
      <label>Destination<select className={selectClass} name="destination" required><option value="">Select destination</option>{kind === "folder" ? boxes.data?.filter((box) => box.lifecycle === "active").map((box) => <option key={box.id} value={box.id}>{box.code}</option>) : folders.data?.map((item) => <option key={item.id} value={item.id}>{item.boxCode} / {item.code} — {item.name}</option>)}</select></label>
      <label>Reason<Input name="reason" minLength={3} maxLength={1000} required /></label>
      <Button type="submit" disabled={mutation.isPending || record.lifecycle === "retired"}>Record move</Button>
    </form>
    <p role="status" aria-live="polite">{boxes.isError || folders.isError ? "Destination choices are unavailable. Reload to retry." : message}</p>
    <ArchiveHistory kind={kind} id={id} />
  </section>;
}
