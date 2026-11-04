"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@matms/ui/components/button";
import { Input } from "@matms/ui/components/input";
import { client } from "@/utils/orpc";
import { ORPCError } from "@orpc/client";

export function StockLineControls({ id, threshold, role, superseded }: { id: string; threshold: number; role: "admin" | "property_custodian" | "staff"; superseded: boolean }) {
  const cache = useQueryClient();
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("");
  const [nextThreshold, setThreshold] = useState(threshold);
  const [message, setMessage] = useState("");
  const [intent, setIntent] = useState<{ kind: "receive" | "issue"; operationId: string; reason: string; decision: string } | null>(null);
  const operation = useMutation({ mutationFn: async (kind: "receive" | "issue" | "threshold") => {
    if (kind === "threshold") { await client.inventory.inventory.updateThreshold({ inventoryId: id, threshold: nextThreshold }); return; }
    const current = intent ?? { kind, operationId: crypto.randomUUID(), reason, decision };
    if (current.kind !== kind || current.reason !== reason || current.decision !== decision) throw new Error("Retry the pending operation with its original action and details first.");
    setIntent(current);
    const input = { inventoryId: id, quantity: 1, reason, operationId: current.operationId };
    if (kind === "receive") await client.inventory.inventory.receive(input);
    else await client.inventory.inventory.issue({ ...input, supersededDecision: decision || null });
    setIntent(null);
  } });
  async function run(kind: "receive" | "issue" | "threshold") {
    try { await operation.mutateAsync(kind); setMessage("Saved."); }
    catch (error) {
      // A definitive business rejection did not commit. Transport failures
      // retain the intent so an ambiguous retry cannot duplicate a write.
      if (error instanceof ORPCError && error.status >= 400 && error.status < 500) setIntent(null);
      setMessage(error instanceof Error ? error.message : "Operation failed.");
    }
    await cache.invalidateQueries();
  }
  return <div className="space-y-2"><label className="block">Quick-action reason<Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></label>{superseded ? <label className="block">Admin superseded-stock decision<Input value={decision} onChange={(event) => setDecision(event.target.value)} /></label> : null}<div className="flex gap-2"><Button size="sm" disabled={operation.isPending || reason.trim().length < 3} onClick={() => void run("receive")}>Receive +1</Button><Button size="sm" variant="outline" disabled={operation.isPending || reason.trim().length < 3 || (superseded && (role !== "admin" || !decision.trim()))} onClick={() => void run("issue")}>Issue −1</Button></div>{role === "admin" ? <div><label>Low-stock threshold<Input type="number" min={0} value={nextThreshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label><Button size="sm" variant="outline" disabled={operation.isPending} onClick={() => void run("threshold")}>Save threshold</Button></div> : null}<p role="status">{message}</p></div>;
}
