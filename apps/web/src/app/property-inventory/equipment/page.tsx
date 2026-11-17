import { AppShell } from "@/components/app-shell";
import { EquipmentRegister } from "@/components/equipment";
import { requireIdentity } from "@/lib/require-identity";
export default async function EquipmentPage() {
  const identity=await requireIdentity("/property-inventory/equipment");
  return <AppShell role={identity.role} userName={identity.name}>{identity.role==="admin"||identity.role==="property_custodian"?<EquipmentRegister/>:<p className="p-6">Equipment custody is available to the Administrator and Property Custodian.</p>}</AppShell>;
}
