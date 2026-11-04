import { AppShell } from "@/components/app-shell";
import { ReportingWorkspace } from "@/components/reporting-workspace";
import { requireIdentity } from "@/lib/require-identity";

export default async function SearchPage() {
  const identity = await requireIdentity("/search");
  return <AppShell role={identity.role} userName={identity.name}><ReportingWorkspace mode="search" role={identity.role} /></AppShell>;
}
