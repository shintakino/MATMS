"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import type { NavigationRole } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { InventoryIcs } from "@/components/inventory-ics";
import { client } from "@/utils/orpc";

export function InventoryReports({ role }: { role: NavigationRole }) {
  const manager = role === "admin" || role === "property_custodian";
  const [page, setPage] = useState(1);
  const reports = useQuery({ queryKey: ["inventory-reports", page], queryFn: () => client.inventoryReports.list({ page, pageSize: 25 }), enabled: manager });
  if (!manager) return <section className="p-6"><h1 className="text-2xl font-semibold">Inventory report history</h1><p>This workspace is unavailable for your account.</p></section>;
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header><a className="text-sm underline" href="/property-inventory">Property inventory</a><h1 className="mt-3 text-2xl font-semibold">Inventory report history</h1><p className="text-sm text-muted-foreground">Saved report snapshots remain unchanged. Expired workbooks are regenerated from the saved snapshot.</p></header><InventoryIcs />{reports.isLoading ? <LoadingState label="Loading report history" /> : null}{reports.isError ? <ErrorState description="Report history is unavailable." onRetry={() => void reports.refetch()} /> : null}{reports.data?.rows.length === 0 ? <EmptyState title="No generated reports" description="Generate a workbook from a finalized count or Stock Card." /> : null}<ul className="space-y-3">{reports.data?.rows.map((entry) => <li key={entry.id} className="rounded-lg border bg-card p-4"><h2 className="font-semibold">{entry.filename}</h2><p className="text-sm">{entry.family.toUpperCase()} · {entry.fundCluster} / {entry.office ?? "All offices"} · {entry.asOfDate} · {entry.rowCount} rows</p><p className="break-all text-xs text-muted-foreground">Snapshot {entry.dataHash} · Original workbook {entry.checksum}</p><div className="mt-2 flex gap-4 text-sm"><a className="underline" href={`/property-inventory/reports/${entry.id}`}>Preview / print</a><a className="underline" href={`/api/inventory-reports/${entry.id}/download`}>Download Excel</a></div></li>)}</ul><nav aria-label="Report pages" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || reports.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!reports.data?.hasNext || reports.isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button></nav></section>;
}
