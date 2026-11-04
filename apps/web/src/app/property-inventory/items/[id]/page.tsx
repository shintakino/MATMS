import { AppShell } from "@/components/app-shell";
import { PropertyInventoryItem } from "@/components/property-inventory-item";
import { requireIdentity } from "@/lib/require-identity";

export default async function PropertyInventoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/property-inventory/items/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><PropertyInventoryItem id={id} role={identity.role} /></AppShell>;
}
