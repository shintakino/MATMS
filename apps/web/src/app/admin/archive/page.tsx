import type { Route } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ArchiveAdministration } from "@/components/archive-administration";
import { requireIdentity } from "@/lib/require-identity";

export default async function ArchiveAdministrationPage() {
  const identity = await requireIdentity("/admin/archive");
  if (identity.role !== "admin") redirect("/dashboard" as Route);
  return <AppShell role={identity.role} userName={identity.name}><ArchiveAdministration /></AppShell>;
}
