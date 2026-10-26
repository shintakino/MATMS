"use client";

import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export function ArchiveAdministration() {
  const queryClient = useQueryClient();
  const createCategory = useMutation(orpc.archive.categories.create.mutationOptions());
  const createLocation = useMutation(orpc.archive.locations.create.mutationOptions());
  const [message, setMessage] = useState<string | null>(null);
  async function submitCategory(formData: FormData) { try { await createCategory.mutateAsync({ code: String(formData.get("code") ?? ""), name: String(formData.get("name") ?? "") }); await queryClient.invalidateQueries({ queryKey: orpc.archive.categories.list.queryKey() }); setMessage("Category created."); } catch { setMessage("The category could not be created."); } }
  async function submitLocation(formData: FormData) { try { await createLocation.mutateAsync({ code: String(formData.get("code") ?? ""), room: String(formData.get("room") ?? ""), shelf: String(formData.get("shelf") ?? ""), rack: String(formData.get("rack") ?? ""), position: String(formData.get("position") ?? "") || null, label: String(formData.get("label") ?? "") }); await queryClient.invalidateQueries({ queryKey: orpc.archive.locations.list.queryKey() }); setMessage("Shelf location created."); } catch { setMessage("The location could not be created."); } }
  return <main className="mx-auto w-full max-w-5xl space-y-6 p-6 sm:p-10"><section><h1 className="text-2xl font-semibold">Archive setup</h1><p className="text-sm text-muted-foreground">Create the controlled categories and structured shelf locations used by boxes.</p></section><div className="grid gap-6 md:grid-cols-2"><section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Category</h2><form action={submitCategory} className="mt-4 space-y-3"><div className="space-y-1"><Label htmlFor="category-code">Code</Label><Input id="category-code" name="code" required /></div><div className="space-y-1"><Label htmlFor="category-name">Name</Label><Input id="category-name" name="name" required /></div><Button disabled={createCategory.isPending} type="submit">Create category</Button></form></section><section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Shelf location</h2><form action={submitLocation} className="mt-4 grid gap-3"><div className="space-y-1"><Label htmlFor="location-code">Code</Label><Input id="location-code" name="code" required /></div><div className="space-y-1"><Label htmlFor="location-label">Label</Label><Input id="location-label" name="label" required /></div><div className="grid grid-cols-3 gap-2"><div className="space-y-1"><Label htmlFor="room">Room</Label><Input id="room" name="room" required /></div><div className="space-y-1"><Label htmlFor="shelf">Shelf</Label><Input id="shelf" name="shelf" required /></div><div className="space-y-1"><Label htmlFor="rack">Rack</Label><Input id="rack" name="rack" required /></div></div><div className="space-y-1"><Label htmlFor="position">Position</Label><Input id="position" name="position" /></div><Button disabled={createLocation.isPending} type="submit">Create location</Button></form></section></div>{message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}</main>;
}
