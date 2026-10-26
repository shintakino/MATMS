"use client";

import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import type { NavigationRole } from "@/components/app-shell";
import { orpc } from "@/utils/orpc";

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "The record could not be saved.";
}

export function BoxRegister({ role }: { role: NavigationRole }) {
  const queryClient = useQueryClient();
  const boxes = useQuery(orpc.archive.boxes.list.queryOptions());
  const categories = useQuery(orpc.archive.categories.list.queryOptions());
  const locations = useQuery(orpc.archive.locations.list.queryOptions());
  const createBox = useMutation(orpc.archive.boxes.create.mutationOptions());
  const [message, setMessage] = useState<string | null>(null);

  async function create(formData: FormData) {
    setMessage(null);
    try {
      await createBox.mutateAsync({
        code: String(formData.get("code") ?? ""),
        categoryId: String(formData.get("categoryId") ?? ""),
        shelfLocationId: String(formData.get("shelfLocationId") ?? ""),
        confidentiality: String(formData.get("confidentiality") ?? "internal") as "internal" | "restricted",
        notes: String(formData.get("notes") ?? "") || null,
      });
      await queryClient.invalidateQueries({ queryKey: orpc.archive.boxes.list.queryKey() });
      setMessage("Box created.");
    } catch (error) {
      setMessage(messageFor(error));
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10">
      <section className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold">Boxes</h1><p className="text-sm text-muted-foreground">Authorized physical archive locations and their current filing status.</p></div>
        {role === "admin" ? <a className="text-sm text-primary underline-offset-4 hover:underline" href="#create-box">Create a box</a> : null}
      </section>

      {role === "admin" ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm" id="create-box">
          <h2 className="text-lg font-semibold">Create box</h2>
          <form action={create} className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="box-code">Box code</Label><Input id="box-code" name="code" required /></div>
            <div className="space-y-2"><Label htmlFor="box-category">Category</Label><select className="h-8 w-full border border-input bg-transparent px-2.5 text-xs" id="box-category" name="categoryId" required><option value="">Select a category</option>{categories.data?.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="box-location">Shelf location</Label><select className="h-8 w-full border border-input bg-transparent px-2.5 text-xs" id="box-location" name="shelfLocationId" required><option value="">Select a location</option>{locations.data?.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="box-confidentiality">Confidentiality</Label><select className="h-8 w-full border border-input bg-transparent px-2.5 text-xs" defaultValue="internal" id="box-confidentiality" name="confidentiality"><option value="internal">Internal</option><option value="restricted">Restricted</option></select></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="box-notes">Notes</Label><textarea className="min-h-20 w-full border border-input bg-transparent p-2 text-sm" id="box-notes" name="notes" /></div>
            <div className="md:col-span-2"><Button disabled={createBox.isPending || categories.isLoading || locations.isLoading} type="submit">{createBox.isPending ? "Creating…" : "Create box"}</Button></div>
          </form>
          {message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground" role="status">{message}</p> : null}
        </section>
      ) : null}

      {boxes.isLoading ? <LoadingState label="Loading authorized boxes" /> : null}
      {boxes.isError ? <ErrorState description="The box register is unavailable. Please try again." onRetry={() => void boxes.refetch()} /> : null}
      {boxes.data?.length === 0 ? <EmptyState title="No boxes available" description="No boxes are available in your authorized scope." /> : null}
      {boxes.data?.length ? <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm"><table className="w-full min-w-[42rem] text-left text-sm"><caption className="sr-only">Authorized boxes</caption><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="p-3">Code</th><th className="p-3">Category</th><th className="p-3">Location</th><th className="p-3">Confidentiality</th><th className="p-3">Lifecycle</th></tr></thead><tbody>{boxes.data.map((box) => <tr className="border-b border-border last:border-0" key={box.id}><td className="p-3 font-medium"><a className="text-primary underline-offset-4 hover:underline" href={`/boxes/${box.id}`}>{box.code}</a></td><td className="p-3">{box.categoryName}</td><td className="p-3">{box.locationLabel}</td><td className="p-3 capitalize">{box.confidentiality}</td><td className="p-3 capitalize">{box.lifecycle}</td></tr>)}</tbody></table></section> : null}
    </main>
  );
}

export function DocumentRegister() {
  const documents = useQuery(orpc.archive.documents.list.queryOptions());
  return <main className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><section><h1 className="text-2xl font-semibold">Documents</h1><p className="text-sm text-muted-foreground">Authorized physical document metadata and home locations.</p></section>{documents.isLoading ? <LoadingState label="Loading authorized documents" /> : null}{documents.isError ? <ErrorState description="The document register is unavailable. Please try again." onRetry={() => void documents.refetch()} /> : null}{documents.data?.length === 0 ? <EmptyState title="No documents available" description="No documents are available in your authorized scope." /> : null}{documents.data?.length ? <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm"><table className="w-full min-w-[42rem] text-left text-sm"><caption className="sr-only">Authorized documents</caption><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="p-3">Code</th><th className="p-3">Title</th><th className="p-3">Folder</th><th className="p-3">Box</th><th className="p-3">Lifecycle</th></tr></thead><tbody>{documents.data.map((document) => <tr className="border-b border-border last:border-0" key={document.id}><td className="p-3 font-mono text-xs">{document.code}</td><td className="p-3"><a className="font-medium text-primary underline-offset-4 hover:underline" href={`/documents/${document.id}`}>{document.title}</a></td><td className="p-3">{document.folderName}</td><td className="p-3">{document.boxCode}</td><td className="p-3 capitalize">{document.lifecycle}</td></tr>)}</tbody></table></section> : null}</main>;
}

export function ArchiveDetail({ kind, id }: { kind: "box" | "folder" | "document"; id: string }) {
  if (kind === "box") return <BoxDetail id={id} />;
  if (kind === "folder") return <FolderDetail id={id} />;
  return <DocumentDetail id={id} />;
}

function UnavailableDetail({ retry }: { retry: () => void }) { return <main className="p-6 sm:p-10"><ErrorState title="This content is unavailable" description="You may not have access, or this record may no longer be available." onRetry={retry} /></main>; }

function DocumentDetail({ id }: { id: string }) {
  const detail = useQuery(orpc.archive.documents.get.queryOptions({ input: { id } }));
  if (detail.isLoading) return <main className="p-6 sm:p-10"><LoadingState label="Loading archive record" /></main>;
  if (detail.isError || !detail.data) return <UnavailableDetail retry={() => void detail.refetch()} />;
  const document = detail.data;
  return <main className="mx-auto w-full max-w-4xl space-y-4 p-6 sm:p-10"><section><p className="text-sm text-muted-foreground">Document</p><h1 className="text-2xl font-semibold">{document.title}</h1><p className="font-mono text-sm text-muted-foreground">{document.code}</p></section><dl className="grid gap-4 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Lifecycle</dt><dd className="capitalize">{document.lifecycle}</dd></div><div><dt className="text-muted-foreground">Confidentiality</dt><dd className="capitalize">{document.confidentiality}</dd></div><div><dt className="text-muted-foreground">Document date</dt><dd>{document.documentDate ?? "Not recorded"}</dd></div><div><dt className="text-muted-foreground">Covered period</dt><dd>{document.coveredPeriod ?? "Not recorded"}</dd></div><div className="sm:col-span-2"><dt className="text-muted-foreground">Description</dt><dd>{document.description ?? "No description"}</dd></div></dl></main>;
}

function FolderDetail({ id }: { id: string }) {
  const detail = useQuery(orpc.archive.folders.get.queryOptions({ input: { id } }));
  if (detail.isLoading) return <main className="p-6 sm:p-10"><LoadingState label="Loading archive record" /></main>;
  if (detail.isError || !detail.data) return <UnavailableDetail retry={() => void detail.refetch()} />;
  const result = detail.data;
  return <main className="mx-auto w-full max-w-5xl space-y-5 p-6 sm:p-10"><section><p className="text-sm text-muted-foreground">Folder</p><h1 className="text-2xl font-semibold">{result.folder.name}</h1><p className="font-mono text-sm text-muted-foreground">{result.folder.code}</p></section><FolderStockPanel folderId={result.folder.id} /><section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Permitted documents</h2>{result.documents.length ? <ul className="mt-3 divide-y divide-border">{result.documents.map((document) => <li className="py-3" key={document.id}><a className="font-medium text-primary underline-offset-4 hover:underline" href={`/documents/${document.id}`}>{document.title}</a><span className="ml-2 font-mono text-xs text-muted-foreground">{document.code}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No permitted documents are present.</p>}</section></main>;
}

function FolderStockPanel({ folderId }: { folderId: string }) {
  const inventory = useQuery(orpc.inventory.inventory.forFolder.queryOptions({ input: { folderId } }));
  if (inventory.isLoading) return <section className="rounded-lg border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Loading folder stock…</p></section>;
  if (inventory.isError || !inventory.data?.length) return <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Template stock</h2><p className="mt-2 text-sm text-muted-foreground">No permitted active template stock is available in this folder.</p></section>;
  return <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Template stock</h2><ul className="mt-3 divide-y divide-border">{inventory.data.map((line) => { const status = line.count === 0 ? "Out of stock" : line.count <= line.threshold ? "Low stock" : "In stock"; return <li className="flex items-center justify-between gap-4 py-3 text-sm" key={line.id}><span><span className="font-medium">{line.templateName}</span><span className="ml-2 font-mono text-xs text-muted-foreground">{line.templateCode}</span></span><span className="text-right tabular-nums">{line.count} · {status}</span></li>; })}</ul></section>;
}

function BoxDetail({ id }: { id: string }) {
  const detail = useQuery(orpc.archive.boxes.get.queryOptions({ input: { id } }));
  if (detail.isLoading) return <main className="p-6 sm:p-10"><LoadingState label="Loading archive record" /></main>;
  if (detail.isError || !detail.data) return <UnavailableDetail retry={() => void detail.refetch()} />;
  const result = detail.data;
  return <main className="mx-auto w-full max-w-5xl space-y-5 p-6 sm:p-10"><section><p className="text-sm text-muted-foreground">{result.categoryName} · {result.location.label}</p><h1 className="text-2xl font-semibold">Box {result.code}</h1><p className="text-sm text-muted-foreground capitalize">{result.lifecycle} · {result.confidentiality}</p></section><section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Permitted folders</h2>{result.folders.length ? <ul className="mt-3 divide-y divide-border">{result.folders.map((folder) => <li className="py-3" key={folder.id}><a className="font-medium text-primary underline-offset-4 hover:underline" href={`/folders/${folder.id}`}>{folder.name}</a><span className="ml-2 font-mono text-xs text-muted-foreground">{folder.code}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No permitted folders are present.</p>}</section></main>;
}
