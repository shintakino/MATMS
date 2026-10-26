import { AppShell } from "@/components/app-shell";
import { InventoryRegister } from "@/components/inventory-register";
import { requireIdentity } from "@/lib/require-identity";

export default async function InventoryPage() { const identity = await requireIdentity("/inventory"); return <AppShell role={identity.role} userName={identity.name}><InventoryRegister role={identity.role} /></AppShell>; }
