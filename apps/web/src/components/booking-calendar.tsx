"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { categoryLabels } from "@matms/api/scheduling-contract";
import { useSchedulingList } from "@/components/use-scheduling-list";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export function localToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
export function monthRange(month: string) {
  const [year, number] = month.split("-").map(Number);
  return { startDate: `${month}-01`, endDate: `${month}-${new Date(Date.UTC(year!, number!, 0)).getUTCDate()}` };
}
export function changeMonth(month: string, delta: number) { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); return date.toISOString().slice(0, 7); }
export function prettyDay(day: string) { return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", month: "short", day: "numeric", weekday: "short" }).format(new Date(`${day}T00:00:00Z`)); }

export function BookingCalendar({ kind, publicPage = false, canRequest = true, selectedPersonId = "" }: { kind: "leave" | "resource"; publicPage?: boolean; canRequest?: boolean; selectedPersonId?: string }) {
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [resourceId, setResourceId] = useState("");
  const { page, setPage, search, setSearch, filter } = useSchedulingList("calendar");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("month");
    if (value && /^(20\d\d|2100)-(0[1-9]|1[012])$/.test(value)) setMonth(value);
    const resource = params.get("resource");
    if (resource && /^[0-9a-f-]{36}$/i.test(resource)) setResourceId(resource);
  }, []);
  const resources = useQuery({ ...(publicPage ? orpc.scheduling.publicResources : orpc.scheduling.resources).queryOptions({ input: { page, search: filter } }), enabled: kind === "resource", refetchInterval: 60000 });
  const range = monthRange(month);
  const resource = useQuery({ ...(publicPage ? orpc.scheduling.publicResourceAvailability : orpc.scheduling.resourceAvailability).queryOptions({ input: { ...range, resourceId: resourceId || undefined } }), enabled: kind === "resource" && !!resourceId, refetchInterval: 30000 });
  const leave = useQuery({ ...(publicPage ? orpc.scheduling.publicLeaveCalendar : orpc.scheduling.leaveAvailability).queryOptions({ input: range }), enabled: kind === "leave", refetchInterval: 30000 });
  function updateMonth(value: string) {
    if (!/^(20\d\d|2100)-(0[1-9]|1[012])$/.test(value)) return;
    setMonth(value);
    const params = new URLSearchParams(window.location.search); params.set("month", value); window.history.replaceState(null, "", `?${params}`);
  }
  const days = kind === "resource" ? resource.data?.days.map((d) => d.day) : leave.data?.days.map((d) => d.day);
  const loading = kind === "resource" ? resources.isLoading || (!!resourceId && resource.isLoading) : leave.isLoading;
  const failed = kind === "resource" ? resources.isError || (!!resourceId && resource.isError) : leave.isError;
  const hidden = kind === "leave" && publicPage && leave.data?.published === false;
  const offset = (new Date(`${range.startDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  return <section className="space-y-5" aria-label={kind === "leave" ? "Leave availability calendar" : "Resource availability calendar"}>
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border bg-card p-5">
      <div><h2 className="flex items-center gap-2 font-semibold"><CalendarDaysIcon aria-hidden="true" className="size-5 text-primary" />{kind === "leave" ? "Leave calendar" : "Plan your reservation"}</h2><p className="mt-1 text-sm text-muted-foreground">Whole days · Asia/Manila · Updates every 30 seconds</p></div>
      <div className="flex items-end gap-2"><Button aria-label="Previous month" variant="outline" disabled={month === "2000-01"} onClick={() => updateMonth(changeMonth(month, -1))}><ChevronLeftIcon aria-hidden="true" /></Button><div className="space-y-1"><Label htmlFor={`${kind}-month`}>Month</Label><Input id={`${kind}-month`} type="month" min="2000-01" max="2100-12" value={month} onChange={(e) => updateMonth(e.target.value)} /></div><Button aria-label="Next month" variant="outline" disabled={month === "2100-12"} onClick={() => updateMonth(changeMonth(month, 1))}><ChevronRightIcon aria-hidden="true" /></Button></div>
    </div>
    {kind === "resource" ? <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="calendar-search">Find equipment or a facility</Label><Input id="calendar-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" /></div><div className="space-y-2"><Label htmlFor="calendar-resource">Resource</Label><select id="calendar-resource" className={selectClass} value={resourceId} onChange={(e) => { setResourceId(e.target.value); const params = new URLSearchParams(window.location.search); params.set("resource", e.target.value); window.history.replaceState(null, "", `?${params}`); }}><option value="">Choose a resource on this page</option>{resourceId && !resources.data?.items.some((r) => r.id === resourceId) ? <option value={resourceId}>{resource.data?.resource?.name ?? "Selected resource"}</option> : null}{resources.data?.items.map((r) => <option value={r.id} key={r.id}>{r.name} · {r.kind}</option>)}</select></div><div className="flex items-center gap-3 sm:col-span-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous resources</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!resources.data?.hasMore} onClick={() => setPage(page + 1)}>More resources</Button></div>{resource.data?.resource ? <p className="text-sm sm:col-span-2">Showing: <strong>{resource.data.resource.name}</strong>{resource.data.resource.description ? <span className="mt-2 block whitespace-pre-wrap break-words text-muted-foreground">{resource.data.resource.description}</span> : null}</p> : null}</div> : null}
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Calendar legend"><span>Available — you may request</span><span>Reserved / Full — no capacity</span><span>Closed — requests disabled</span><span>Past — history only</span></div>
    <p className="text-sm text-muted-foreground">Pending requests hold their dates. Availability can change before submission; a request still needs approval.{kind === "leave" ? " Only approved leave names appear on the public calendar. Leave reasons stay private." : " Reservation details and requester names stay private."}</p>
    {publicPage ? <p className="rounded-lg border bg-card p-4 text-sm">To submit a request, ask an Administrator for a temporary public request link. Teachers and students do not need login credentials.</p> : null}
    {loading ? <LoadingState label="Loading availability" /> : null}
    {failed ? <ErrorState description="Availability could not be loaded. Try again before choosing dates." onRetry={() => { void resources.refetch(); void (kind === "leave" ? leave : resource).refetch(); }} /> : null}
    {hidden ? <EmptyState title="Leave calendar is not published" description="An Administrator has not enabled public leave publication." /> : null}
    {kind === "resource" && !loading && !failed && !resourceId ? <EmptyState title={resources.data?.items.length ? "Choose a resource" : "No resources available"} description="Select published equipment or a facility to see available and reserved days." /> : null}
    {!failed && !hidden && days?.length ? <div><div className="mb-2 hidden grid-cols-7 gap-2 text-center text-xs font-semibold text-muted-foreground sm:grid" aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}</div><div className="grid gap-2 sm:grid-cols-7">{Array.from({ length: offset }, (_, i) => <div key={`blank-${i}`} className="hidden sm:block" aria-hidden="true" />)}{days.map((day) => {
      const r = resource.data?.days.find((d) => d.day === day);
      const l = leave.data?.days.find((d) => d.day === day);
      const approved = leave.data?.approved.filter((a) => a.startDate <= day && a.endDate >= day) ?? [];
      const available = kind === "resource" ? r?.status === "available" : l?.shs.status === "available" || l?.jhs.status === "available" || l?.personnel.status === "available";
      return <section key={day} className={`min-w-0 rounded-lg border p-3 sm:min-h-36 ${day === localToday() ? "border-primary ring-1 ring-primary" : "border-border"} ${available ? "bg-card" : "bg-muted/50"}`} aria-label={prettyDay(day)}><h3 className="text-xs font-semibold">{prettyDay(day)}{day === localToday() ? " · Today" : ""}</h3>{kind === "resource" ? <p className={`mt-3 text-xs font-medium capitalize ${available ? "text-primary" : "text-muted-foreground"}`}>{r?.status}</p> : <div className="mt-3 space-y-2 text-xs">{l ? (["shs", "jhs", "personnel"] as const).map((category) => <p key={category}><span className="font-medium capitalize">{categoryLabels[category]}</span><br /><span className="capitalize">{l[category].status}</span>{l[category].status === "available" && l[category].remaining !== null ? ` · ${l[category].remaining} left` : ""}</p>) : null}{approved.map((a, i) => <p className="break-words rounded bg-accent p-1.5 text-accent-foreground" key={`${a.name}-${i}`}>{a.name}<span className="block text-[11px] capitalize">{categoryLabels[a.category]} · Approved</span></p>)}</div>}{available && canRequest && !publicPage ? <a className="mt-3 inline-block text-xs font-medium text-primary underline underline-offset-4" href={`${kind === "leave" ? "/leave" : "/bookings"}?start=${day}&end=${day}${kind === "resource" ? `&resource=${resourceId}` : ""}${selectedPersonId ? `&person=${selectedPersonId}` : ""}#new-booking`}>Request {kind === "leave" ? "leave" : "this day"}<span className="sr-only"> on {day}</span></a> : null}</section>;
    })}</div></div> : null}
  </section>;
}
