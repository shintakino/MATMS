import { AppShell } from "@/components/app-shell";
import { RequestList } from "@/components/custody-workspace";
import { requireIdentity } from "@/lib/require-identity";
import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function RequestsPage() {
  const identity = await requireIdentity("/requests");
  if (identity.role === "viewer") redirect("/dashboard" as Route);
  return <AppShell role={identity.role} userName={identity.name}><RequestList /></AppShell>;
}
