"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { SearchableChoice } from "@/components/searchable-choice";
import { orpc } from "@/utils/orpc";
import { ArchiveHistory } from "@/components/archive-history";

const selectClass = "block h-9 w-full border bg-background px-2";
const value = (data: FormData, key: string) => String(data.get(key) ?? "");

export function FolderIntake({ boxId }: { boxId: string }) {
  const cache = useQueryClient();
  const create = useMutation(orpc.archive.folders.create.mutationOptions());
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    try {
      const saved = await create.mutateAsync({ boxId, code: value(data, "code"), name: value(data, "name"), color: value(data, "color") as "yellow" | "blue" | "red" | "other", confidentiality: value(data, "confidentiality") as "internal" | "restricted", isTemplateFolder: data.has("template"), notes: value(data, "notes") || null, urgency: value(data, "urgency") || null });
      setCreatedId(saved.id); await cache.invalidateQueries(); form.reset(); setMessage("Folder created.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Folder could not be created."); }
  }
  return <section className="mx-auto w-full max-w-5xl px-6 pb-6"><form onSubmit={submit} className="grid gap-3 rounded-lg border p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Create folder</h2><label>Code<Input name="code" required maxLength={64} /></label><label>Name<Input name="name" required maxLength={240} /></label><label>Color<select name="color" className={selectClass}><option>blue</option><option>yellow</option><option>red</option><option>other</option></select></label><label>Confidentiality<select name="confidentiality" className={selectClass}><option value="internal">Internal</option><option value="restricted">Restricted</option></select></label><label>Urgency<Input name="urgency" maxLength={120} /></label><label>Notes<Input name="notes" maxLength={4000} /></label><label className="sm:col-span-2"><input type="checkbox" name="template" /> Folder holds blank template stock</label><div><Button type="submit" disabled={create.isPending}>Create folder</Button></div><p role="status">{message}</p>{createdId ? <a className="text-sm text-primary underline" href={`/folders/${createdId}`}>Open created folder</a> : null}</form></section>;
}

export function DocumentIntake() {
  const cache = useQueryClient();
  const folders = useQuery(orpc.archive.folders.list.queryOptions());
  const create = useMutation(orpc.archive.documents.create.mutationOptions());
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try {
      const saved = await create.mutateAsync({ folderId: value(data, "folder"), code: value(data, "code"), title: value(data, "title"), documentDate: value(data, "date") || null, coveredPeriod: value(data, "period") || null, keywords: value(data, "keywords") || null, description: value(data, "description") || null, digitalUrl: value(data, "url") || null, confidentiality: value(data, "confidentiality") as "internal" | "restricted" });
      setCreatedId(saved.id); await cache.invalidateQueries(); form.reset(); setMessage("Document record created.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Document could not be created."); }
  }
  return <section className="mx-auto w-full max-w-7xl px-6 pb-6"><form onSubmit={submit} className="grid gap-3 rounded-lg border p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Create document record</h2><p className="text-sm text-muted-foreground sm:col-span-2">File in this order: shelf location → box → folder → document. Select the physical home folder. Restricted parents and independently restricted records each need the appropriate access.</p><SearchableChoice label="Folder" name="folder" required disabled={folders.isLoading || folders.isError} options={folders.data?.map((folder) => ({ id: folder.id, label: `${folder.locationLabel} / ${folder.boxCode} / ${folder.code} — ${folder.name}` })) ?? []} empty="Create a box and folder first, or ask an Administrator for access." /><label>Document code<Input name="code" required maxLength={64} /></label><label>Title<Input name="title" required maxLength={500} /></label><label>Confidentiality<select name="confidentiality" className={selectClass}><option value="internal">Internal</option><option value="restricted">Restricted</option></select></label><details className="rounded-md border p-3 sm:col-span-2"><summary className="cursor-pointer text-sm font-medium">Optional document details</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label>Document date<Input name="date" type="date" /></label><label>Covered period<Input name="period" maxLength={240} /></label><label>Keywords<Input name="keywords" maxLength={1000} /></label><label>Approved HTTPS link (optional)<Input name="url" type="url" /></label><label className="sm:col-span-2">Description<Input name="description" maxLength={4000} /></label></div></details><div><Button type="submit" disabled={create.isPending || folders.isLoading || folders.isError || !folders.data?.length}>Create document</Button></div><p role="status">{folders.isError ? "Folders unavailable. Reload to retry." : message}</p>{createdId ? <a className="text-sm text-primary underline" href={`/documents/${createdId}`}>Open created document</a> : null}</form></section>;
}

