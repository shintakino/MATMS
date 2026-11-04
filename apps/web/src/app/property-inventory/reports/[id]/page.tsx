import { AppShell } from "@/components/app-shell";
import { InventoryReportPreview } from "@/components/inventory-report-preview";
import { requireIdentity } from "@/lib/require-identity";

export default async function InventoryReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/property-inventory/reports/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><InventoryReportPreview id={id} role={identity.role} /></AppShell>;
}
