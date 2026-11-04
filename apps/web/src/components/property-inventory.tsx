"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import type { NavigationRole } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { InventoryTerms } from "@/components/workflow-guidance";
import { client } from "@/utils/orpc";

type Filters = NonNullable<Parameters<typeof client.custodialInventory.listItems>[0]["filters"]>;
const selectClass = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const conditions = ["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"] as const;
const message = (error: unknown) => error instanceof Error ? error.message : "The operation could not be completed.";
const field = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

export function PropertyInventoryRegister({ role }: { role: NavigationRole }) {
  const manager = role === "admin" || role === "property_custodian";
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [createdItemId, setCreatedItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const inventory = useQuery({ queryKey: ["custodial-items", filters, page], queryFn: () => client.custodialInventory.listItems({ filters, page, pageSize: 25 }) });
  const configuration = useQuery({ queryKey: ["custodial-configuration"], queryFn: () => client.physicalCounts.configuration(), enabled: manager });
  const create = useMutation({ mutationFn: (input: Parameters<typeof client.custodialInventory.createItem>[0]) => client.custodialInventory.createItem(input) });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters({ reorder: params.get("reorder") === "yes" ? true : undefined, outOfStock: params.get("out") === "yes" ? true : undefined, conditionReview: params.get("conditionReview") === "yes" ? true : undefined, active: params.get("active") === "yes" ? true : undefined });
  }, []);

  function applyFilters(data: FormData) {
    const reportingClass = field(data, "class");
    const reorder = field(data, "reorder");
    const quality = field(data, "quality");
    const active = field(data, "active");
    setFilters({ query: field(data, "query") || undefined, reportingClass: reportingClass ? reportingClass as Filters["reportingClass"] : undefined, fundCluster: field(data, "fund") || undefined, office: field(data, "office") || undefined, condition: field(data, "condition") || undefined, acquisitionYear: field(data, "year") || undefined, reorder: reorder ? reorder === "yes" : undefined, outOfStock: field(data, "out") ? field(data, "out") === "yes" : undefined, conditionReview: field(data, "conditionReview") ? field(data, "conditionReview") === "yes" : undefined, dataQuality: quality ? quality === "yes" : undefined, active: active ? active === "yes" : undefined, sectionId: field(data, "section") || undefined });
    setPage(1);
  }
  async function createItem(data: FormData) {
    setFeedback(null); setCreatedItemId(null);
    try {
      const threshold = field(data, "reorderPoint");
      const saved = await create.mutateAsync({ code: field(data, "code"), article: field(data, "article"), description: field(data, "description"), unit: field(data, "unit"), reorderPoint: threshold === "" ? null : Number(threshold), defaultSectionId: field(data, "defaultSection") || null, operationId });
      setCreatedItemId(saved.id);
      setOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["custodial-items"] });
      setFeedback("Item created. Open it to add a lot or office balance.");
    } catch (error) { setFeedback(message(error)); }
  }

  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10">
    <header><h1 className="text-2xl font-semibold">Property inventory</h1><p className="text-sm text-muted-foreground">Supplies and property balances are tracked by fund and office.</p><nav className="mt-2 flex flex-wrap gap-4 text-sm">{role !== "viewer" ? <a className="underline" href="/property-inventory/counts">Physical counts</a> : null}{manager ? <><a className="underline" href="/property-inventory/imports">Controlled imports</a><a className="underline" href="/property-inventory/reports">Report history</a></> : null}</nav></header>
    <InventoryTerms />
    {manager ? <details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Create item</summary><p className="mt-2 text-sm text-muted-foreground">Start with the item name and unit. After saving, open the item to add acquisition details, choose an office and record verified stock.</p><form className="mt-4 grid gap-3 md:grid-cols-2" onChange={() => setOperationId(crypto.randomUUID())} onSubmit={(event) => { event.preventDefault(); void createItem(new FormData(event.currentTarget)); }}>
      <label>Item / stock code<Input name="code" maxLength={1000} required /></label><label>Article<Input name="article" maxLength={1000} required /></label>
      <label className="md:col-span-2">Description<Input name="description" maxLength={1000} required /></label><label>Unit of measure<Input name="unit" maxLength={1000} required /></label>
      <details className="rounded-md border p-3 md:col-span-2"><summary className="cursor-pointer text-sm font-medium">Optional stock and report settings</summary><p className="mt-2 text-xs text-muted-foreground">A reorder point flags low stock. A report section decides where eligible property appears in a count.</p><div className="mt-3 grid gap-3 md:grid-cols-2">      <label>Reorder point (optional)<Input name="reorderPoint" type="number" min={0} max={2147483647} step={1} /></label>
      <label>Default report section<select name="defaultSection" className={selectClass}><option value="">No section selected</option>{configuration.data?.sections.filter((section) => section.active).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
</div></details>
      <div className="md:col-span-2"><Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create item"}</Button></div>
    </form><p role="status" aria-live="polite" className="mt-3 text-sm">{feedback}</p>{createdItemId ? <a className="mt-3 inline-block text-sm font-medium text-primary underline" href={`/property-inventory/items/${createdItemId}`}>Continue item setup →</a> : null}</details> : null}
    <details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Search and filters</summary><form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); applyFilters(new FormData(event.currentTarget)); }}>
      <label>Search<Input name="query" maxLength={200} /></label><label>Class<select className={selectClass} name="class"><option value="">All classes</option><option value="stock_card">Stock card</option><option value="semi_expendable">Semi-expendable</option><option value="ppe">PPE</option></select></label>
      <label>Fund cluster<Input name="fund" /></label><label>Office / location<Input name="office" /></label>
      <label>Condition<select className={selectClass} name="condition"><option value="">Any condition</option>{conditions.map((condition) => <option key={condition} value={condition}>{condition.replaceAll("_", " ")}</option>)}</select></label>
      <label>Acquisition year<Input name="year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} /></label><label>Reorder status<select className={selectClass} name="reorder"><option value="">Any status</option><option value="yes">At or below reorder point</option><option value="no">Above reorder point</option></select></label>
      <label>Stock status<select className={selectClass} name="out"><option value="">Any balance</option><option value="yes">Out of stock</option><option value="no">In stock</option></select></label><label>Condition review<select className={selectClass} name="conditionReview"><option value="">All conditions</option><option value="yes">Needs review</option><option value="no">No condition review</option></select></label>
      <label>Data quality<select className={selectClass} name="quality"><option value="">All records</option><option value="yes">Needs review</option><option value="no">No flagged issues</option></select></label><label>Item status<select className={selectClass} name="active"><option value="">All statuses</option><option value="yes">Active</option><option value="no">Inactive</option></select></label>
      {manager ? <label>Section<select className={selectClass} name="section"><option value="">All sections</option>{configuration.data?.sections.filter((section) => section.active).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label> : null}
      <div className="md:col-span-3"><Button type="submit">Apply filters</Button></div>
    </form></details>
    {Object.values(filters).some((value) => value !== undefined && value !== "") ? <div className="flex flex-wrap items-center gap-3 text-sm"><span>Filters applied: {Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</span><Button variant="outline" size="sm" onClick={() => { setFilters({}); setPage(1); window.history.replaceState(null, "", "/property-inventory"); }}>Clear filters</Button></div> : null}
    {inventory.isLoading ? <LoadingState label="Loading property inventory" /> : null}
    {inventory.isError ? <ErrorState description="Property inventory is unavailable." onRetry={() => void inventory.refetch()} /> : null}
    {inventory.data?.rows.length === 0 ? <EmptyState title="No matching items" description="Change the filters or create an item if you manage inventory." /> : null}
    <div className="space-y-3">{inventory.data?.rows.map(({ item, lots, balances }) => <article key={item.id} className="rounded-lg border bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-mono text-xs text-muted-foreground">{item.code}</p><h2 className="font-semibold"><a className="underline underline-offset-4" href={`/property-inventory/items/${item.id}`}>{item.article}</a></h2><p className="text-sm">{item.description}</p></div><span className="text-sm">{item.active ? "Active" : "Inactive"} · {lots.length} matching lots</span></div>{balances.length ? <ul className="mt-3 divide-y text-sm">{balances.map((balance) => <li key={balance.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{balance.fundCluster} / {balance.office}</span><span className="tabular-nums">{balance.quantity} {item.unit} · {balance.quantity === 0 ? "Out of stock" : balance.reorder ? "Reorder" : item.reorderPoint === null ? "No reorder point" : "In stock"}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No matching office balance.</p>}</article>)}</div>
    <nav aria-label="Inventory pages" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || inventory.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!inventory.data?.hasNext || inventory.isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button></nav>
  </section>;
}