export function InventorySetup() {
  const cache = useQueryClient();
  const folders = useQuery(orpc.archive.folders.list.queryOptions());
  const templates = useQuery(orpc.inventory.templates.list.queryOptions());
  const create = useMutation(orpc.inventory.inventory.createLine.mutationOptions());
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try {
      await create.mutateAsync({ templateId: value(data, "template"), folderId: value(data, "folder"), threshold: Number(value(data, "threshold")) });
      await cache.invalidateQueries(); form.reset(); setMessage("Stock line created with zero balance. Use Receive to add copies.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Stock line could not be created."); }
  }
  return <section className="mx-auto w-full max-w-7xl px-6 pb-6"><form onSubmit={submit} className="grid gap-3 rounded-lg border p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Set up template stock</h2><p className="text-sm sm:col-span-2">Setup order: create a template revision → designate a blank-form folder → create the stock line → receive verified copies. Only active folders designated for template stock are offered.</p>{templates.data && !templates.data.some((template) => template.status === "active") ? <p className="text-sm sm:col-span-2">Create an active revision in <a className="underline" href="/templates">Templates</a> before setting up stock.</p> : null}<label>Template revision<select className={selectClass} name="template" required><option value="">Select revision</option>{templates.data?.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><SearchableChoice label="Folder" name="folder" required disabled={folders.isLoading || folders.isError} options={folders.data?.filter((folder) => folder.isTemplateFolder).map((folder) => ({ id: folder.id, label: `${folder.locationLabel} / ${folder.boxCode} / ${folder.code} — ${folder.name}` })) ?? []} empty="No eligible blank-form folders. Open a box, create a folder and select Folder holds blank template stock." /><label>Low-stock threshold<Input name="threshold" type="number" min="0" defaultValue="5" required /></label><div><Button type="submit" disabled={create.isPending || folders.isLoading || templates.isLoading || folders.isError || templates.isError || !folders.data?.some((folder) => folder.isTemplateFolder) || !templates.data?.some((template) => template.status === "active")}>Create stock line</Button></div><p role="status">{folders.isError || templates.isError ? "Choices unavailable. Reload to retry." : message}</p>{message.startsWith("Stock line created") ? <a className="text-sm text-primary underline" href="/inventory">Receive verified printed copies</a> : null}<a className="text-sm text-primary underline" href="/boxes">Open boxes to set up a template folder</a></form></section>;
}

