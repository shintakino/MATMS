import { AppShell } from "@/components/app-shell";
import { InventoryImportDetail } from "@/components/inventory-import-detail";
import { requireIdentity } from "@/lib/require-identity";

export default async function InventoryImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/property-inventory/imports/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><InventoryImportDetail id={id} role={identity.role} /></AppShell>;
}
