import { Badge } from "@matms/ui/components/badge";

type StockStatusBadgeProps = {
  quantity: number;
  reorderThreshold: number;
};

/**
 * Visual status only. Inventory procedures remain the source of truth for balances.
 */
export function StockStatusBadge({ quantity, reorderThreshold }: StockStatusBadgeProps) {
  if (quantity <= 0) {
    return (
      <Badge className="bg-destructive text-destructive-foreground">
        Out of stock
      </Badge>
    );
  }

  if (quantity <= reorderThreshold) {
    return <Badge className="bg-warning text-warning-foreground">Low stock</Badge>;
  }

  return <Badge className="bg-success text-success-foreground">In stock</Badge>;
}
