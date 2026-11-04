"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { ErrorState, LoadingState } from "@/components/ui-states";
import type { NavigationRole } from "@/components/app-shell";
import { client } from "@/utils/orpc";

export function PropertyStockCard({ itemId, role }: { itemId: string; role: NavigationRole }) {
  const [scope, setScope] = useState<{ fundCluster: string; office?: string; asOfDate: string } | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ id: string; filename: string } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [review, setReview] = useState<{ input: Parameters<typeof client.inventoryReports.previewStock>[0]; data: Awaited<ReturnType<typeof client.inventoryReports.previewStock>> } | null>(null);
  const manager = role === "admin" || role === "property_custodian";
  const card = useQuery({ queryKey: ["custodial-stock-card", itemId, scope], queryFn: () => client.custodialInventory.stockCard({ itemId, ...scope! }), enabled: scope !== null });
  const config = useQuery({ queryKey: ["custodial-configuration"], queryFn: () => client.physicalCounts.configuration(), enabled: manager });
  async function reviewExport(data: FormData) {
    if (!scope || !card.data) return;
    setPending(true); setFeedback(null);
    const input = { itemId, profileId: String(data.get("profile") ?? ""), entity: String(data.get("entity") ?? "").trim(), ...scope };
    try { setReview({ input, data: await client.inventoryReports.previewStock(input) }); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Report preview is unavailable."); }
    finally { setPending(false); }
  }
  async function generate() {
    if (!review) return;
    setPending(true); setFeedback(null);
    try { const exported = await client.inventoryReports.generate({ kind: "stock_card", ...review.input, expectedDataHash: review.data.dataHash, operationId }); setResult(exported); setOperationId(crypto.randomUUID()); setReview(null); setFeedback("Workbook generated and saved to report history."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Workbook could not be generated."); }
    finally { setPending(false); }
  }
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header><a href={`/property-inventory/items/${itemId}`} className="text-sm underline">Back to item</a><h1 className="mt-3 text-2xl font-semibold">Stock card</h1><p className="text-sm text-muted-foreground">Choose a fund and date. Leaving the office blank shows the combined school balance.</p></header>
    <form className="grid gap-3 rounded-lg border bg-card p-5 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setResult(null); setReview(null); setFeedback(null); setOperationId(crypto.randomUUID()); setScope({ fundCluster: String(data.get("fund") ?? "").trim(), office: String(data.get("office") ?? "").trim() || undefined, asOfDate: String(data.get("date") ?? "") }); }}><label>Fund cluster<Input name="fund" required /></label><label>Office / location (optional)<Input name="office" /></label><label>As of<Input name="date" type="date" required /></label><div className="md:col-span-3"><Button type="submit">Show stock card</Button></div></form>
    {card.isLoading && scope ? <LoadingState label="Loading stock card" /> : null}{card.isError ? <ErrorState description="The stock card is unavailable." onRetry={() => void card.refetch()} /> : null}
    {card.data ? <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">{card.data.item.article} · {card.data.item.code}</h2><p className="text-sm">{card.data.fundCluster} / {card.data.office ?? "All offices"} · As of {card.data.asOfDate} · Balance {card.data.balance} {card.data.item.unit}</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[50rem] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Date</th><th className="p-2">Reference</th><th className="p-2">Action</th><th className="p-2">Source / office</th><th className="p-2">Receipt</th><th className="p-2">Issue</th><th className="p-2">Balance</th><th className="p-2">Days to consume</th></tr></thead><tbody>{card.data.entries.map((entry) => <tr className="border-b" key={entry.id}><td className="p-2">{entry.effectiveDate}</td><td className="p-2">{entry.reference}</td><td className="p-2">{entry.type}</td><td className="p-2">{entry.office}</td><td className="p-2">{entry.delta > 0 ? entry.delta : ""}</td><td className="p-2">{entry.delta < 0 ? -entry.delta : ""}</td><td className="p-2">{entry.balanceAfter}</td><td className="p-2">{entry.daysToConsume ?? ""}</td></tr>)}</tbody></table>{card.data.entries.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No transactions in this scope.</p> : null}</div>{manager ? <form className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2" onChange={() => { setOperationId(crypto.randomUUID()); setResult(null); setReview(null); }} onSubmit={(event) => { event.preventDefault(); void reviewExport(new FormData(event.currentTarget)); }}><label>Entity / school<Input name="entity" required maxLength={240} /></label><label>Stock Card profile<select className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm" name="profile" required><option value="">Select profile</option>{config.data?.profiles.filter((profile) => profile.family === "stock_card" && profile.effectiveFrom <= card.data.asOfDate).map((profile) => <option key={profile.id} value={profile.id}>v{profile.version} · {profile.effectiveFrom}</option>)}</select></label><div className="md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Working…" : "Review report scope"}</Button></div>{review ? <div className="md:col-span-2 space-y-2 text-sm"><p>Reviewed scope: {review.data.card.fundCluster} / {review.data.card.office ?? "All offices"} · {review.data.card.asOfDate} · {review.data.card.entries.length} entries · Balance {review.data.card.balance}</p><p className="break-all">Snapshot SHA-256 {review.data.dataHash}</p><details><summary className="cursor-pointer underline">Review snapshot entries</summary><ul className="max-h-64 overflow-auto">{review.data.card.entries.map((entry) => <li key={entry.id}>{entry.effectiveDate} · {entry.reference} · {entry.office} · Change {entry.delta} · Balance {entry.balanceAfter}</li>)}</ul></details><Button type="button" disabled={pending} onClick={() => void generate()}>Generate Excel workbook</Button></div> : null}<p role="status" aria-live="polite" className="md:col-span-2 text-sm">{feedback}</p>{result ? <p className="md:col-span-2 text-sm"><a className="underline" href={`/api/inventory-reports/${result.id}/download`}>Download {result.filename}</a> · <a className="underline" href={`/property-inventory/reports/${result.id}`}>Preview and print</a></p> : null}</form> : null}</section> : null}
  </section>;
}
