import { AppShell } from "@/components/app-shell";
import { PhysicalCountDetail } from "@/components/physical-count-detail";
import { requireIdentity } from "@/lib/require-identity";

export default async function PhysicalCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await requireIdentity(`/property-inventory/counts/${id}`);
  return <AppShell role={identity.role} userName={identity.name}><PhysicalCountDetail id={id} role={identity.role} /></AppShell>;
}
