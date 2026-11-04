import { AppShell } from "@/components/app-shell";
import { PropertyStockCard } from "@/components/property-stock-card";
import { requireIdentity } from "@/lib/require-identity";

export default async function StockCardPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const identity = await requireIdentity(`/property-inventory/stock-cards/${itemId}`);
  return <AppShell role={identity.role} userName={identity.name}><PropertyStockCard itemId={itemId} role={identity.role} /></AppShell>;
}
