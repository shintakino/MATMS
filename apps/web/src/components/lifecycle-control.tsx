"use client";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { Button } from "@matms/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "@/utils/orpc";

type Lifecycle = "active" | "archived" | "retired";
export function LifecycleControl({ kind, id }: { kind: "box" | "folder" | "document"; id: string }) {
  const cache = useQueryClient();
  const [target, setTarget] = useState<Lifecycle>("archived");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const mutation = useMutation({ mutationFn: async (lifecycle: Lifecycle) => {
    if (kind === "box") return client.archive.boxes.setLifecycle({ boxId: id, lifecycle });
    if (kind === "folder") return client.archive.folders.setLifecycle({ folderId: id, lifecycle });
    return client.archive.documents.setLifecycle({ documentId: id, lifecycle });
  } });
  async function confirm() {
    setMessage("");
    try { await mutation.mutateAsync(target); await cache.invalidateQueries(); setMessage(`Lifecycle changed to ${target}.`); setOpen(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The lifecycle could not be changed."); setOpen(false); }
  }
  return <section className="mx-auto mb-8 w-full max-w-5xl space-y-3 px-6 sm:px-10"><h2 className="font-semibold">Lifecycle administration</h2><div className="flex flex-wrap items-end gap-3"><label className="text-sm">Change status<select className="block h-9 border bg-background px-2" value={target} onChange={(e) => setTarget(e.target.value as Lifecycle)}><option value="active">Active</option><option value="archived">Archived</option><option value="retired">Retired</option></select></label><Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(true)}>Review change</Button></div>{message ? <p role="status" aria-live="polite" className="text-sm">{message}</p> : null}<AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Change {kind} status to {target}?</AlertDialogTitle><AlertDialogDescription>{target === "retired" ? "Retirement hides this record from ordinary registers. Resolve outstanding loans, request lines, inventory, and active descendants first. History and the stable identifier are preserved." : target === "archived" ? "Archived locations remain searchable and accept existing returns, but cannot accept new filing or routine inventory operations." : "Reactivation restores routine use only when the parent locations are active."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); void confirm(); }}>{mutation.isPending ? "Saving…" : "Confirm change"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section>;
}