export function BoxActions({ boxId, role = "admin" }: { boxId: string; role?: "admin" | "property_custodian" | "staff" }) {
  const cache = useQueryClient();
  const locations = useQuery(orpc.archive.locations.list.queryOptions());
  const categories = useQuery(orpc.archive.categories.list.queryOptions());
  const box = useQuery(orpc.archive.boxes.get.queryOptions({ input: { id: boxId } }));
  const changeCode = useMutation(orpc.archive.boxes.changeCode.mutationOptions());
  const relocate = useMutation(orpc.archive.boxes.relocate.mutationOptions());
  const update = useMutation(orpc.archive.boxes.update.mutationOptions());
  const [message, setMessage] = useState("");
  const [pendingDetails, setPendingDetails] = useState<FormData | null>(null);
  async function saveDetails(data: FormData) {
    try {
      await update.mutateAsync({ boxId, categoryId: value(data, "category"), confidentiality: value(data, "confidentiality") as "internal" | "restricted", notes: value(data, "notes") || null });
      await cache.invalidateQueries(); setMessage("Box details saved."); setPendingDetails(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The change could not be saved."); setPendingDetails(null); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>, action: "code" | "move" | "details") {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (action === "details") { setPendingDetails(data); return; }
    try {
      if (action === "code") await changeCode.mutateAsync({ boxId, code: value(data, "code") });
      else if (action === "move") await relocate.mutateAsync({ boxId, shelfLocationId: value(data, "location"), reason: value(data, "reason") });
      await cache.invalidateQueries(); form.reset(); setMessage(action === "code" ? "Box code updated." : "Box relocated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The change could not be saved."); }
  }
  return <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-6 sm:grid-cols-2">
    {role === "admin" ? <form onSubmit={(event) => void submit(event, "code")} className="space-y-3 rounded-lg border p-5"><h2 className="font-semibold">Change box code</h2><label>New code<Input name="code" required maxLength={64} /></label><Button type="submit" disabled={changeCode.isPending}>Save code</Button></form> : null}
    <form onSubmit={(event) => void submit(event, "move")} className="space-y-3 rounded-lg border p-5"><h2 className="font-semibold">Move box</h2><label>New location<select className={selectClass} name="location" required><option value="">Select location</option>{locations.data?.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Reason<Input name="reason" minLength={3} required /></label><Button type="submit" disabled={relocate.isPending || locations.isLoading}>Record move</Button></form>
    {role === "admin" && box.data && categories.data ? <form onSubmit={(event) => void submit(event, "details")} className="space-y-3 rounded-lg border p-5 sm:col-span-2"><h2 className="font-semibold">Edit box details</h2><label>Category<select name="category" className={selectClass} defaultValue={box.data.categoryId}>{categories.data.filter((item) => item.active || item.id === box.data.categoryId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Confidentiality<select name="confidentiality" className={selectClass} defaultValue={box.data.confidentiality}><option value="internal">Internal</option><option value="restricted">Restricted</option></select></label><label>Notes<Input name="notes" defaultValue={box.data.notes ?? ""} maxLength={4000} /></label><Button type="submit" disabled={update.isPending}>Review details</Button></form> : null}
    <p role="status">{locations.isError || categories.isError || box.isError ? "Box details or choices unavailable. Reload to retry." : message}</p>
    <ArchiveHistory kind="box" id={boxId} />
    <AlertDialog open={pendingDetails !== null} onOpenChange={(open) => { if (!open && !update.isPending) setPendingDetails(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Save box details?</AlertDialogTitle><AlertDialogDescription>Changing the category changes the classification of contained records in search and reports. Changing confidentiality changes inherited access for every contained record.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={update.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={update.isPending} onClick={(event) => { event.preventDefault(); if (pendingDetails) void saveDetails(pendingDetails); }}>Save details</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

export function TemplateEditor({ id }: { id: string }) {
  const cache = useQueryClient();
  const detail = useQuery(orpc.inventory.templates.get.queryOptions({ input: { id } }));
  const categories = useQuery(orpc.archive.categories.list.queryOptions());
  const update = useMutation(orpc.inventory.templates.update.mutationOptions());
  const setStatus = useMutation(orpc.inventory.templates.setStatus.mutationOptions());
  const [status, setStatusValue] = useState<"active" | "superseded" | "retired">("superseded");
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      await update.mutateAsync({ id, name: value(data, "name"), description: value(data, "description") || null, digitalUrl: value(data, "url"), code: value(data, "code"), familyCode: value(data, "familyCode"), categoryId: value(data, "categoryId"), revisionLabel: value(data, "revisionLabel"), revisionDate: value(data, "revisionDate") || null });
      await cache.invalidateQueries(); setMessage("Template details saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Template could not be updated."); }
  }
  if (!detail.data) return null;
  const template = detail.data.template;
  async function changeStatus() {
    try { await setStatus.mutateAsync({ id, status }); await cache.invalidateQueries(); setMessage(`Revision status changed to ${status}.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Status could not be changed."); }
    setConfirm(false);
  }
  return <section className="mx-auto w-full max-w-5xl space-y-4 px-6 pb-8"><form onSubmit={submit} className="space-y-3 rounded-lg border p-5"><h2 className="font-semibold">Edit template details</h2><p className="text-sm">Revision identity can be corrected before stock activity or supersession. Create a new revision after that point.</p><label>Revision code<Input name="code" required maxLength={64} defaultValue={template.code} /></label><label>Family code<Input name="familyCode" required maxLength={64} defaultValue={template.familyCode} /></label><label>Category<select className={selectClass} name="categoryId" defaultValue={template.categoryId}>{categories.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Revision label<Input name="revisionLabel" required maxLength={120} defaultValue={template.revisionLabel} /></label><label>Revision date<Input name="revisionDate" type="date" defaultValue={template.revisionDate ?? ""} /></label><label>Name<Input name="name" required maxLength={240} defaultValue={template.name} /></label><label>Description<Input name="description" maxLength={4000} defaultValue={template.description ?? ""} /></label><label>Approved HTTPS master link<Input name="url" type="url" required defaultValue={template.digitalUrl} /></label><Button type="submit" disabled={update.isPending || template.status === "retired"}>Save details</Button></form><div className="space-y-3 rounded-lg border p-5"><h2 className="font-semibold">Revision status</h2><label>New status<select className={selectClass} value={status} onChange={(event) => setStatusValue(event.target.value as typeof status)}><option value="active">Active</option><option value="superseded">Superseded</option><option value="retired">Retired</option></select></label><Button variant="outline" disabled={setStatus.isPending || template.status === "retired"} onClick={() => setConfirm(true)}>Review status change</Button></div><p role="status">{message}</p><AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Change revision to {status}?</AlertDialogTitle><AlertDialogDescription>Superseded stock requires an Administrator decision for issuance. Retirement requires zero stock and cannot be undone; history remains available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={setStatus.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={setStatus.isPending} onClick={(event) => { event.preventDefault(); void changeStatus(); }}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section>;
}
