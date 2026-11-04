"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { orpc } from "@/utils/orpc";

function location(value: unknown) {
  if (!value || typeof value !== "object") return "Not recorded";
  const snapshot = value as Record<string, unknown>;
  return String(snapshot.label ?? snapshot.location ?? "Location recorded");
}

export function ArchiveHistory({ kind, id }: { kind: "box" | "folder" | "document"; id: string }) {
  const [page, setPage] = useState(1);
  const history = useQuery(orpc.archive.history.queryOptions({ input: { kind, id, page } }));
  return <section className="mx-auto w-full max-w-5xl space-y-3 px-6 pb-8"><h2 className="font-semibold">Movement history</h2>{history.isLoading ? <p>Loading history…</p> : history.isError ? <p role="alert">History unavailable. <Button variant="outline" onClick={() => void history.refetch()}>Retry</Button></p> : history.data?.items.length === 0 ? <p>No movements recorded for this {kind}.</p> : <ul className="divide-y rounded-lg border px-4">{history.data?.items.map((event) => <li key={event.id} className="space-y-1 py-3 text-sm"><p>{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))} · {event.actorName}</p><p>{event.reason}</p><p>From: {location(event.source)}</p><p>To: {location(event.destination)}</p></li>)}</ul>}<div className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || history.isFetching} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!history.data?.hasMore || history.isFetching} onClick={() => setPage(page + 1)}>Next</Button></div></section>;
}
