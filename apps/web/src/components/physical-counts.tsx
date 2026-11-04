"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import type { NavigationRole } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui-states";
import { client } from "@/utils/orpc";
import { InventoryTerms } from "@/components/workflow-guidance";
import { InventorySections } from "@/components/inventory-sections";
import { inventoryProfileTemplate } from "@matms/api/inventory-profile-templates";

const selectClass = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const get = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const metadataFields = [["entity", "Entity / school"], ["accountableOfficer", "Accountable officer"], ["accountableDesignation", "Accountable officer designation"], ["custodian", "Property Custodian"], ["custodianDesignation", "Property Custodian designation"], ["committeeChair", "Committee chair"], ["committeeChairDesignation", "Committee chair designation"], ["committeeMember", "Committee member"], ["committeeMemberDesignation", "Committee member designation"], ["schoolHead", "School Head"], ["schoolHeadDesignation", "School Head designation"]] as const;

export function PhysicalCountRegister({ role }: { role: NavigationRole }) {
  const manager = role === "admin" || role === "property_custodian";
  const queryClient = useQueryClient();
  const countForm = useRef<HTMLFormElement>(null);
  const [page, setPage] = useState(1);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [countFamily, setCountFamily] = useState<"rpcsp" | "rpcppe">("rpcsp");
  const [profileFamily, setProfileFamily] = useState<"stock_card" | "rpcsp" | "rpcppe">("rpcsp");
  const [profileHash, setProfileHash] = useState("");
  const [profileDefinition, setProfileDefinition] = useState("");
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileOperationId, setProfileOperationId] = useState(() => crypto.randomUUID());
  const counts = useQuery({ queryKey: ["physical-counts", page], queryFn: () => client.physicalCounts.list({ page, pageSize: 25 }), enabled: role !== "viewer" });
  const configuration = useQuery({ queryKey: ["custodial-configuration"], queryFn: () => client.physicalCounts.configuration(), enabled: manager });
  const create = useMutation({ mutationFn: (input: Parameters<typeof client.physicalCounts.create>[0]) => client.physicalCounts.create(input) });
  const createProfile = useMutation({ mutationFn: (input: Parameters<typeof client.physicalCounts.createProfile>[0]) => client.physicalCounts.createProfile(input) });
  async function saveProfile(data: FormData) {
    setProfileFeedback(null);
    try {
      const definition: Parameters<typeof client.physicalCounts.createProfile>[0]["definition"] = JSON.parse(get(data, "definition"));
      const signatories = Object.fromEntries(metadataFields.filter(([name]) => name !== "entity").map(([name]) => [name, get(data, `default-${name}`)]).filter(([, value]) => value));
      if (Object.keys(signatories).length) definition.defaultSignatories = { ...definition.defaultSignatories, ...signatories };
      await createProfile.mutateAsync({ family: get(data, "family") as "stock_card" | "rpcsp" | "rpcppe", effectiveFrom: get(data, "effectiveFrom"), sourceHash: get(data, "sourceHash"), versionNote: get(data, "versionNote"), visualApproval: get(data, "visualApproval"), definition, operationId: profileOperationId });
      setProfileOperationId(crypto.randomUUID()); await queryClient.invalidateQueries({ queryKey: ["custodial-configuration"] }); setProfileFeedback("Form profile version recorded.");
    } catch (error) { setProfileFeedback(error instanceof Error ? error.message : "Form profile could not be saved."); }
  }
  function useProfileSignatories() {
    const form = countForm.current;
    if (!form) return;
    const profileId = String(new FormData(form).get("profile") ?? "");
    const profile = configuration.data?.profiles.find((entry) => entry.id === profileId);
    const definition = profile?.definition as { defaultSignatories?: Record<string, unknown> } | undefined;
    const defaults = definition?.defaultSignatories;
    if (!defaults || !Object.values(defaults).some((value) => typeof value === "string" && value.trim())) { setFeedback("The selected profile has no signatory defaults."); return; }
    for (const [name] of metadataFields) {
      const field = form.elements.namedItem(name);
      const value = defaults[name];
      if (field instanceof HTMLInputElement && typeof value === "string" && value.trim()) field.value = value;
    }
    setOperationId(crypto.randomUUID());
    setFeedback("Profile signatories applied. Review the names before creating the count.");
  }
  async function createCount(data: FormData) {
    setFeedback(null);
    try {
      await create.mutateAsync({ code: get(data, "code"), family: get(data, "family") as "rpcsp" | "rpcppe", profileId: get(data, "profile"), asOfDate: get(data, "asOfDate"), fundCluster: get(data, "fund"), office: get(data, "office") || null, sectionIds: data.getAll("sectionIds").map(String), metadata: { entity: get(data, "entity"), accountableOfficer: get(data, "accountableOfficer"), accountableDesignation: get(data, "accountableDesignation"), accountabilityAssumedDate: get(data, "assumedDate"), custodian: get(data, "custodian"), custodianDesignation: get(data, "custodianDesignation"), committeeChair: get(data, "committeeChair"), committeeChairDesignation: get(data, "committeeChairDesignation"), committeeMember: get(data, "committeeMember"), committeeMemberDesignation: get(data, "committeeMemberDesignation"), schoolHead: get(data, "schoolHead"), schoolHeadDesignation: get(data, "schoolHeadDesignation") }, operationId });
      setOperationId(crypto.randomUUID()); await queryClient.invalidateQueries({ queryKey: ["physical-counts"] }); setFeedback("Count session created.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Count could not be created."); }
  }
  if (role === "viewer") return <section className="p-6"><h1 className="text-2xl font-semibold">Physical counts</h1><p>This workspace is unavailable for your account.</p></section>;
  return <section className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10"><header><a className="text-sm underline" href="/property-inventory">Property inventory</a><h1 className="mt-3 text-2xl font-semibold">Physical counts</h1><p className="text-sm text-muted-foreground">Count observations do not change live stock balances.</p></header>
    <InventoryTerms />
    {role === "admin" && configuration.data ? <InventorySections sections={configuration.data.sections} /> : null}
    {role === "admin" ? <details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Record approved form profile</summary><p className="mt-2 text-sm text-muted-foreground">Record the reviewed layout definition, reference workbook hash and the school approval reference. Optional defaultSignatories can include custodian, custodianDesignation, committeeChair, committeeChairDesignation, committeeMember, committeeMemberDesignation, schoolHead, schoolHeadDesignation, accountableOfficer and accountableDesignation. Each saved version is immutable.</p><form className="mt-4 grid gap-3 md:grid-cols-2" onChange={() => setProfileOperationId(crypto.randomUUID())} onSubmit={(event) => { event.preventDefault(); void saveProfile(new FormData(event.currentTarget)); }}><label>Form family<select name="family" className={selectClass} value={profileFamily} onChange={(event) => { setProfileFamily(event.target.value as typeof profileFamily); setProfileHash(""); setProfileDefinition(""); }}><option value="rpcsp">RPCSP</option><option value="rpcppe">RPCPPE</option><option value="stock_card">Stock card</option></select></label><div><Button type="button" variant="outline" onClick={() => { const template = inventoryProfileTemplate(profileFamily); setProfileHash(template.sourceHash); setProfileDefinition(JSON.stringify(template.definition, null, 2)); setProfileOperationId(crypto.randomUUID()); }}>Load reference starting point</Button><p className="mt-1 text-sm text-muted-foreground">Review the generated layout and obtain school approval before recording it.{profileFamily === "rpcsp" ? " The source caption refers to property, plant and equipment; review the approved wording." : profileFamily === "rpcppe" ? " The source threshold note is a reference convention; confirm the school policy and approved wording." : ""}</p></div><label>Effective date<Input name="effectiveFrom" type="date" required /></label><label>Reference workbook SHA-256<Input name="sourceHash" value={profileHash} onChange={(event) => setProfileHash(event.target.value)} minLength={64} maxLength={64} pattern="[0-9a-f]{64}" required /></label><label>Version note<Input name="versionNote" required /></label><label className="md:col-span-2">School visual approval reference<Input name="visualApproval" required /></label><fieldset className="grid gap-3 md:col-span-2 md:grid-cols-2"><legend className="font-medium">Optional default signatories</legend><p className="text-sm text-muted-foreground md:col-span-2">Names and designations entered here are saved in this profile version.</p>{metadataFields.filter(([name]) => name !== "entity").map(([name, label]) => <label key={name}>Default {label}<Input name={`default-${name}`} maxLength={240} /></label>)}</fieldset><label className="md:col-span-2">Reviewed layout definition (JSON)<textarea className="min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-sm" name="definition" value={profileDefinition} onChange={(event) => setProfileDefinition(event.target.value)} required /></label><div className="md:col-span-2"><Button type="submit" disabled={createProfile.isPending}>Record profile version</Button></div></form><p role="status" aria-live="polite" className="mt-3 text-sm">{profileFeedback}</p></details> : null}
    {manager ? <details className="rounded-lg border bg-card p-5"><summary className="cursor-pointer font-semibold">Create count session</summary><p className="mt-2 text-sm text-muted-foreground">Choose the school-reviewed report layout and counting date, then enter the people who will appear on the printed form. A form profile is the saved layout version. The fund cluster is the funding name or code confirmed by accounting.</p>{configuration.data?.profiles.filter((profile) => profile.family === countFamily).length === 0 ? <p className="mt-2 text-sm">No count form profile is available.</p> : null}<form ref={countForm} className="mt-4 grid gap-3 md:grid-cols-2" onChange={() => setOperationId(crypto.randomUUID())} onSubmit={(event) => { event.preventDefault(); void createCount(new FormData(event.currentTarget)); }}>
      <label>Session code<Input name="code" required /></label><label>Form family<select name="family" className={selectClass} value={countFamily} onChange={(event) => setCountFamily(event.target.value as typeof countFamily)}><option value="rpcsp">Semi-expendable property (RPCSP)</option><option value="rpcppe">Property, plant and equipment (RPCPPE)</option></select></label><label>Form profile<select name="profile" className={selectClass} required><option value="">Select matching profile</option>{configuration.data?.profiles.filter((profile) => profile.family === countFamily).map((profile) => <option key={profile.id} value={profile.id}>{profile.family.toUpperCase()} v{profile.version} · effective {profile.effectiveFrom}</option>)}</select></label><div><Button type="button" variant="outline" onClick={useProfileSignatories}>Apply profile signatories</Button><p className="text-sm text-muted-foreground">Replaces corresponding entered names with saved defaults.</p></div><label>As of<Input name="asOfDate" type="date" required /></label><label>Fund cluster<Input name="fund" required /></label><label>Office / location (optional)<Input name="office" /></label><fieldset className="md:col-span-2"><legend className="font-medium">Report sections</legend><p className="text-sm text-muted-foreground">Leave all unchecked to include every section. Select one or more for a partial count.</p><div className="mt-2 grid gap-2 md:grid-cols-2" key={countFamily}>{configuration.data?.sections.filter((section) => section.formFamily === countFamily && section.active).map((section) => <label className="text-sm" key={section.id}><input type="checkbox" name="sectionIds" value={section.id} /> {section.name} · {section.sheetName}</label>)}</div></fieldset>{metadataFields.map(([name, label]) => <label key={name}>{label}<Input name={name} required maxLength={240} /></label>)}<label>Accountability assumed date<Input name="assumedDate" type="date" required /></label><div className="md:col-span-2"><Button disabled={create.isPending} type="submit">Create count session</Button></div>
    </form><p role="status" aria-live="polite" className="mt-3 text-sm">{feedback}</p></details> : null}
    {counts.isLoading ? <LoadingState label="Loading count sessions" /> : null}{counts.isError ? <ErrorState description="Count sessions are unavailable." onRetry={() => void counts.refetch()} /> : null}{counts.data?.rows.length === 0 ? <EmptyState title="No count sessions" description={manager ? "Create a session to begin a physical count." : "No draft counts are currently assigned to you."} /> : null}
    <ul className="space-y-3">{counts.data?.rows.map((count) => <li key={count.id} className="rounded-lg border bg-card p-4"><a className="font-semibold underline" href={`/property-inventory/counts/${count.id}`}>{count.code}</a><p className="text-sm">{count.family.toUpperCase()} · {count.status} · {count.fundCluster} / {count.office ?? "All offices"} · {count.asOfDate}</p></li>)}</ul><nav aria-label="Count pages" className="flex items-center gap-3"><Button variant="outline" disabled={page === 1 || counts.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!counts.data?.hasNext || counts.isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button></nav>
  </section>;
}
