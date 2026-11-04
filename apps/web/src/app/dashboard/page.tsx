import { AppShell } from "@/components/app-shell";
import { DashboardOverview } from "@/components/reporting-workspace";
import { requireIdentity } from "@/lib/require-identity";

export default async function DashboardPage() {
  const identity = await requireIdentity("/dashboard");

  return (
    <AppShell role={identity.role} userName={identity.name}>
      <DashboardOverview role={identity.role} />
    </AppShell>
  );
}
