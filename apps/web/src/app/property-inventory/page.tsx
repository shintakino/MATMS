import { AppShell } from "@/components/app-shell";
import { PropertyInventoryRegister } from "@/components/property-inventory";
import { requireIdentity } from "@/lib/require-identity";

export default async function PropertyInventoryPage() {
  const identity = await requireIdentity("/property-inventory");
  return <AppShell role={identity.role} userName={identity.name}><PropertyInventoryRegister role={identity.role} /></AppShell>;
}
