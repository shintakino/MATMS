"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { CalendarCheckIcon, Building2Icon, PlusIcon } from "lucide-react";
import { client, orpc } from "@/utils/orpc";
import type { NavigationRole } from "@/components/app-shell";
import { BookingRequestEditor } from "@/components/booking-request-editor";
import { panelClass, ResourcePicker, ScheduleField, selectClass, useScheduleAction, value } from "@/components/booking-controls";
import { BookingCalendar, localToday } from "@/components/booking-calendar";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { SchedulingPersonPicker } from "@/components/scheduling-person-picker";
import { categoryLabels } from "@matms/api/scheduling-contract";

export function BookingWorkspace({ kind, role }: { kind: "leave" | "resource"; role: NavigationRole }) {
  const setup = useQuery(orpc.scheduling.setup.queryOptions());
  const [dates, setDates] = useState({ start: localToday(), end: localToday() });
  const [resourceId, setResourceId] = useState("");
  const [personId, setPersonId] = useState("");
  const operation = useRef<{ intent: string; id: string } | null>(null);
  const { busy, run, feedback } = useScheduleAction();
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const start = query.get("start"), end = query.get("end");
    if (start && end && /^(?:20\d\d|2100)-\d\d-\d\d$/.test(start) && /^(?:20\d\d|2100)-\d\d-\d\d$/.test(end)) setDates({ start, end });
    const person = query.get("person"); if (person && /^[0-9a-f-]{36}$/i.test(person)) setPersonId(person);
    const id = query.get("resource"); if (id && /^[0-9a-f-]{36}$/i.test(id)) setResourceId(id);
  }, []);
  const allowed = kind === "leave" ? !!setup.data?.canFileLeave : role === "admin";
  const blocked = !allowed || (kind === "leave" && !setup.data?.policy.leaveEnabled);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const payload = { startDate: value(data, "booking-start"), endDate: value(data, "booking-end"), detail: value(data, "booking-detail"), resourceId: kind === "resource" ? resourceId : null, personId: personId || undefined };
    const intent = JSON.stringify(payload);
    if (operation.current?.intent !== intent) operation.current = { intent, id: crypto.randomUUID() };
    const operationId = operation.current.id;
    const success = await run(() => kind === "leave" ? client.scheduling.requestLeave({ startDate: payload.startDate, endDate: payload.endDate, personId: payload.personId, reason: payload.detail, operationId }) : client.scheduling.reserve({ startDate: payload.startDate, endDate: payload.endDate, personId: payload.personId, purpose: payload.detail, resourceId, operationId }), "Request submitted. The dates are held while awaiting approval.");
    if (success) { operation.current = null; form.reset(); }
  }
  return <section className="mx-auto w-full max-w-7xl space-y-7 p-5 sm:p-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Plan your school day</p><h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight">{kind === "leave" ? <CalendarCheckIcon aria-hidden="true" className="size-7 text-primary" /> : <Building2Icon aria-hidden="true" className="size-7 text-primary" />}{kind === "leave" ? "Leave requests" : "Equipment & facilities"}</h1><p className="mt-3 max-w-2xl text-sm text-muted-foreground">{kind === "leave" ? "Admin and personnel can file leave for SHS/JHS teachers, each other or themselves. Teachers do not need login accounts." : "Only Admin files internal equipment/facility reservations. File for a teacher, personnel member or yourself, and review requests received through public links."}</p></div><div className="flex flex-wrap gap-3 text-sm"><a className="text-primary underline underline-offset-4" href={kind === "leave" ? "/leave-calendar" : "/availability"}>Open public calendar</a>{role === "admin" ? <a className="text-primary underline underline-offset-4" href="/admin/scheduling">Leave settings</a> : null}{kind === "resource" && role === "admin" ? <a className="text-primary underline underline-offset-4" href="/bookings/resources">Manage resources</a> : null}</div></header>
    {setup.isError ? <ErrorState description="Booking settings could not be loaded." onRetry={() => void setup.refetch()} /> : null}{setup.isLoading ? <LoadingState label="Loading booking settings" /> : null}
    <section id="new-booking" className={panelClass}><h2 className="flex items-center gap-2 font-semibold"><PlusIcon aria-hidden="true" className="size-4" />{kind === "leave" ? "Request leave" : "New reservation"}</h2><p className="mt-2 text-sm text-muted-foreground">Start and end dates are both included. For one day, use the same date. {kind === "leave" ? "Daily limits apply separately to SHS teachers, JHS teachers and personnel, with an optional combined teacher ceiling. The beneficiary’s approved name and dates may appear publicly when publication is enabled; reasons remain private." : "Reserve one named unit at a time. This schedule does not record an inventory issue or equipment handover."}</p>
      {blocked ? <p className="mt-4 rounded-lg bg-muted p-4 text-sm">{kind === "resource" ? "Only an Administrator can create and manage internal reservations. Ask Admin for a temporary public request link, or check availability below." : !allowed ? "An Administrator must link your active personnel account in the directory before you can file leave. Teachers use an Admin-issued public link or ask personnel to file for them." : "An Administrator must enable leave requests and configure daily limits first."}</p> : <form key={`${dates.start}-${dates.end}`} onSubmit={(e) => void submit(e)} className="mt-5 grid gap-4 md:grid-cols-2" aria-describedby="booking-help"><SchedulingPersonPicker selected={personId} onSelect={id => { setPersonId(id); const params = new URLSearchParams(window.location.search); if (id) params.set("person", id); else params.delete("person"); window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`); }} idPrefix="booking-person" self /><ScheduleField label="Start date" name="booking-start" type="date" defaultValue={dates.start} min={setup.data?.today} /><ScheduleField label="End date (inclusive)" name="booking-end" type="date" defaultValue={dates.end} min={setup.data?.today} />{kind === "resource" ? <ResourcePicker selected={resourceId} onSelect={setResourceId} /> : null}<div className="space-y-2 md:col-span-2"><Label htmlFor="booking-detail">{kind === "leave" ? "Leave reason (private)" : "Purpose (private)"}</Label><textarea id="booking-detail" name="booking-detail" required maxLength={2000} className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm" /></div><p id="booking-help" className="text-xs text-muted-foreground md:col-span-2">Pending requests hold capacity. Rejection or cancellation releases the selected dates.</p><div><Button type="submit" disabled={busy || (kind === "resource" && !resourceId)}>{busy ? "Submitting…" : "Submit request"}</Button></div></form>}{feedback}
    </section>
    {allowed ? <ScheduleRequestRegister kind={kind} role={role} /> : null}
    <BookingCalendar kind={kind} canRequest={allowed} selectedPersonId={personId} />
  </section>;
}

function ScheduleRequestRegister({ kind, role }: { kind: "leave" | "resource"; role: NavigationRole }) {
  const managing = role === "admin";
  const [scope, setScope] = useState<"mine" | "all">(managing ? "all" : "mine");
  const [page, setPage] = useState(1);
  useEffect(() => { const q = new URLSearchParams(window.location.search); const p = Number(q.get("requestsPage")); if (p > 0 && Number.isInteger(p) && p <= 100000) setPage(p); if (managing && (q.get("scope") === "all" || q.get("scope") === "mine")) setScope(q.get("scope") as "mine" | "all"); }, [managing]);
  const requests = useQuery(orpc.scheduling.requests.queryOptions({ input: { kind, scope, page } }));
  function update(nextPage: number, nextScope = scope) { setPage(nextPage); setScope(nextScope); const q = new URLSearchParams(window.location.search); q.set("requestsPage", String(nextPage)); q.set("scope", nextScope); window.history.replaceState(null, "", `?${q}`); }
  return <section className={panelClass}><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">{scope === "mine" ? "Requests I filed or that concern me" : "Approval register"}</h2><p className="mt-1 text-sm text-muted-foreground">Review status and saved decisions. Cancel an active request to release its dates.</p></div>{managing ? <div className="space-y-1"><Label htmlFor="request-scope">Show requests</Label><select id="request-scope" className={selectClass} value={scope} onChange={(e) => update(1, e.target.value as "mine" | "all")}><option value="mine">My filed / personal requests</option><option value="all">All requests for approval</option></select></div> : null}</div>
    {requests.isLoading ? <LoadingState label="Loading requests" /> : null}{requests.isError ? <ErrorState description="Requests could not be loaded." onRetry={() => void requests.refetch()} /> : null}{requests.data?.items.length === 0 ? <div className="mt-4"><EmptyState title="No requests yet" description="Submitted requests and their decisions will appear here." /></div> : null}
    <ul className="mt-4 space-y-4">{requests.data?.items.map((row) => <BookingDecision key={`${row.id}-${row.version}`} row={row} kind={kind} managing={managing} readOnly={role === "viewer"} />)}</ul>
    <nav aria-label="Booking request pages" className="mt-5 flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => update(page - 1)}>Previous requests</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!requests.data?.hasMore} onClick={() => update(page + 1)}>Next requests</Button></nav>
  </section>;
}
type RequestRow = Awaited<ReturnType<typeof client.scheduling.requests>>["items"][number];
function BookingDecision({ row, kind, managing, readOnly }: { row: RequestRow; kind: "leave" | "resource"; managing: boolean; readOnly: boolean }) {
  const { busy, run, feedback } = useScheduleAction();
  const [note, setNote] = useState("");
  const [review, setReview] = useState<"approved" | "rejected" | "cancelled" | null>(null);
  const active = (row.status === "pending" || row.status === "approved") && row.endDate >= localToday();
  return <li className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{row.resourceName ? `${row.resourceName} · ` : ""}{row.name}</h3><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize">{row.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{categoryLabels[row.category]} · {row.filedByName ? `Filed by ${row.filedByName}` : "Submitted through a public link — identity requires Admin review"}</p><p className="mt-2 text-sm">{row.startDate}{row.endDate !== row.startDate ? ` → ${row.endDate}` : ""}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{row.detail}</p>{row.decisionNote ? <p className="mt-2 text-sm"><strong>Decision / cancellation note:</strong> {row.decisionNote}</p> : null}
    {active && !readOnly ? <div className="mt-4 space-y-3"><div className="space-y-2"><Label htmlFor={`decision-${row.id}`}>Decision or cancellation note</Label><Input id={`decision-${row.id}`} value={note} maxLength={1000} onChange={(e) => { setNote(e.target.value); setReview(null); }} /></div><div className="flex flex-wrap gap-2">{managing && row.status === "pending" ? <><Button type="button" disabled={busy || !note.trim()} onClick={() => setReview("approved")}>Approve</Button><Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => setReview("rejected")}>Reject</Button></> : null}<Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => setReview("cancelled")}>Cancel request</Button></div>{review ? <div className="rounded-lg bg-muted p-3"><p className="text-sm">Confirm {review === "approved" ? "approval" : review === "rejected" ? "rejection" : "cancellation"} of {row.startDate}{row.endDate !== row.startDate ? ` through ${row.endDate}` : ""}?{review === "approved" && kind === "leave" ? " Approved leave names and dates can appear publicly when publication is enabled." : ""}</p><div className="mt-3 flex gap-2"><Button disabled={busy} onClick={() => void run(() => client.scheduling.decide({ kind, id: row.id, expectedVersion: row.version, status: review, note }), "Decision recorded.")}>{busy ? "Saving…" : "Confirm decision"}</Button><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>Go back</Button></div></div> : null}</div> : null}{active && row.startDate >= localToday() && !readOnly ? <BookingRequestEditor row={row} kind={kind} /> : null}{feedback}
  </li>;
}
