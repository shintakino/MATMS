import { AppShell } from "@/components/app-shell";
import { PhysicalCountRegister } from "@/components/physical-counts";
import { requireIdentity } from "@/lib/require-identity";

export default async function PhysicalCountsPage() {
  const identity = await requireIdentity("/property-inventory/counts");
  return <AppShell role={identity.role} userName={identity.name}><PhysicalCountRegister role={identity.role} /></AppShell>;
}
