"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui-states";
import { client } from "@/utils/orpc";

export function SettingsWorkspace({ fallbackOrigin }: { fallbackOrigin: string | null }) {
  const cache = useQueryClient();
  const settings = useQuery({ queryKey: ["school-settings"], queryFn: () => client.admin.settings.get() });
  const mutation = useMutation({ mutationFn: (input: { schoolName: string; timezone: "Asia/Manila"; canonicalOrigin: string | null; redirectPlan?: string; sessionIdleMinutes: number; sessionMaxHours: number }) => client.admin.settings.update(input) });
  const [schoolName, setSchoolName] = useState("");
  const [origin, setOrigin] = useState("");
  const [plan, setPlan] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(30);
  const [maxHours, setMaxHours] = useState(12);
  useEffect(() => { if (settings.data) { setIdleMinutes(settings.data.sessionIdleMinutes); setMaxHours(settings.data.sessionMaxHours); } }, [settings.data]);
  useEffect(() => { if (settings.data) { setSchoolName(settings.data.schoolName); setOrigin(settings.data.canonicalOrigin ?? ("id" in settings.data ? "" : fallbackOrigin ?? "")); } }, [settings.data, fallbackOrigin]);
  async function save() {
    setMessage("");
    try { await mutation.mutateAsync({ schoolName, timezone: "Asia/Manila", canonicalOrigin: origin.trim() || null, redirectPlan: plan, sessionIdleMinutes: idleMinutes, sessionMaxHours: maxHours }); await cache.invalidateQueries(); setPlan(""); setOpen(false); setMessage("Settings saved."); }
    catch (error) { setOpen(false); setMessage(error instanceof Error ? error.message : "Settings could not be saved."); }
  }
  if (settings.isLoading) return <section className="p-6"><LoadingState label="Loading settings" /></section>;
  if (settings.isError) return <section className="p-6"><ErrorState description="Settings are unavailable." onRetry={() => void settings.refetch()} /></section>;
  return <section className="mx-auto w-full max-w-3xl space-y-5 p-6 sm:p-10"><div><h1 className="text-2xl font-semibold">School settings</h1><p className="text-sm text-muted-foreground">Manage school identity, sign-in limits and the public address printed in QR labels.</p></div><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setOpen(true); }}><fieldset className="space-y-4 rounded-lg border bg-card p-5"><legend className="px-2 font-semibold">School identity</legend><label className="block text-sm">School name<Input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} maxLength={200} required /></label><label className="block text-sm">Time zone<Input value="Asia/Manila" readOnly /></label></fieldset><fieldset className="space-y-4 rounded-lg border bg-card p-5"><legend className="px-2 font-semibold">Sign-in and session policy</legend><p className="text-sm text-muted-foreground">Idle timeout signs users out after inactivity. Maximum lifetime requires a new sign-in even with continued use.</p><label className="block text-sm">Idle session timeout (minutes)<Input type="number" min={5} max={120} value={idleMinutes} onChange={(event) => setIdleMinutes(Number(event.target.value))} required /></label><label className="block text-sm">Maximum session lifetime (hours)<Input type="number" min={1} max={24} value={maxHours} onChange={(event) => setMaxHours(Number(event.target.value))} required /></label><p className="text-sm">Use the school-approved policy. Reducing these limits may require existing users to sign in again.</p></fieldset><fieldset className="space-y-4 rounded-lg border bg-card p-5"><legend className="px-2 font-semibold">QR label website address</legend><p className="text-sm text-muted-foreground">Use the public HTTPS website address that printed box labels should open, such as https://archive.example.edu, with no extra path.</p><label className="block text-sm">Public website address (Canonical HTTPS origin)<Input type="url" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://archive.example.edu" /></label><label className="block text-sm">Old-label redirect and reprint plan<textarea className="min-h-24 w-full rounded-md border bg-background p-2" value={plan} onChange={(event) => setPlan(event.target.value)} maxLength={2000} /></label><p className="text-sm text-muted-foreground">Changing the origin affects printed labels. Keep old URLs redirecting to their existing box paths and reprint or verify those labels. A plan is required whenever the saved origin changes.</p></fieldset><Button type="submit" disabled={mutation.isPending}>Review settings</Button></form>{message ? <p role="status" aria-live="polite">{message}</p> : null}<AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Save school settings?</AlertDialogTitle><AlertDialogDescription>Review the school name, inactivity timeout and maximum sign-in lifetime before saving. Changing the website address can make printed QR labels unusable unless the redirect and reprint plan is carried out.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); void save(); }}>{mutation.isPending ? "Saving…" : "Save settings"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section>;
}
