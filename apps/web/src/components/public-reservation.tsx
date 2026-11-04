"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { categoryLabels, scheduleRange } from "@matms/api/scheduling-contract";
import { client } from "@/utils/orpc";
import { ErrorState, LoadingState } from "@/components/ui-states";
import { panelClass, ResourcePicker, selectClass } from "@/components/booking-controls";
import { changeMonth, localToday, monthRange, prettyDay } from "@/components/booking-calendar";

type Preview = Awaited<ReturnType<typeof client.scheduling.invitationPreview>>;
type Calendar = Awaited<ReturnType<typeof client.scheduling.invitationAvailability>>;
type GuestCategory = "student" | "teacher" | "personnel" | "other";

/** Capability state stays in this component, never the shared query cache/storage. */
export function PublicReservation() {
  const [token, setToken] = useState(""), [ready, setReady] = useState(false), [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<{ token: string; data: Preview | null; error: string; loading: boolean }>({ token: "", data: null, error: "", loading: false });
  const [month, setMonth] = useState(localToday().slice(0, 7)), [resourceId, setResourceId] = useState("");
  const [dates, setDates] = useState({ start: localToday(), end: localToday() });
  const [detail, setDetail] = useState(""), [name, setName] = useState(""), [category, setCategory] = useState<GuestCategory>("student");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [receipt, setReceipt] = useState("");
  const [calendar, setCalendar] = useState<{ key: string; data: Calendar | null; error: string; loading: boolean }>({ key: "", data: null, error: "", loading: false });
  const generation = useRef(0);
  const operation = useRef<{ intent: string; id: string } | null>(null);
  useEffect(() => {
    function read() {
      generation.current += 1; setBusy(false);
      setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""); setReady(true);
      setResourceId(""); setDates({ start: localToday(), end: localToday() }); setMonth(localToday().slice(0, 7));
      setDetail(""); setName(""); setCategory("student"); setReceipt(""); setError(""); operation.current = null;
    }
    read(); window.addEventListener("hashchange", read); return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setView({ token, data: null, loading: false, error: "Open the complete temporary link shared by an Administrator. This page cannot accept requests without it." }); return; }
    let active = true;
    setView(previous => ({ token, data: previous.token === token ? previous.data : null, error: "", loading: true }));
    client.scheduling.invitationPreview({ token }).then(data => { if (active) setView({ token, data, error: "", loading: false }); }).catch((reason: unknown) => { if (active) setView({ token, data: null, error: reason instanceof Error ? reason.message : "This link is unavailable. Ask an Administrator for a new link.", loading: false }); });
    return () => { active = false; };
  }, [token, ready, refresh]);
  const preview = view.token === token ? view.data : null;
  const used = !!receipt || preview?.state === "used";
  const calendarKey = `${token}:${month}:${resourceId}:${refresh}`;
  useEffect(() => {
    if (!preview || used || (preview.kind === "resource" && !resourceId)) return;
    let active = true;
    setCalendar({ key: calendarKey, data: null, error: "", loading: true });
    client.scheduling.invitationAvailability({ token, ...monthRange(month), resourceId: preview.kind === "resource" ? resourceId : undefined })
      .then(data => { if (active) setCalendar({ key: calendarKey, data, error: "", loading: false }); })
      .catch((reason: unknown) => { if (active) setCalendar({ key: calendarKey, data: null, loading: false, error: reason instanceof Error ? reason.message : "Availability could not be loaded." }); });
    return () => { active = false; };
  }, [token, month, resourceId, preview, used, calendarKey]);
  useEffect(() => {
    if (!preview || used) return;
    const delay = Math.min(2147483647, Math.max(0, new Date(preview.expiresAt).getTime() - new Date(preview.serverNow).getTime()) + 50);
    const timer = setTimeout(() => setRefresh(value => value + 1), delay); return () => clearTimeout(timer);
  }, [preview, used]);
  const shown = calendar.key === calendarKey ? calendar.data : null;
  const blocked = shown?.days.filter(day => day.day >= dates.start && day.day <= dates.end && day.status !== "available") ?? [];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!preview || busy || used) return;
    setError("");
    const parsed = scheduleRange.safeParse({ startDate: dates.start, endDate: dates.end });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Review your date range."); return; }
    const payload = { token, ...parsed.data, detail, ...(preview.kind === "resource" ? { resourceId, beneficiaryName: name, beneficiaryCategory: category } : {}) };
    const intent = JSON.stringify(payload);
    if (operation.current?.intent !== intent) operation.current = { intent, id: crypto.randomUUID() };
    const requestGeneration = generation.current; setBusy(true);
    try { const result = await client.scheduling.invitationSubmit({ ...payload, operationId: operation.current.id }); if (requestGeneration === generation.current) setReceipt(result.receiptCode); }
    catch (reason) { if (requestGeneration === generation.current) { setError(reason instanceof Error ? reason.message : "The request could not be sent. Retry with the same details."); setRefresh(value => value + 1); } }
    finally { if (requestGeneration === generation.current) setBusy(false); }
  }
  return <div className="mx-auto max-w-6xl space-y-6 px-5 py-7 sm:px-10 sm:py-10">
    <nav aria-label="Public reservation navigation" className="flex flex-wrap items-center justify-between gap-3 border-b pb-5"><a href="/availability" className="text-xl font-bold text-primary">MATMS</a><a href="/availability" className="text-sm text-primary underline underline-offset-4">Public availability</a></nav>
    <header><p className="text-xs font-semibold uppercase tracking-widest text-primary">School requests · no login needed</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">{preview?.kind === "leave" ? "Teacher leave request" : preview?.kind === "resource" ? "Equipment & facility request" : "Public request link"}</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Check available dates and send one request for Admin approval. Pending requests hold their dates; submitting does not mean the request is approved.</p></header>
    {!ready || view.loading ? <LoadingState label="Checking your request link" /> : null}
    {view.token === token && view.error ? <ErrorState title="Request link unavailable" description={view.error} onRetry={() => setRefresh(value => value + 1)} /> : null}
    {used ? <section className={panelClass} aria-label="Request received"><h2 className="text-xl font-semibold">Request received</h2><p className="mt-3 text-sm">This link has been used. An Administrator will review the request; contact the school for the decision or any corrections.</p><p className="mt-3 break-all text-sm"><strong>Receipt:</strong> {receipt || preview?.receiptCode}</p><p className="mt-3 text-sm text-muted-foreground">For another request, ask Admin for a new link.</p></section> : null}
    {preview && !used ? <>
      <section className={panelClass}><h2 className="font-semibold">{preview.person ? `Leave for ${preview.person.name}` : "Choose published equipment or a facility"}</h2>{preview.person ? <p className="mt-2 text-sm text-muted-foreground">{categoryLabels[preview.person.category]} · This link is only for this teacher.</p> : null}<p className="mt-2 text-sm text-muted-foreground">Single use · Expires {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(preview.expiresAt))} · Asia/Manila</p></section>
      {preview.kind === "resource" ? <ResourcePicker selected={resourceId} onSelect={setResourceId} idPrefix="public-resource" publicOnly disabled={busy} /> : null}
      {preview.kind === "leave" || resourceId ? <section className={panelClass} aria-label="Request date availability"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-semibold">Choose available dates</h2><p className="mt-2 text-sm text-muted-foreground">Available: you may request. Reserved/full/closed/past: choose another day. The complete range is checked again when you submit.</p></div><div className="flex items-end gap-2"><Button variant="outline" aria-label="Previous request month" disabled={month === "2000-01" || busy} onClick={() => setMonth(changeMonth(month, -1))}>←</Button><div className="space-y-2"><Label htmlFor="invitation-month">Availability month</Label><Input disabled={busy} id="invitation-month" type="month" min="2000-01" max="2100-12" value={month} onChange={event => { if (/^(20\d\d|2100)-(0[1-9]|1[012])$/.test(event.target.value)) setMonth(event.target.value); }} /></div><Button variant="outline" aria-label="Next request month" disabled={month === "2100-12" || busy} onClick={() => setMonth(changeMonth(month, 1))}>→</Button></div></div>
        {calendar.key !== calendarKey || calendar.loading ? <LoadingState label="Checking dates" /> : null}{calendar.key === calendarKey && calendar.error ? <ErrorState description={calendar.error} onRetry={() => setRefresh(value => value + 1)} /> : null}
        {shown?.resource ? <p className="mt-4 text-sm">Showing: <strong>{shown.resource.name}</strong></p> : null}
        <div className="mt-5 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">{shown?.days.map(day => <section key={day.day} className={`min-w-0 rounded-lg border p-3 ${day.status === "available" ? "bg-card" : "bg-muted/50"}`} aria-label={prettyDay(day.day)}><h3 className="text-xs font-semibold">{prettyDay(day.day)}</h3><p className="mt-2 text-xs font-medium capitalize">{day.status}{day.remaining !== null && day.status === "available" ? ` · ${day.remaining} left` : ""}</p>{day.status === "available" ? <Button type="button" variant="outline" className="mt-3 h-auto whitespace-normal px-2 py-1 text-xs" disabled={busy} onClick={() => setDates({ start: day.day, end: day.day })}>Choose this date<span className="sr-only"> {day.day}</span></Button> : null}</section>)}</div>
        <Button type="button" variant="outline" className="mt-4" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh availability</Button>
      </section> : null}
      <section className={panelClass}><h2 className="font-semibold">Request details</h2><form onSubmit={event => void submit(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
        {preview.kind === "resource" ? <><div className="space-y-2"><Label htmlFor="public-name">Your name / beneficiary name</Label><Input disabled={busy} id="public-name" value={name} maxLength={160} required onChange={event => setName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="public-category">Requester category</Label><select disabled={busy} id="public-category" className={selectClass} value={category} onChange={event => setCategory(event.target.value as GuestCategory)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="personnel">Personnel</option><option value="other">Other</option></select></div></> : null}
        <div className="space-y-2"><Label htmlFor="public-start">Start date</Label><Input disabled={busy} id="public-start" type="date" min={localToday()} required value={dates.start} onChange={event => setDates(previous => ({ ...previous, start: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="public-end">End date (inclusive)</Label><Input disabled={busy} id="public-end" type="date" min={dates.start || localToday()} required value={dates.end} onChange={event => setDates(previous => ({ ...previous, end: event.target.value }))} /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="public-detail">{preview.kind === "leave" ? "Leave reason (private)" : "Purpose (private)"}</Label><textarea disabled={busy} id="public-detail" className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm" required maxLength={2000} value={detail} onChange={event => setDetail(event.target.value)} /></div>
        <p className="text-xs text-muted-foreground sm:col-span-2">For one day, choose the same start and end date. Both endpoints are included. {preview.kind === "leave" ? "Approved teacher names and dates may appear on the separately published leave calendar. Your reason remains private." : "Your name and purpose are private to the Admin approval register."}</p>
        {blocked.length ? <p role="alert" className="rounded-lg bg-muted p-3 text-sm sm:col-span-2">Choose different dates. Unavailable in the shown month: {blocked.slice(0, 5).map(day => `${day.day} (${day.status})`).join(", ")}{blocked.length > 5 ? "…" : ""}</p> : null}
        {error ? <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive sm:col-span-2">{error}</p> : null}
        <div><Button type="submit" disabled={busy || view.loading || blocked.length > 0 || (preview.kind === "resource" && !resourceId)}>{busy ? "Sending…" : "Submit request"}</Button></div>
      </form></section>
    </> : null}
    <footer className="border-t pt-5 text-xs text-muted-foreground">Keep your link private. A used, expired or revoked link cannot file another request. Teachers and students do not need a MATMS account.</footer>
  </div>;
}
