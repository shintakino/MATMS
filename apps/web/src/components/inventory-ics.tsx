"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AppRouterClient } from "@matms/api/routers/index";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { client } from "@/utils/orpc";
import { ErrorState, LoadingState } from "@/components/ui-states";

type Details = Parameters<AppRouterClient["inventoryIcs"]["preview"]>[0];
type Preview = Awaited<ReturnType<AppRouterClient["inventoryIcs"]["preview"]>>;
const fields = [["number","ICS number"],["entity","Entity name"],["fromName","Received from — printed name"],["fromOffice","Received from — position/office"],["fromDate","Received from — date"],["toName","Received by — printed name"],["toOffice","Received by — position/office"],["toDate","Received by — date"]] as const;
export function InventoryIcs() {
  const [page,setPage]=useState(1),[historyPage,setHistoryPage]=useState(1);
  const [selected,setSelected]=useState<Record<string,{label:string;usefulLife:string}>>({});
  const [preview,setPreview]=useState<Preview|null>(null),[pending,setPending]=useState(false),[error,setError]=useState("");
  const [intent,setIntent]=useState<{details:Details;operationId:string;expectedDataHash:string}|null>(null);
  const issues=useQuery({queryKey:["ics-issues",page],queryFn:()=>client.inventoryIcs.issues({page})});
  const history=useQuery({queryKey:["ics-history",historyPage],queryFn:()=>client.inventoryIcs.list({page:historyPage})});
  const invalidate=()=>{setPreview(null);setIntent(null);};
  async function run(action:()=>Promise<void>){setPending(true);setError("");try{await action();}catch(e){setError(e instanceof Error?e.message:"The slip could not be processed. Try again.");}finally{setPending(false);}}
  async function download(id:string){const file=await client.inventoryIcs.download({id});const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby="ics-title">
    <h2 id="ics-title" className="text-xl font-semibold">Appendix 59 — Inventory Custodian Slip</h2>
    <p className="text-sm text-muted-foreground">Choose recorded semi-expendable issues for one fund and receiving office or recipient. Quantities and costs come from inventory. Generating a slip saves a snapshot; signatures are completed on the printed form.</p>
    <p className="text-sm">To prepare equipment for an ICS, open its inventory item, add a semi-expendable acquisition lot with unit value and inventory item number, then record verified stock and an issue to the recipient.</p>
    {error?<p role="alert" className="text-destructive">{error}</p>:null}
    <form className="space-y-4" onChange={invalidate} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const details={...Object.fromEntries(fields.map(([name])=>[name,String(form.get(name)??"")])),lines:Object.entries(selected).map(([transactionId,value])=>({transactionId,usefulLife:value.usefulLife}))} as Details;void run(async()=>{const result=await client.inventoryIcs.preview(details);setPreview(result);setIntent({details,expectedDataHash:result.dataHash,operationId:crypto.randomUUID()});});}}>
      <fieldset disabled={pending} className="space-y-4"><legend className="font-medium">Slip details and issued equipment</legend>
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(([name,label])=><label key={name} className="space-y-1 text-sm"><span>{label}</span><Input name={name} type={name.endsWith("Date")?"date":"text"} maxLength={240} required /></label>)}</div>
      {issues.isLoading?<LoadingState label="Loading recorded issues"/>:null}
      {issues.isError?<ErrorState description="Recorded issues could not be loaded." onRetry={()=>void issues.refetch()}/>:null}
      {issues.data?.rows.length===0?<p>No eligible recorded issues on this page.</p>:null}
      <ul className="space-y-2">{issues.data?.rows.map(row=><li key={row.transactionId} className="rounded border p-3"><label className="flex items-start gap-3"><input type="checkbox" checked={!!selected[row.transactionId]} onChange={e=>{invalidate();setSelected(current=>{const next={...current};if(e.target.checked)next[row.transactionId]={label:`${row.article} · ${row.code} · ${row.date} · ${row.reference}`,usefulLife:""};else delete next[row.transactionId];return next;});}}/><span>{row.article} · {row.code} · {row.quantity} {row.unit}<span className="block text-sm text-muted-foreground">{row.date} · {row.reference} · {row.fundCluster} · {row.recipient}</span></span></label>{row.unitCost===null||!row.propertyNumber?<p className="text-sm">Complete lot value and inventory item number before generating.</p>:null}</li>)}</ul>
      <nav aria-label="ICS issue pages" className="flex items-center gap-3"><Button type="button" variant="outline" disabled={page===1||issues.isFetching} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page}</span><Button type="button" variant="outline" disabled={!issues.data?.hasNext||issues.isFetching} onClick={()=>setPage(p=>p+1)}>Next</Button></nav>
      <p className="text-sm">{Object.keys(selected).length} issues selected across pages.</p>
      {Object.entries(selected).map(([id,row])=><label key={id} className="block space-y-1 text-sm"><span>Estimated useful life — {row.label}</span><div className="flex gap-2"><Input required maxLength={240} value={row.usefulLife} placeholder="For example: 5 years" onChange={e=>{invalidate();setSelected(current=>({...current,[id]:{...row,usefulLife:e.target.value}}));}}/><Button type="button" variant="outline" onClick={()=>{invalidate();setSelected(current=>{const next={...current};delete next[id];return next;});}}>Remove</Button></div></label>)}
      <Button type="submit" disabled={!Object.keys(selected).length}>{pending?"Processing…":"Review ICS"}</Button></fieldset>
    </form>
    {preview&&intent?<div className="space-y-3"><h3 className="font-semibold">Review ICS {preview.payload.details.number}</h3><p>{preview.payload.details.entity} · {preview.payload.fundCluster} · Received by {preview.payload.details.toName} ({preview.payload.details.toOffice})</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Quantity","Unit","Unit cost","Total cost","Description","Inventory item no.","Estimated useful life"].map(label=><th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{preview.payload.lines.map(row=><tr key={row.transactionId}>{[row.quantity,row.unit,row.unitCost,row.totalCost,row.description,row.itemNumber,row.usefulLife].map((value,i)=><td key={i} className="p-2">{value}</td>)}</tr>)}</tbody></table></div><Button disabled={pending} onClick={()=>void run(async()=>{const result=await client.inventoryIcs.generate(intent);await history.refetch();setPreview(null);setIntent(null);await download(result.id);})}>Confirm and export Excel (.xlsx)</Button></div>:null}
    <h3 className="font-semibold">Saved ICS slips</h3>
    {history.isLoading?<LoadingState label="Loading saved slips"/>:null}
    {history.isError?<ErrorState description="Saved slips could not be loaded." onRetry={()=>void history.refetch()}/>:null}
    {history.data?.rows.length===0?<p className="text-sm">No saved ICS slips.</p>:null}
    <ul className="space-y-2">{history.data?.rows.map(row=><li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><span>ICS {row.number}</span><Button disabled={pending} variant="outline" onClick={()=>void run(()=>download(row.id))}>Download Excel</Button></li>)}</ul>
    <nav aria-label="Saved ICS pages" className="flex items-center gap-3"><Button variant="outline" disabled={historyPage===1||pending||history.isFetching} onClick={()=>setHistoryPage(p=>p-1)}>Previous</Button><span>Page {historyPage}</span><Button variant="outline" disabled={!history.data?.hasNext||pending||history.isFetching} onClick={()=>setHistoryPage(p=>p+1)}>Next</Button></nav>
  </section>;
}
