import { AppShell } from "@/components/app-shell";
import { ReportingWorkspace } from "@/components/reporting-workspace";
import { requireIdentity } from "@/lib/require-identity";

export default async function ReportsPage() {
  const identity = await requireIdentity("/reports");
  return <AppShell role={identity.role} userName={identity.name}><ReportingWorkspace mode="reports" role={identity.role} /></AppShell>;
}
