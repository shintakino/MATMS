import { AppShell } from "@/components/app-shell";
import { InventoryRegister } from "@/components/inventory-register";
import { requireIdentity } from "@/lib/require-identity";
import { InventorySetup } from "@/components/archive-intake";

export default async function InventoryPage() { const identity = await requireIdentity("/inventory"); return <AppShell role={identity.role} userName={identity.name}>{identity.role === "admin" ? <InventorySetup /> : null}<InventoryRegister role={identity.role} /></AppShell>; }
