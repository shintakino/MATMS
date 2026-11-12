"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@matms/api/routers/index";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { Textarea } from "@matms/ui/components/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@matms/ui/components/alert-dialog";
import { client } from "@/utils/orpc";
import { ErrorState, LoadingState } from "@/components/ui-states";

type Details = Parameters<AppRouterClient["inventoryIcs"]["preview"]>[0];
type Preview = Awaited<ReturnType<AppRouterClient["inventoryIcs"]["preview"]>>;
type Saved = Awaited<ReturnType<AppRouterClient["inventoryIcs"]["get"]>>;
type HistoryRow = Awaited<ReturnType<AppRouterClient["inventoryIcs"]["list"]>>["rows"][number];
type Selection = Record<string,{label:string;usefulLife:string;description:string}>;
const fields = [["entity","Entity name"],["fromName","Received from — printed name"],["fromOffice","Received from — position/office"],["fromDate","Received from — date"],["toName","Received by — printed name"],["toOffice","Received by — position/office"],["toDate","Received by — date"]] as const;
type Field = typeof fields[number][0];
const emptyFields = ():Record<Field,string> => ({entity:"",fromName:"",fromOffice:"",fromDate:"",toName:"",toOffice:"",toDate:""});

export function InventoryIcs() {
  const cache=useQueryClient();
  const editor=useRef<HTMLFormElement>(null);
  const [page,setPage]=useState(1),[historyPage,setHistoryPage]=useState(1),[deleted,setDeleted]=useState(false);
  const [selected,setSelected]=useState<Selection>({}),[values,setValues]=useState(emptyFields);
  const [preview,setPreview]=useState<Preview|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [editing,setEditing]=useState<Saved|null>(null),[viewing,setViewing]=useState<Saved|null>(null),[reason,setReason]=useState("");
  const [intent,setIntent]=useState<{details:Details;operationId:string;expectedDataHash:string}|null>(null);
  const [lifecycle,setLifecycle]=useState<{row:HistoryRow;deleted:boolean;reason:string;operationId:string}|null>(null);
  const issues=useQuery({queryKey:["ics-issues",page],queryFn:()=>client.inventoryIcs.issues({page})});
  const number=useQuery({queryKey:["ics-next-number"],queryFn:()=>client.inventoryIcs.nextNumber()});
  const history=useQuery({queryKey:["ics-history",historyPage,deleted],queryFn:()=>client.inventoryIcs.list({page:historyPage,deleted})});
  const invalidate=()=>{setPreview(null);setIntent(null);setMessage("");};
  const reset=()=>{invalidate();setSelected({});setValues(emptyFields());setEditing(null);setReason("");};
  async function refresh(){await Promise.all([cache.invalidateQueries({queryKey:["ics-history"]}),cache.invalidateQueries({queryKey:["ics-next-number"]})]);}
  async function run(action:()=>Promise<void>){setPending(true);setError("");try{await action();}catch(e){setError(e instanceof Error?e.message:"The slip could not be processed. Try again.");}finally{setPending(false);}}
  async function download(id:string,version?:number){
    const file=await client.inventoryIcs.download({id,version});
    const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a=document.createElement("a");a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function openEdit(id:string){
    const saved=await client.inventoryIcs.get({id});
    invalidate();setEditing(saved);setViewing(null);setReason("");
    setValues(Object.fromEntries(fields.map(([name])=>[name,saved.payload.details[name]])) as Record<Field,string>);
    setSelected(Object.fromEntries(saved.payload.lines.map(line=>[line.transactionId,{label:`${line.itemNumber} · ${line.description.slice(0,100)}`,usefulLife:line.usefulLife,description:line.description}])));
    editor.current?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function review(){
    const details:Details={...values,lines:Object.entries(selected).map(([transactionId,line])=>({transactionId,usefulLife:line.usefulLife,description:line.description}))};
    const result=editing?await client.inventoryIcs.previewEdit({id:editing.id,expectedVersion:editing.version,details}):await client.inventoryIcs.preview(details);
    setPreview(result);setIntent({details,expectedDataHash:result.dataHash,operationId:crypto.randomUUID()});
  }
  return <section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby="ics-title">
    <h2 id="ics-title" className="text-xl font-semibold">Appendix 59 — Inventory Custodian Slip</h2>
    <p className="text-sm text-muted-foreground">Choose recorded semi-expendable issues for one fund and receiving office or recipient. Review the slip and export a workbook prepared for long bond paper (8.5 × 13 inches). Long descriptions continue at the same font size.</p>
    <p className="text-sm">To prepare equipment for an ICS, open its inventory item, add a semi-expendable acquisition lot with unit value and inventory item number, then record verified stock and an issue to the recipient.</p>
    {error?<p role="alert" className="text-destructive">{error}</p>:null}
    <p role="status" className="text-sm">{message}</p>
    <form ref={editor} className="scroll-mt-24 space-y-4" onSubmit={event=>{event.preventDefault();void run(review);}}>
      <fieldset disabled={pending} className="space-y-4"><legend className="font-medium">{editing?`Edit ICS ${editing.number}`:"Slip details and issued equipment"}</legend>
      <label className="block space-y-1 text-sm"><span>ICS number</span><Input readOnly value={editing?.number??number.data?.number??"Assigned on save"} aria-describedby="ics-number-help"/></label>
      <p id="ics-number-help" className="text-sm text-muted-foreground">{editing?"The existing ICS number is retained when you save changes.":"Assigned automatically when saved using the current year and month in Manila. The displayed next number is provisional."}</p>
      {number.isError&&!editing?<ErrorState description="The next ICS number could not be loaded." onRetry={()=>void number.refetch()}/>:null}
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(([name,label])=><label key={name} className="space-y-1 text-sm"><span>{label}</span><Input name={name} value={values[name]} onChange={event=>{invalidate();setValues(current=>({...current,[name]:event.target.value}));}} type={name.endsWith("Date")?"date":"text"} maxLength={240} required /></label>)}</div>
      {issues.isLoading?<LoadingState label="Loading recorded issues"/>:null}
      {issues.isError?<ErrorState description="Recorded issues could not be loaded." onRetry={()=>void issues.refetch()}/>:null}
      {issues.data?.rows.length===0?<p>No eligible recorded issues on this page.</p>:null}
      <ul className="space-y-2">{issues.data?.rows.map(row=><li key={row.transactionId} className="rounded border p-3"><label className="flex items-start gap-3"><input type="checkbox" checked={!!selected[row.transactionId]} onChange={event=>{invalidate();setSelected(current=>{const next={...current};if(event.target.checked)next[row.transactionId]={label:`${row.article} · ${row.code} · ${row.date} · ${row.reference}`,usefulLife:"",description:`${row.article}\n${row.description}`};else delete next[row.transactionId];return next;});}}/><span className="min-w-0 break-words">{row.article} · {row.code} · {row.quantity} {row.unit}<span className="block text-sm text-muted-foreground">{row.date} · {row.reference} · {row.fundCluster} · {row.recipient}</span></span></label>{row.unitCost===null||!row.propertyNumber?<p className="text-sm">Complete lot value and inventory item number before generating.</p>:null}</li>)}</ul>
      <nav aria-label="ICS issue pages" className="flex items-center gap-3"><Button type="button" variant="outline" disabled={page===1||issues.isFetching} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page}</span><Button type="button" variant="outline" disabled={!issues.data?.hasNext||issues.isFetching} onClick={()=>setPage(p=>p+1)}>Next</Button></nav>
      <p className="text-sm">{Object.keys(selected).length} issues selected across pages.</p>
      {Object.entries(selected).map(([id,line])=><div key={id} className="space-y-3 rounded border p-3"><p className="break-words text-sm font-medium">{line.label}</p>
        <label className="block space-y-1 text-sm"><span>Description — {line.label}</span><Textarea required maxLength={10000} value={line.description} onChange={event=>{invalidate();setSelected(current=>({...current,[id]:{...line,description:event.target.value}}));}}/></label>
        <label className="block space-y-1 text-sm"><span>Estimated useful life — {line.label}</span><Input required maxLength={240} value={line.usefulLife} placeholder="For example: 5 years" onChange={event=>{invalidate();setSelected(current=>({...current,[id]:{...line,usefulLife:event.target.value}}));}}/></label>
        <Button type="button" variant="outline" onClick={()=>{invalidate();setSelected(current=>{const next={...current};delete next[id];return next;});}}>Remove</Button>
      </div>)}
      {editing?<label className="block space-y-1 text-sm"><span>Reason for changes</span><Input required maxLength={1000} value={reason} onChange={event=>{invalidate();setReason(event.target.value);}}/></label>:null}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!Object.keys(selected).length}>{pending?"Processing…":"Review ICS"}</Button>{editing?<Button type="button" variant="outline" onClick={reset}>Cancel editing</Button>:null}</div>
      </fieldset>
    </form>
    {preview&&intent?<div className="space-y-3"><h3 className="font-semibold">{editing?`Review ICS ${editing.number}`:"Review ICS"}</h3><p>{preview.payload.details.entity} · {preview.payload.fundCluster} · Received by {preview.payload.details.toName} ({preview.payload.details.toOffice})</p><p className="text-sm">Quantities and costs are read-only. Changes to a saved slip retain its previous versions.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Quantity","Unit","Unit cost","Total cost","Description","Inventory item no.","Estimated useful life"].map(label=><th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{preview.payload.lines.map(line=><tr key={line.transactionId}>{[line.quantity,line.unit,line.unitCost,line.totalCost,line.description,line.itemNumber,line.usefulLife].map((value,index)=><td key={index} className="whitespace-pre-wrap p-2">{value}</td>)}</tr>)}</tbody></table></div><Button disabled={pending} onClick={()=>void run(async()=>{
      const result=editing?await client.inventoryIcs.update({...intent,id:editing.id,expectedVersion:editing.version,reason}):await client.inventoryIcs.generate(intent);
      reset();setHistoryPage(1);setDeleted(false);await refresh();setMessage(`ICS ${result.number} saved.`);await download(result.id);
    })}>{editing?"Save changes and export Excel (.xlsx)":"Confirm and export Excel (.xlsx)"}</Button></div>:null}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending} aria-pressed={!deleted} onClick={()=>{setDeleted(false);setHistoryPage(1);}}>Saved slips</Button><Button variant="outline" disabled={pending} aria-pressed={deleted} onClick={()=>{setDeleted(true);setHistoryPage(1);setViewing(null);}}>Deleted slips</Button></div>
    <h3 className="font-semibold">{deleted?"Deleted ICS slips":"Saved ICS slips"}</h3>
    {history.isLoading?<LoadingState label="Loading saved slips"/>:null}
    {history.isError?<ErrorState description="Saved slips could not be loaded." onRetry={()=>void history.refetch()}/>:null}
    {history.data?.rows.length===0?<p className="text-sm">{deleted?"No deleted ICS slips.":"No saved ICS slips."}</p>:null}
    <ul className="space-y-2">{history.data?.rows.map(row=><li key={row.id} className="space-y-3 rounded border p-3"><p className="break-words font-medium">ICS {row.number}</p><p className="text-sm text-muted-foreground">Version {row.contentVersion}</p><div className="flex flex-wrap gap-2">{deleted?<Button disabled={pending} variant="outline" onClick={()=>setLifecycle({row,deleted:false,reason:"",operationId:crypto.randomUUID()})}>Restore</Button>:<>
      <Button disabled={pending} variant="outline" onClick={()=>void run(()=>download(row.id))}>Download Excel</Button>
      <Button disabled={pending} variant="outline" onClick={()=>void run(()=>openEdit(row.id))}>Edit</Button>
      <Button disabled={pending} variant="outline" onClick={()=>void run(async()=>setViewing(await client.inventoryIcs.get({id:row.id})))}>Versions</Button>
      <Button disabled={pending} variant="outline" onClick={()=>setLifecycle({row,deleted:true,reason:"",operationId:crypto.randomUUID()})}>Delete</Button>
    </>}</div></li>)}</ul>
    <nav aria-label="Saved ICS pages" className="flex items-center gap-3"><Button variant="outline" disabled={historyPage===1||pending||history.isFetching} onClick={()=>setHistoryPage(p=>p-1)}>Previous</Button><span>Page {historyPage}</span><Button variant="outline" disabled={!history.data?.hasNext||pending||history.isFetching} onClick={()=>setHistoryPage(p=>p+1)}>Next</Button></nav>
    {viewing?<section className="space-y-3 rounded border p-4" aria-label={`Versions of ICS ${viewing.number}`}><h4 className="font-semibold">Versions of ICS {viewing.number}</h4><ul className="space-y-2">{viewing.history.map(version=><li key={version.version} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">Version {version.version} · {version.reason}</span><Button disabled={pending} variant="outline" onClick={()=>void run(()=>download(viewing.id,version.version))}>Download version {version.version}</Button></li>)}</ul><Button variant="outline" onClick={()=>setViewing(null)}>Close versions</Button></section>:null}
    <AlertDialog open={lifecycle!==null} onOpenChange={open=>{if(!open&&!pending)setLifecycle(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{lifecycle?.deleted?"Delete":"Restore"} ICS {lifecycle?.row.number}?</AlertDialogTitle><AlertDialogDescription>{lifecycle?.deleted?"The slip will move to Deleted slips, where you can restore it later.":"The slip will return to Saved slips with the same ICS number."}</AlertDialogDescription></AlertDialogHeader><label className="space-y-1 text-sm"><span>Reason for {lifecycle?.deleted?"deleting":"restoring"}</span><Input required maxLength={1000} disabled={pending} value={lifecycle?.reason??""} onChange={event=>setLifecycle(current=>current?{...current,reason:event.target.value}:null)}/></label>{error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}<AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending||!lifecycle?.reason.trim()} onClick={event=>{event.preventDefault();if(lifecycle)void run(async()=>{
      await client.inventoryIcs.setDeleted({id:lifecycle.row.id,expectedVersion:lifecycle.row.version,deleted:lifecycle.deleted,reason:lifecycle.reason,operationId:lifecycle.operationId});
      if(editing?.id===lifecycle.row.id)reset();if(viewing?.id===lifecycle.row.id)setViewing(null);setLifecycle(null);await refresh();setMessage(lifecycle.deleted?"ICS moved to Deleted slips.":"ICS restored.");
    });}}>{pending?"Saving…":lifecycle?.deleted?"Delete slip":"Restore slip"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
