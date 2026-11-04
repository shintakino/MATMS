"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { client, orpc } from "@/utils/orpc";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { panelClass, selectClass, useScheduleAction } from "@/components/booking-controls";
import { SchedulingPersonPicker } from "@/components/scheduling-person-picker";

function displayTime(value: string) { return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
export function SchedulingInvitations() {
  const [kind, setKind] = useState<"leave" | "resource">("leave"), [personId, setPersonId] = useState("");
  const [hours, setHours] = useState("24"), [page, setPage] = useState(1);
  const [share, setShare] = useState<{ url: string; expiresAt: string } | null>(null), [copied, setCopied] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { busy, run, feedback } = useScheduleAction();
  const links = useQuery({ ...orpc.scheduling.invitations.queryOptions({ input: { page, search: "" } }), refetchInterval: 30000 });
  return <section id="public-links" className="space-y-5"><header><h2 className="text-xl font-semibold">Temporary public request links</h2><p className="mt-2 text-sm text-muted-foreground">Share a single-use link without giving someone a login. Teachers receive their own leave link. Resource links let teachers, personnel or students choose published equipment/facilities and send a request for Admin approval.</p></header>
    <section className={panelClass}><h3 className="font-semibold">Create a public link</h3><form className="mt-4 grid gap-4 sm:grid-cols-2" onChange={() => { setShare(null); setCopied(""); }} onSubmit={async event => {
      event.preventDefault(); setCopied("");
      await run(async () => {
        const created = await client.scheduling.createInvitation({ kind, personId: kind === "leave" ? personId : undefined, expiresInHours: Number(hours) });
        setShare({ url: `${window.location.origin}/reservation#token=${created.token}`, expiresAt: created.expiresAt });
      }, "Public link created. Copy it below before leaving this page.");
    }}>
      <div className="space-y-2"><Label htmlFor="invitation-kind">Request type</Label><select disabled={busy} id="invitation-kind" className={selectClass} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="leave">Leave — one named teacher</option><option value="resource">Equipment or facility — published choices</option></select></div>
      <div className="space-y-2"><Label htmlFor="invitation-expiry">Link expires after</Label><select disabled={busy} id="invitation-expiry" className={selectClass} value={hours} onChange={event => setHours(event.target.value)}><option value="1">1 hour</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></div>
      {kind === "leave" ? <SchedulingPersonPicker selected={personId} onSelect={setPersonId} idPrefix="invitation" teachersOnly disabled={busy} /> : <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground sm:col-span-2">Visitors choose only active published resources. They provide their name, category and purpose. A submitted claim still needs your review and approval.</p>}
      <p className="text-xs text-muted-foreground sm:col-span-2">The first successful submission uses the link. Failed date/capacity checks do not use it. Copy and share the link yourself; MATMS does not send email or messages.</p>
      <div><Button type="submit" disabled={busy || (kind === "leave" && !personId)}>{busy ? "Creating…" : "Create request link"}</Button></div>
    </form>{feedback}
      {share ? <section className="mt-5 space-y-3 rounded-lg border border-primary/30 bg-accent/40 p-4" aria-label="New public request link"><h4 className="font-medium">Copy this link now</h4><p className="text-sm text-muted-foreground">Expires {displayTime(share.expiresAt)} (Asia/Manila). Anyone holding the link can use it once. The full link cannot be recovered from the register.</p><div className="space-y-2"><Label htmlFor="share-request-link">Public request link</Label><Input id="share-request-link" ref={input} readOnly value={share.url} onFocus={event => event.target.select()} /></div><div className="flex flex-wrap gap-3"><Button type="button" onClick={async () => { try { await navigator.clipboard.writeText(share.url); setCopied("Link copied. Share it with the intended requester."); } catch { input.current?.select(); setCopied("Select and copy the link from the field above."); } }}>Copy link</Button><Button type="button" variant="outline" onClick={() => { setShare(null); setCopied(""); }}>Hide link</Button></div>{copied ? <p className="text-sm" role="status">{copied}</p> : null}</section> : null}
    </section>
    <section className={panelClass}><h3 className="font-semibold">Public link register</h3><p className="mt-2 text-sm text-muted-foreground">Revoking a link stops access and new submissions. Requests already filed stay in the approval register until you decide or cancel them.</p>
      {links.isLoading ? <LoadingState label="Loading public links" /> : null}{links.isError ? <ErrorState description="Public links could not be loaded." onRetry={() => void links.refetch()} /> : null}
      {links.data?.items.length === 0 ? <EmptyState title="No public links yet" description="Create a teacher leave link or a resource request link above." /> : null}
      <ul className="mt-4 divide-y">{links.data?.items.map(link => <InvitationRow key={`${link.id}-${link.version}`} link={link} />)}</ul>
      <nav className="mt-4 flex items-center gap-3" aria-label="Public link pages"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous links</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!links.data?.hasMore} onClick={() => setPage(page + 1)}>Next links</Button></nav>
    </section>
  </section>;
}
type Invitation = Awaited<ReturnType<typeof client.scheduling.invitations>>["items"][number];
function InvitationRow({ link }: { link: Invitation }) {
  const [confirm, setConfirm] = useState(false), { busy, run, feedback } = useScheduleAction();
  return <li className="space-y-3 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-medium">{link.name ?? "Published equipment & facilities"}</h4><p className="mt-1 text-xs text-muted-foreground">{link.kind === "leave" ? "Teacher leave" : "Resource request"} · <span className="font-medium capitalize">{link.state}</span></p><p className="mt-1 text-xs text-muted-foreground">Expires {displayTime(link.expiresAt)} · Asia/Manila</p>{link.usedAt ? <p className="mt-1 text-xs text-muted-foreground">Submitted {displayTime(link.usedAt)}</p> : null}</div>{link.state !== "revoked" ? <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>Revoke link<span className="sr-only"> for {link.name ?? "equipment & facilities"}</span></Button> : null}</div>
    {confirm ? <div className="rounded-lg bg-muted p-3"><p className="text-sm">Stop access to this link? This does not cancel a request already received.</p><div className="mt-3 flex gap-3"><Button disabled={busy} onClick={() => void run(() => client.scheduling.revokeInvitation({ id: link.id, expectedVersion: link.version }), "Public link revoked.")}>{busy ? "Revoking…" : "Confirm revoke"}</Button><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Keep link</Button></div></div> : null}{feedback}
  </li>;
}
