import { AppShell } from "@/components/app-shell";
import { RequestDetail } from "@/components/custody-workspace";
import { requireIdentity } from "@/lib/require-identity";
import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/requests/${id}`);
  if (identity.role === "viewer") redirect("/dashboard" as Route);
  return <AppShell role={identity.role} userName={identity.name}><RequestDetail id={id} role={identity.role} /></AppShell>;
}
