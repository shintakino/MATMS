export function icsItemNumber(code: string, quantity: number, start: bigint, end: bigint): string {
  if (!code.trim() || !Number.isSafeInteger(quantity) || quantity < 1 || start < 1n || end - start + 1n !== BigInt(quantity)) {
    throw new Error("ICS item number range does not match its issued quantity.");
  }
  const first = start.toString().padStart(3, "0"), last = end.toString().padStart(3, "0");
  return `${code}-${quantity === 1 ? first : `${first}-${last}`}`;
}
