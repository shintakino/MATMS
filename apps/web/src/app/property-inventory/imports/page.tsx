import { AppShell } from "@/components/app-shell";
import { InventoryImports } from "@/components/inventory-imports";
import { requireIdentity } from "@/lib/require-identity";

export default async function InventoryImportsPage() {
  const identity = await requireIdentity("/property-inventory/imports");
  return <AppShell role={identity.role} userName={identity.name}><InventoryImports role={identity.role} /></AppShell>;
}
