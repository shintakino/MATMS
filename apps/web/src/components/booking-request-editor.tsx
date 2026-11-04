"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Label } from "@matms/ui/components/label";
import { client } from "@/utils/orpc";
import { localToday } from "@/components/booking-calendar";
import { ResourcePicker, useScheduleAction, value } from "@/components/booking-controls";

type RequestRow = Awaited<ReturnType<typeof client.scheduling.requests>>["items"][number];
type ProposedEdit = { startDate: string; endDate: string; detail: string; resourceId: string | null; resourceName: string | null; changeReason: string };

export function BookingRequestEditor({ row, kind }: { row: RequestRow; kind: "leave" | "resource" }) {
  const [open, setOpen] = useState(false);
  const [resourceId, setResourceId] = useState(row.resourceId ?? "");
  const [resourceName, setResourceName] = useState(row.resourceName);
  const [review, setReview] = useState<ProposedEdit | null>(null);
  const operation = useRef<{ intent: string; id: string } | null>(null);
  const { busy, run, feedback } = useScheduleAction();
  const baseId = useId();
  const messageId = `${baseId}-help`;

  async function save() {
    if (!review) return;
    const intent = JSON.stringify(review);
    if (operation.current?.intent !== intent) operation.current = { intent, id: crypto.randomUUID() };
    const common = { id: row.id, expectedVersion: row.version, operationId: operation.current.id, startDate: review.startDate, endDate: review.endDate, changeReason: review.changeReason };
    const saved = await run(() => kind === "leave"
      ? client.scheduling.editLeave({ ...common, reason: review.detail })
      : client.scheduling.editReservation({ ...common, resourceId: review.resourceId!, purpose: review.detail }), "Request updated and awaiting approval again.");
    if (saved) { setReview(null); setOpen(false); operation.current = null; }
  }

  return <div className="mt-4">
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={`${baseId}-editor`} disabled={busy} onClick={() => { setOpen(!open); setReview(null); }}> {open ? "Close editor" : "Edit request"}</Button>
    {open ? <div id={`${baseId}-editor`} className="mt-3 rounded-lg border bg-muted/30 p-4">
      <h4 className="text-sm font-semibold">Edit {kind === "leave" ? "leave request" : "reservation"}</h4>
      <p id={messageId} className="mt-2 text-sm text-muted-foreground">All dates are included. Current availability and eligibility will be checked again. Saving returns the request to Pending; approved leave names disappear from the public calendar until approved again. Cancel the request to release all dates.</p>
      <form className="mt-4 grid gap-4 md:grid-cols-2" aria-describedby={messageId} onChange={() => setReview(null)} onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setReview({ startDate: value(form, "startDate"), endDate: value(form, "endDate"), detail: value(form, "detail"), resourceId: kind === "resource" ? resourceId : null, resourceName, changeReason: value(form, "changeReason") });
      }}>
        <div className="space-y-2"><Label htmlFor={`${baseId}-start`}>New start date</Label><Input id={`${baseId}-start`} name="startDate" type="date" defaultValue={row.startDate} min={localToday()} required disabled={busy} /></div>
        <div className="space-y-2"><Label htmlFor={`${baseId}-end`}>New end date (inclusive)</Label><Input id={`${baseId}-end`} name="endDate" type="date" defaultValue={row.endDate} min={localToday()} required disabled={busy} /></div>
        {kind === "resource" ? <ResourcePicker selected={resourceId} onSelect={(id, name) => { setResourceId(id); setResourceName(name ?? "Selected resource"); setReview(null); }} idPrefix={`edit-${row.id}`} disabled={busy} /> : null}
        <div className="space-y-2 md:col-span-2"><Label htmlFor={`${baseId}-detail`}>{kind === "leave" ? "Updated leave reason (private)" : "Updated purpose (private)"}</Label><textarea id={`${baseId}-detail`} name="detail" className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm" defaultValue={row.detail} maxLength={2000} required disabled={busy} /></div>
        <div className="space-y-2 md:col-span-2"><Label htmlFor={`${baseId}-reason`}>Reason for this change</Label><Input id={`${baseId}-reason`} name="changeReason" maxLength={1000} required disabled={busy} /></div>
        <div><Button type="submit" disabled={busy || (kind === "resource" && !resourceId)}>Review changes</Button></div>
      </form>
      {review ? <section className="mt-4 rounded-lg border bg-card p-4" aria-label="Review request changes"><h5 className="text-sm font-semibold">Confirm updated request</h5><dl className="mt-3 grid gap-2 text-sm"><div><dt className="font-medium">Current dates</dt><dd>{row.startDate} → {row.endDate}</dd></div><div><dt className="font-medium">New dates</dt><dd>{review.startDate} → {review.endDate}</dd></div><div><dt className="font-medium">Private reason / purpose</dt><dd className="whitespace-pre-wrap break-words">{review.detail}</dd></div>{kind === "resource" ? <div><dt className="font-medium">Resource</dt><dd>{review.resourceName}</dd></div> : null}<div><dt className="font-medium">Change reason</dt><dd className="break-words">{review.changeReason}</dd></div></dl><p className="mt-3 text-sm text-muted-foreground">This request will require approval again. If dates conflict, the original request and its dates stay saved.</p><div className="mt-4 flex gap-3"><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Confirm update"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setReview(null)}>Go back</Button></div></section> : null}
      {feedback}
    </div> : null}
  </div>;
}
