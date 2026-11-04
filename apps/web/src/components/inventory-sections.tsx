"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { client } from "@/utils/orpc";

type Section = Awaited<ReturnType<typeof client.physicalCounts.configuration>>["sections"][number];
type Update = Parameters<typeof client.physicalCounts.updateSection>[0];
const sheets = { rpcsp: ["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"], rpcppe: ["RPCPPE_LAND", "RPCPPE_BLDG", "RPCPPE_OTHERBLDG"] } as const;
const selectClass = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const get = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

export function InventorySections({ sections }: { sections: Section[] }) {
  const queryClient = useQueryClient();
  const [family, setFamily] = useState<"rpcsp" | "rpcppe">("rpcsp");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [feedback, setFeedback] = useState<string | null>(null);
  const create = useMutation({ mutationFn: (input: Parameters<typeof client.physicalCounts.createSection>[0]) => client.physicalCounts.createSection(input) });
  async function submit(data: FormData) {
    setFeedback(null);
    try { await create.mutateAsync({ code: get(data, "code"), family, name: get(data, "name"), sheetName: get(data, "sheet"), displayOrder: Number(get(data, "order")), active: true, effectiveFrom: get(data, "from") || null, effectiveUntil: get(data, "until") || null, reason: get(data, "reason"), operationId }); setOperationId(crypto.randomUUID()); await queryClient.invalidateQueries({ queryKey: ["custodial-configuration"] }); setFeedback("Section created."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Section could not be created."); }
  }
  return <details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Manage report sections</summary><p className="mt-2 text-sm text-muted-foreground">Section changes require affected draft counts to be refreshed and reviewed. Finalized reports keep their frozen section data.</p><form className="mt-4 grid gap-3 md:grid-cols-3" onChange={() => setOperationId(crypto.randomUUID())} onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}><label>Section code<Input name="code" required maxLength={64} /></label><label>Form family<select className={selectClass} value={family} onChange={(event) => setFamily(event.target.value as typeof family)}><option value="rpcsp">RPCSP</option><option value="rpcppe">RPCPPE</option></select></label><label>Sheet<select key={family} className={selectClass} name="sheet">{sheets[family].map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Display label<Input name="name" required maxLength={240} /></label><label>Display order<Input name="order" type="number" min={0} step={1} required /></label><label>Effective from<Input name="from" type="date" /></label><label>Effective until<Input name="until" type="date" /></label><label>Reason<Input name="reason" required /></label><div><Button disabled={create.isPending} type="submit">Create section</Button></div></form><p role="status" aria-live="polite" className="mt-3 text-sm">{feedback}</p><ul className="mt-4 divide-y">{sections.map((section) => <li className="py-2" key={section.id}><SectionEditor section={section} /></li>)}</ul></details>;
}

function SectionEditor({ section }: { section: Section }) {
  const queryClient = useQueryClient();
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [review, setReview] = useState<Update | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const update = useMutation({ mutationFn: (input: Update) => client.physicalCounts.updateSection(input) });
  const family = section.formFamily === "rpcppe" ? "rpcppe" : "rpcsp";
  async function confirm() {
    if (!review) return;
    try { await update.mutateAsync(review); setReview(null); setOperationId(crypto.randomUUID()); await queryClient.invalidateQueries({ queryKey: ["custodial-configuration"] }); setFeedback("Section updated."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Section could not be saved."); }
  }
  return <details><summary className="cursor-pointer text-sm">{section.code} · {section.name} · {section.active ? "Active" : "Inactive"}</summary><form key={section.version} className="mt-3 grid gap-3 md:grid-cols-3" onChange={() => { setOperationId(crypto.randomUUID()); setReview(null); }} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setFeedback(null); setReview({ sectionId: section.id, expectedVersion: section.version, name: get(data, "name"), sheetName: get(data, "sheet"), displayOrder: Number(get(data, "order")), active: data.get("active") === "on", effectiveFrom: get(data, "from") || null, effectiveUntil: get(data, "until") || null, reason: get(data, "reason"), operationId }); }}><label>Display label<Input name="name" defaultValue={section.name} required /></label><label>Sheet<select className={selectClass} name="sheet" defaultValue={section.sheetName ?? ""} required><option value="">Select sheet</option>{sheets[family].map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Display order<Input name="order" type="number" min={0} defaultValue={section.displayOrder} required /></label><label>Effective from<Input name="from" type="date" defaultValue={section.effectiveFrom ?? ""} /></label><label>Effective until<Input name="until" type="date" defaultValue={section.effectiveUntil ?? ""} /></label><label>Reason<Input name="reason" required /></label><label className="text-sm"><input type="checkbox" name="active" defaultChecked={section.active} /> Active section</label><div><Button type="submit" variant="outline" disabled={update.isPending}>Review section change</Button></div></form><p role="status" aria-live="polite">{review ? "" : feedback}</p><AlertDialog open={review !== null} onOpenChange={(open) => { if (!open && !update.isPending) setReview(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm section change?</AlertDialogTitle><AlertDialogDescription>Affected drafts will require source refresh and review. Finalized snapshots remain unchanged.</AlertDialogDescription></AlertDialogHeader>{feedback ? <p role="alert" className="text-sm text-destructive">{feedback}</p> : null}<AlertDialogFooter><AlertDialogCancel disabled={update.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={update.isPending} onClick={(event) => { event.preventDefault(); void confirm(); }}>Confirm section change</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></details>;
}
