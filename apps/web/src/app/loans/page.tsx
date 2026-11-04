import { AppShell } from "@/components/app-shell";
import { LoanList } from "@/components/custody-workspace";
import { requireIdentity } from "@/lib/require-identity";
import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function LoansPage() {
  const identity = await requireIdentity("/loans");
  if (identity.role === "viewer") redirect("/dashboard" as Route);
  return <AppShell role={identity.role} userName={identity.name}><LoanList role={identity.role} /></AppShell>;
}
