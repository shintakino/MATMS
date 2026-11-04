/** Calculate a count variance without converting PHP values to floating point. */
export function calculatePhysicalCountVariance(input: {
  cardQuantity: number;
  physicalQuantity: number;
  unitValue: string | null;
}): { quantity: number; value: string | null; status: "matched" | "shortage" | "overage" } {
  for (const quantity of [input.cardQuantity, input.physicalQuantity]) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Counts must be nonnegative whole numbers.");
  }
  const quantity = input.physicalQuantity - input.cardQuantity;
  const status = quantity < 0 ? "shortage" : quantity > 0 ? "overage" : "matched";
  if (input.unitValue === null) return { quantity, value: null, status };
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(input.unitValue);
  if (!match || !match[1]) throw new Error("Unit value must be a nonnegative decimal with at most two fractional digits.");
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  const total = cents * BigInt(quantity);
  const magnitude = total < 0n ? -total : total;
  const value = `${total < 0n ? "-" : ""}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`;
  return { quantity, value, status };
}
