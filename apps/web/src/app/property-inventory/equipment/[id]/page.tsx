import { AppShell } from "@/components/app-shell";
import { EquipmentDetail } from "@/components/equipment";
import { requireIdentity } from "@/lib/require-identity";
export default async function EquipmentPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const identity=await requireIdentity(`/property-inventory/equipment/${id}`);
  return <AppShell role={identity.role} userName={identity.name}>{identity.role==="admin"||identity.role==="property_custodian"?<EquipmentDetail id={id} admin={identity.role==="admin"}/>:<p className="p-6">Equipment custody is available to the Administrator and Property Custodian.</p>}</AppShell>;
}
