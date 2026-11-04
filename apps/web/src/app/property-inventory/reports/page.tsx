import { AppShell } from "@/components/app-shell";
import { InventoryReports } from "@/components/inventory-reports";
import { requireIdentity } from "@/lib/require-identity";

export default async function InventoryReportsPage() {
  const identity = await requireIdentity("/property-inventory/reports");
  return <AppShell role={identity.role} userName={identity.name}><InventoryReports role={identity.role} /></AppShell>;
}
